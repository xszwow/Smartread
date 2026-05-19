import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { createEmailService, type EmailMessage, type EmailService } from "../email.js";
import { MockBookSourceAdapter } from "../adapters/mock-source.js";
import { ZlibraryNodeAdapter } from "../adapters/zlibrary-node-adapter.js";
import { ZlibMirrorResolver } from "../zlib-mirror-resolver.js";
import { hashPassword, verifyPassword } from "../security.js";
import type { SearchParams, SearchResponse, ZlibSessionState } from "../adapters/book-source.js";

let tempDir: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let emailService: CapturingEmailService;
let fetchCalls: Array<{ url: string; init?: RequestInit }>;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartread-test-"));
  emailService = new CapturingEmailService();
  fetchCalls = [];
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("SmartRead backend", () => {
  it("logs in with email code and reports AI/ZLib binding state", async () => {
    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/email/request",
      payload: { email: "reader@example.com" }
    });
    expect(requested.statusCode).toBe(200);
    expect(emailService.lastCodeFor("reader@example.com")).toMatch(/^\d{6}$/);

    const login = await verifyEmail("reader@example.com");
    expect(login.body.user.email).toBe("reader@example.com");
    expect(login.body.aiConfigured).toBe(false);
    expect(login.body.zlibBound).toBe(false);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: login.cookie } });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body)).toMatchObject({
      user: { email: "reader@example.com" },
      aiConfigured: false,
      zlibBound: false
    });
  });

  it("hashes local passwords without native desktop packaging dependencies", async () => {
    const hash = await hashPassword("password123");
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain("password123");
    await expect(verifyPassword(hash, "password123")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });

  it("can send email login codes through the Worker mail endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const workerEmail = createEmailService(
      loadConfig({
        dataDir: tempDir,
        smartreadEmailProvider: "worker",
        smartreadWorkerMailBaseUrl: "https://mail.example.com",
        smartreadWorkerMailAuthToken: "worker-secret",
        smartreadWorkerMailFrom: "noreply@example.com",
        smartreadWorkerMailFromName: "智读 SmartRead"
      }),
      async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
    );

    await workerEmail.send({
      to: "reader@example.com",
      subject: "智读 SmartRead 登录验证码",
      text: "你的验证码是 123456",
      html: "<p>你的验证码是 123456</p>"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mail.example.com/admin/send_mail");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-admin-auth")).toBe("worker-secret");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      from_name: "智读 SmartRead",
      from_mail: "noreply@example.com",
      to_mail: "reader@example.com",
      subject: "智读 SmartRead 登录验证码",
      content: "<p>你的验证码是 123456</p>",
      is_html: true
    });
  });

  it("enforces email code cooldown, expiry, and attempt limits", async () => {
    await requestCode("cooldown@example.com");
    const repeated = await app.inject({
      method: "POST",
      url: "/api/auth/email/request",
      payload: { email: "cooldown@example.com" }
    });
    expect(repeated.statusCode).toBe(429);

    await requestCode("expired@example.com");
    const db = (app as unknown as { smartreadDb: AppDatabase }).smartreadDb;
    db.run("UPDATE email_verification_codes SET expires_at = ? WHERE email = ?", Date.now() - 1, "expired@example.com");
    const expired = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify",
      payload: { email: "expired@example.com", code: emailService.lastCodeFor("expired@example.com") }
    });
    expect(expired.statusCode).toBe(400);

    await requestCode("attempts@example.com");
    for (let i = 0; i < 4; i++) {
      const wrong = await app.inject({
        method: "POST",
        url: "/api/auth/email/verify",
        payload: { email: "attempts@example.com", code: "000000" }
      });
      expect(wrong.statusCode).toBe(400);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify",
      payload: { email: "attempts@example.com", code: "000000" }
    });
    expect(blocked.statusCode).toBe(429);
  });

  it("requires SmartRead login before books, AI, and ZLib APIs", async () => {
    const checks = await Promise.all([
      app.inject({ method: "GET", url: "/api/books" }),
      app.inject({ method: "GET", url: "/api/zlib/search?q=dao" }),
      app.inject({ method: "POST", url: "/api/zlib/download", payload: { sourceId: "mock-txt-1", format: "txt" } }),
      app.inject({ method: "GET", url: "/api/downloads/job_missing" }),
      app.inject({ method: "GET", url: "/api/books/book_missing/file" }),
      app.inject({ method: "DELETE", url: "/api/books/book_missing" }),
      app.inject({ method: "PATCH", url: "/api/books/book_missing/progress", payload: { progress: 1 } }),
      app.inject({ method: "POST", url: "/api/ai/chat", payload: { messages: [{ role: "user", content: "hi" }] } })
    ]);
    expect(checks.map(response => response.statusCode)).toEqual([401, 401, 401, 401, 401, 401, 401, 401]);
  });

  it("defaults Z-Library login to the configured reachable mirror", () => {
    const env = snapshotEnv([
      "HOST",
      "SMARTREAD_DEPLOYMENT",
      "SMARTREAD_DESKTOP",
      "SMARTREAD_ALLOWED_ORIGINS",
      "SMARTREAD_COOKIE_SAMESITE",
      "SMARTREAD_COOKIE_SECURE",
      "ZLIB_DOMAIN",
      "ZLIB_LOGIN_DOMAIN",
      "ZLIB_REGISTER_URL",
      "ZLIB_TIMEOUT_MS",
      "ZLIB_PROXY_URLS",
      "ZLIB_PROXY_URL",
      "ZLIB_EGRESS_MODE",
      "ZLIB_CLASH_API_URL",
      "ZLIB_CLASH_PROXY_URL"
    ]);
    clearEnv(Object.keys(env));

    try {
      const config = loadConfig({ dataDir: tempDir });
      expect(config.host).toBe("0.0.0.0");
      expect(config.deploymentMode).toBe("web");
      expect(config.cookieSameSite).toBe("lax");
      expect(config.allowedOrigins).toEqual([]);
      expect(config.zlibDomain).toBe("https://z-lib.fm");
      expect(config.zlibLoginDomain).toBe("https://z-lib.fm/rpc.php");
      expect(config.zlibRegisterUrl).toBe("https://z-lib.fm/registration?redirectUrl=https%3A%2F%2Fz-lib.fm%2F");
      expect(config.zlibMirrors).toEqual(["https://z-lib.fm", "https://z-library.sk", "https://z-library.is"]);
      expect(config.zlibProxyUrls).toEqual([]);
      expect(config.zlibEgressMode).toBe("auto");
      expect(config.zlibProxyPreferKeywords).toEqual(["日本", "jp", "japan"]);
      expect(config.zlibClashApiUrl).toBe("");
      expect(config.zlibClashProxyUrl).toBe("");
      expect(config.zlibRequestTimeoutMs).toBe(60000);
    } finally {
      restoreEnvSnapshot(env);
    }
  });

  it("defaults desktop mode to a loopback local server and optional Clash proxy", () => {
    const env = snapshotEnv(["HOST", "ZLIB_CLASH_API_URL", "ZLIB_CLASH_PROXY_URL", "ZLIB_PROXY_URLS", "ZLIB_PROXY_URL"]);
    clearEnv(Object.keys(env));

    try {
      const config = loadConfig({ dataDir: tempDir, deploymentMode: "desktop" });
      expect(config.deploymentMode).toBe("desktop");
      expect(config.host).toBe("127.0.0.1");
      expect(config.zlibClashProxyUrl).toBe("http://127.0.0.1:7890");
      expect(config.zlibProxyUrls[0]).toBe("🇯🇵 日本优选=http://127.0.0.1:7890");
    } finally {
      restoreEnvSnapshot(env);
    }
  });

  it("auto-creates a local desktop session without email login", async () => {
    await app.close();
    app = await buildTestApp(new MockBookSourceAdapter(), { deploymentMode: "desktop" });

    const me = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(200);
    const body = JSON.parse(me.body);
    expect(body.user.email).toBe("local-desktop@smartread.local");
    expect(String(me.headers["set-cookie"])).toContain("smartread_sid=");

    const books = await app.inject({
      method: "GET",
      url: "/api/books",
      headers: { cookie: me.headers["set-cookie"] as string }
    });
    expect(books.statusCode).toBe(200);
  });

  it("supports native mobile API origins and cross-site session cookies", async () => {
    await app.close();
    app = await buildTestApp(new MockBookSourceAdapter(), {
      allowedOrigins: ["https://localhost"],
      cookieSameSite: "none",
      cookieSecure: true
    });

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/me",
      headers: {
        origin: "https://localhost",
        "access-control-request-method": "GET"
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://localhost");
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");

    await requestCode("native@example.com");
    const code = emailService.lastCodeFor("native@example.com");
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify",
      headers: { origin: "https://localhost" },
      payload: { email: "native@example.com", code }
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["access-control-allow-origin"]).toBe("https://localhost");
    expect(String(login.headers["set-cookie"])).toContain("SameSite=None");
    expect(String(login.headers["set-cookie"])).toContain("Secure");
  });

  it("binds Z-Library as an optional book source and keeps download/progress working", async () => {
    const login = await loginUser("reader@example.com");
    const notBound = await app.inject({
      method: "GET",
      url: "/api/zlib/search?q=dao",
      headers: { cookie: login.cookie }
    });
    expect(notBound.statusCode).toBe(409);

    const bind = await bindZlib(login.cookie, "reader-zlib@example.com");
    expect(bind.statusCode).toBe(200);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: login.cookie } });
    expect(JSON.parse(me.body).zlibBound).toBe(true);

    const db = (app as unknown as { smartreadDb: AppDatabase }).smartreadDb;
    const credential = db.get<{ encrypted_session: string; bound_email: string }>(
      "SELECT encrypted_session, bound_email FROM zlib_credentials WHERE user_id = ?",
      login.body.user.id
    );
    expect(credential?.bound_email).toBe("reader-zlib@example.com");
    expect(credential?.encrypted_session).toBeTruthy();
    expect(credential?.encrypted_session).not.toContain("password123");

    const search = await app.inject({
      method: "GET",
      url: "/api/zlib/search?q=dao&page=1&format=txt",
      headers: { cookie: login.cookie }
    });
    expect(search.statusCode).toBe(200);
    const result = JSON.parse(search.body).results[0];
    expect(result.sourceId).toBe("mock-txt-1");

    const download = await app.inject({
      method: "POST",
      url: "/api/zlib/download",
      headers: { cookie: login.cookie },
      payload: { sourceId: result.sourceId, format: "txt", metadata: result }
    });
    expect(download.statusCode).toBe(202);
    const job = await waitForJob(login.cookie, JSON.parse(download.body).jobId);
    expect(job.status).toBe("saved");
    expect(job.bookId).toBeTruthy();

    const books = await app.inject({ method: "GET", url: "/api/books", headers: { cookie: login.cookie } });
    expect(books.statusCode).toBe(200);
    const book = JSON.parse(books.body).books[0];
    expect(book.title).toContain("dao");

    const file = await app.inject({
      method: "GET",
      url: `/api/books/${book.id}/file`,
      headers: { cookie: login.cookie }
    });
    expect(file.statusCode).toBe(200);
    expect(file.body).toContain("mock downloaded book");

    const progress = await app.inject({
      method: "PATCH",
      url: `/api/books/${book.id}/progress`,
      headers: { cookie: login.cookie },
      payload: { currentPage: 3, progress: 42, totalPages: 10, lastRead: 1234 }
    });
    expect(progress.statusCode).toBe(200);
    expect(JSON.parse(progress.body).book.progress).toBe(42);
  });

  it("returns an actionable message when Z-Library binding times out", async () => {
    await app.close();
    app = await buildTestApp(new TimeoutLoginAdapter());
    const login = await loginUser("timeout@example.com");

    const bind = await bindZlib(login.cookie, "timeout-zlib@example.com");
    expect(bind.statusCode).toBe(504);
    const body = JSON.parse(bind.body);
    expect(body.error).toContain("Z-Library 登录超时");
    expect(body.error).toContain("60 秒");
    expect(body.error).toContain("ZLIB_TIMEOUT_MS");
    expect(body.error).not.toContain("timeout of 20000ms exceeded");
  });

  it("saves per-user AI config encrypted and proxies non-streaming and streaming chat", async () => {
    const login = await loginUser("ai@example.com");
    const missing = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      headers: { cookie: login.cookie },
      payload: { messages: [{ role: "user", content: "hi" }] }
    });
    expect(missing.statusCode).toBe(409);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/ai/config",
      headers: { cookie: login.cookie },
      payload: {
        baseURL: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk-test-secret",
        model: "gpt-5.5"
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body)).toMatchObject({ configured: true, model: "gpt-5.5" });
    expect(saved.body).not.toContain("sk-test-secret");

    const db = (app as unknown as { smartreadDb: AppDatabase }).smartreadDb;
    const aiRow = db.get<{ encrypted_api_key: string }>(
      "SELECT encrypted_api_key FROM user_ai_configs WHERE user_id = ?",
      login.body.user.id
    );
    expect(aiRow?.encrypted_api_key).toBeTruthy();
    expect(aiRow?.encrypted_api_key).not.toContain("sk-test-secret");

    const chat = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      headers: { cookie: login.cookie },
      payload: { messages: [{ role: "user", content: "hi" }], stream: false }
    });
    expect(chat.statusCode).toBe(200);
    expect(JSON.parse(chat.body).choices[0].message.content).toBe("mock ai answer");
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/chat/completions");

    const stream = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      headers: { cookie: login.cookie },
      payload: { messages: [{ role: "user", content: "hi" }], stream: true }
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain("data:");
    expect(stream.body).toContain("[DONE]");
  });

  it("reports Z-Library search pagination state", async () => {
    await app.close();
    app = await buildTestApp(new PagingMockAdapter());
    const login = await loginUser("pager@example.com");
    await bindZlib(login.cookie, "pager-zlib@example.com");

    const one = await searchZlib(login.cookie, "one", 1);
    expect(one).toMatchObject({ page: 1, totalPages: 1, hasNext: false });

    const unknown = await searchZlib(login.cookie, "unknown", 1);
    expect(unknown).toMatchObject({ page: 1, totalPages: null, hasNext: true });

    const middle = await searchZlib(login.cookie, "three", 2);
    expect(middle).toMatchObject({ page: 2, totalPages: 3, hasNext: true });

    const last = await searchZlib(login.cookie, "three", 3);
    expect(last).toMatchObject({ page: 3, totalPages: 3, hasNext: false });
  });

  it("falls back when the direct Z-Library parser finds an empty paged result", async () => {
    const adapter = new ZlibraryNodeAdapter();
    let fallbackCalls = 0;
    (adapter as unknown as {
      restoreLib: (session: ZlibSessionState) => unknown;
      directSearch: (_lib: unknown, params: SearchParams, _extensions: string[]) => Promise<SearchResponse>;
      searchWithPaginator: (_lib: unknown, params: SearchParams, _extensions: string[]) => Promise<SearchResponse>;
    }).restoreLib = () => ({ mirror: "https://z-lib.fm" });
    (adapter as unknown as {
      directSearch: (_lib: unknown, params: SearchParams, _extensions: string[]) => Promise<SearchResponse>;
    }).directSearch = async (_lib, params) => ({
      page: params.page,
      totalPages: 3,
      hasNext: true,
      results: []
    });
    (adapter as unknown as {
      searchWithPaginator: (_lib: unknown, params: SearchParams, _extensions: string[]) => Promise<SearchResponse>;
    }).searchWithPaginator = async (_lib, params) => {
      fallbackCalls += 1;
      return {
        page: params.page,
        totalPages: null,
        hasNext: true,
        results: [{
          sourceId: `fallback-page-${params.page}`,
          title: `Fallback Page ${params.page}`,
          authors: ["SmartRead QA"],
          coverUrl: null,
          year: null,
          language: null,
          extension: "epub",
          sizeLabel: "1 MB",
          rating: null,
          sourceUrl: null
        }]
      };
    };

    const result = await adapter.search(
      { cookies: {}, createdAt: Date.now() },
      { q: "fallback", page: 2, format: "epub" }
    );

    expect(fallbackCalls).toBe(1);
    expect(result).toMatchObject({ page: 2, totalPages: 3, hasNext: true });
    expect(result.results[0]).toMatchObject({
      sourceId: "fallback-page-2",
      title: "Fallback Page 2",
      extension: "epub"
    });
  });

  it("selects an available Z-Library mirror and keeps registration on a web-capable mirror", async () => {
    const calls: string[] = [];
    const resolver = new ZlibMirrorResolver(
      loadConfig({
        dataDir: tempDir,
        zlibDomain: "https://z-lib.fm",
        zlibMirrors: ["https://z-lib.fm", "https://z-library.sk", "https://z-library.is"],
        zlibMirrorProbeTimeoutMs: 100,
        zlibMirrorCacheTtlMs: 1000
      }),
      {
        fetch: async (url) => {
          calls.push(String(url));
          const target = String(url);
          if (target.includes("z-lib.fm/rpc.php")) return new Response("down", { status: 503 });
          if (target.includes("z-lib.fm/registration")) return new Response("<title>Sign up</title>", { status: 200 });
          if (target.includes("z-library.sk/rpc.php")) return new Response("ok", { status: 200 });
          if (target.includes("z-library.sk/registration")) return new Response("checking", { status: 503 });
          return new Response("blocked", { status: 403 });
        }
      }
    );

    const selection = await resolver.resolve();
    expect(selection.domain).toBe("https://z-library.sk");
    expect(selection.loginDomain).toBe("https://z-library.sk/rpc.php");
    expect(selection.registerUrl).toBe("https://z-lib.fm/registration?redirectUrl=https%3A%2F%2Fz-lib.fm%2F");
    expect(calls).toContain("https://z-lib.fm/rpc.php");
    expect(calls).toContain("https://z-library.sk/rpc.php");
  });

  it("prefers a configured Japan proxy when Z-Library direct egress is unavailable", async () => {
    const axiosCalls: string[] = [];
    const resolver = new ZlibMirrorResolver(
      loadConfig({
        dataDir: tempDir,
        zlibDomain: "https://z-lib.fm",
        zlibMirrors: ["https://z-lib.fm"],
        zlibProxyUrls: [
          "新加坡=http://sg-proxy.example:7890",
          "日本优选=http://jp-proxy.example:7890"
        ],
        zlibMirrorProbeTimeoutMs: 100,
        zlibMirrorCacheTtlMs: 1000
      }),
      {
        fetch: async () => new Response("blocked", { status: 503 }),
        axiosRequest: async (options) => {
          const proxyUrl = String(options.zlibProxyUrl || "");
          axiosCalls.push(proxyUrl);
          return { status: proxyUrl.includes("jp-proxy") ? 200 : 503 };
        }
      }
    );

    const selection = await resolver.resolve();
    expect(selection.domain).toBe("https://z-lib.fm");
    expect(selection.proxyUrl).toBe("http://jp-proxy.example:7890/");
    expect(selection.proxyLabel).toBe("日本优选");
    expect(selection.proxyPreferred).toBe(true);
    expect(axiosCalls).toContain("http://jp-proxy.example:7890/");
  });

  it("switches a configured Mihomo selector before Z-Library proxy probing", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const axiosCalls: string[] = [];
    const resolver = new ZlibMirrorResolver(
      loadConfig({
        dataDir: tempDir,
        zlibDomain: "https://z-lib.fm",
        zlibMirrors: ["https://z-lib.fm"],
        zlibEgressMode: "proxy",
        zlibProxyUrls: ["日本优选=http://127.0.0.1:7890"],
        zlibClashApiUrl: "http://127.0.0.1:9091",
        zlibClashSelector: "🚀 节点选择",
        zlibClashPreferredGroup: "🇯🇵 日本优选",
        zlibMirrorProbeTimeoutMs: 100,
        zlibMirrorCacheTtlMs: 1000
      }),
      {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return new Response("", { status: 204 });
        },
        axiosRequest: async (options) => {
          axiosCalls.push(String(options.zlibProxyUrl || ""));
          return { status: 200 };
        }
      }
    );

    const selection = await resolver.resolve();
    const switchCall = fetchCalls.find(call => call.url.includes("/proxies/"));
    expect(switchCall?.init?.method).toBe("PUT");
    expect(JSON.parse(String(switchCall?.init?.body))).toEqual({ name: "🇯🇵 日本优选" });
    expect(selection.proxyUrl).toBe("http://127.0.0.1:7890/");
    expect(selection.proxyLabel).toBe("日本优选");
    expect(axiosCalls).toContain("http://127.0.0.1:7890/");
  });

  it("blocks server book access across SmartRead users", async () => {
    const first = await loginUser("one@example.com");
    await bindZlib(first.cookie, "one-zlib@example.com");
    await downloadMockBook(first.cookie);
    const books = await app.inject({ method: "GET", url: "/api/books", headers: { cookie: first.cookie } });
    const bookId = JSON.parse(books.body).books[0].id;

    const second = await loginUser("two@example.com");
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/books/${bookId}/file`,
      headers: { cookie: second.cookie }
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it("keeps legacy Z-Library login as a compatibility entry", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "legacy@example.com", password: "password123" }
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user.email).toBe("legacy@example.com");
    expect(body.zlibBound).toBe(true);
  });
});

class CapturingEmailService implements EmailService {
  messages: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.messages.push(message);
  }

  lastCodeFor(email: string) {
    const message = [...this.messages].reverse().find(item => item.to === email);
    return message?.text.match(/\d{6}/)?.[0] || "";
  }
}

async function requestCode(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/email/request",
    payload: { email }
  });
  expect(response.statusCode).toBe(200);
  return response;
}

async function verifyEmail(email: string) {
  const code = emailService.lastCodeFor(email);
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/email/verify",
    payload: { email, code }
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: response.headers["set-cookie"] as string,
    body: JSON.parse(response.body)
  };
}

async function loginUser(email: string) {
  await requestCode(email);
  return verifyEmail(email);
}

async function bindZlib(cookie: string, email: string) {
  return app.inject({
    method: "POST",
    url: "/api/book-sources/zlib/bind",
    headers: { cookie },
    payload: { email, password: "password123" }
  });
}

async function buildTestApp(adapter = new MockBookSourceAdapter(), configOverrides: Partial<AppConfig> = {}) {
  return buildApp({
    config: {
      dataDir: tempDir,
      dbPath: path.join(tempDir, "test.sqlite"),
      sessionSecret: "test-session-secret",
      encryptionSecret: "test-encryption-secret",
      cookieSecure: false,
      bookSource: "mock",
      emailDomainWhitelist: ["example.com"],
      zlibRegisterUrl: "https://z-lib.fm/registration?redirectUrl=https%3A%2F%2Fz-lib.fm%2F",
      ...configOverrides
    },
    adapter,
    emailService,
    fetch: fakeAIUpstream
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map(key => [key, process.env[key]]));
}

function clearEnv(keys: string[]): void {
  for (const key of keys) delete process.env[key];
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) restoreEnv(key, value);
}

const fakeAIUpstream: typeof fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  const body = JSON.parse(String(init?.body || "{}")) as { stream?: boolean };
  if (body.stream) {
    return new Response(
      [
        'data: {"choices":[{"delta":{"content":"mock "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"stream"}}]}\n\n',
        "data: [DONE]\n\n"
      ].join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  }
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "mock ai answer" } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

class TimeoutLoginAdapter extends MockBookSourceAdapter {
  async login(): Promise<ZlibSessionState> {
    const error = new Error("timeout of 20000ms exceeded") as Error & { code?: string };
    error.code = "ECONNABORTED";
    throw error;
  }
}

class FallbackPaginator {
  page = 1;
  total = 3;

  async nextPage(): Promise<void> {
    this.page += 1;
  }

  async next() {
    return [{
      id: `fallback-page-${this.page}`,
      name: `Fallback Page ${this.page}`,
      authors: [{ author: "SmartRead QA" }],
      extension: "EPUB",
      size: "1 MB"
    }];
  }
}

class PagingMockAdapter extends MockBookSourceAdapter {
  async search(_session: ZlibSessionState, params: SearchParams): Promise<SearchResponse> {
    const totalPages = params.q === "one" ? 1 : params.q === "three" ? 3 : null;
    const hasNext = totalPages !== null ? params.page < totalPages : params.page === 1;
    return {
      page: params.page,
      totalPages,
      hasNext,
      results: hasNext || params.q !== "empty"
        ? [{
            sourceId: `page-${params.q}-${params.page}`,
            title: `Page ${params.page}`,
            authors: ["SmartRead Test"],
            coverUrl: null,
            year: "2026",
            language: "english",
            extension: params.format || "epub",
            sizeLabel: "1 KB",
            rating: "5.0/5.0",
            sourceUrl: "mock://zlib/page"
          }]
        : []
    };
  }
}

async function searchZlib(cookie: string, q: string, page: number) {
  const response = await app.inject({
    method: "GET",
    url: `/api/zlib/search?q=${encodeURIComponent(q)}&page=${page}`,
    headers: { cookie }
  });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body);
}

async function downloadMockBook(cookie: string) {
  const download = await app.inject({
    method: "POST",
    url: "/api/zlib/download",
    headers: { cookie },
    payload: {
      sourceId: "mock-txt-1",
      format: "txt",
      metadata: { sourceId: "mock-txt-1", title: "Private Test", extension: "txt" }
    }
  });
  await waitForJob(cookie, JSON.parse(download.body).jobId);
}

async function waitForJob(cookie: string, jobId: string) {
  for (let i = 0; i < 20; i++) {
    const response = await app.inject({
      method: "GET",
      url: `/api/downloads/${jobId}`,
      headers: { cookie }
    });
    const job = JSON.parse(response.body).job;
    if (job.status === "saved" || job.status === "failed") return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job");
}
