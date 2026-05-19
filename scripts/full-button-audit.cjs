#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
loadDotEnvLocal();
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const OUT_DIR = path.join(ROOT, "test-artifacts", `full-button-audit-${STAMP}`);
const BASE_URL = process.env.SMARTREAD_BASE_URL || "http://127.0.0.1:4173";
const ZLIB_EMAIL = process.env.SMARTREAD_TEST_ZLIB_EMAIL || "";
const ZLIB_PASSWORD = process.env.SMARTREAD_TEST_ZLIB_PASSWORD || "";
const AI_BASE_URL = process.env.SMARTREAD_TEST_AI_BASE_URL || "http://123.56.164.230:3002/v1/chat/completions";
const AI_API_KEY = process.env.SMARTREAD_TEST_AI_API_KEY || "";
const AI_MODEL = process.env.SMARTREAD_TEST_AI_MODEL || "gpt-5.5";
const SAMPLE_BOOK = path.join(OUT_DIR, "sample-book.txt");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(SAMPLE_BOOK, "SmartRead Android full-button audit sample.\n", "utf8");

const report = {
  baseUrl: BASE_URL,
  outDir: OUT_DIR,
  startedAt: new Date().toISOString(),
  zlibLogin: null,
  aiConfig: null,
  viewports: [],
  networkErrors: [],
  consoleErrors: [],
  pageErrors: [],
  fixesNeeded: []
};

main().catch(error => {
  report.fatal = cleanText(error instanceof Error ? error.stack || error.message : String(error));
  writeReport();
  process.exitCode = 1;
});

function loadDotEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  let server = await startServer({ SMARTREAD_BOOK_SOURCE: "zlibrary", ZLIB_TIMEOUT_MS: "20000" });
  let browser = await launchChromium();
  let context = await browser.newContext({ viewport: { width: 1280, height: 844 } });
  attachContextLogging(context);

  const login = await tryZlibLogin(context);
  report.zlibLogin = login;
  if (!login.ok) {
    await context.close();
    await browser.close();
    await server.stop();
    server = await startServer({ SMARTREAD_BOOK_SOURCE: "mock" });
    browser = await launchChromium();
    context = await browser.newContext({ viewport: { width: 1280, height: 844 } });
    attachContextLogging(context);
    const fallbackLogin = await tryZlibLogin(context);
    report.zlibLogin = {
      ...login,
      fallback: fallbackLogin,
      usedMockFallback: fallbackLogin.ok
    };
    if (!fallbackLogin.ok) {
      throw new Error(`Unable to establish logged-in test session: ${fallbackLogin.error || fallbackLogin.status}`);
    }
  }

  report.aiConfig = await saveAIConfig(context);
  await runViewportAudit(context, "desktop", { width: 1280, height: 844 });
  await runViewportAudit(context, "mobile", { width: 390, height: 844, isMobile: true });

  await context.close();
  await browser.close();
  await server.stop();
  report.finishedAt = new Date().toISOString();
  writeReport();
}

async function runViewportAudit(context, name, viewport) {
  const session = await tryZlibLogin(context);
  if (!session.ok) resultNote(report, `Viewport ${name} could not refresh login session: ${session.error || session.status}`);
  await saveAIConfig(context);

  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  page.on("pageerror", error => {
      report.pageErrors.push({ viewport: name, message: cleanText(error.message) });
  });
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) {
      report.consoleErrors.push({ viewport: name, type: message.type(), text: cleanText(message.text()) });
    }
  });
  page.on("requestfailed", request => {
    report.networkErrors.push({
      viewport: name,
      url: request.url(),
      method: request.method(),
      failure: cleanText(request.failure()?.errorText || "request failed")
    });
  });
  page.on("response", response => {
    if (response.status() >= 400) {
      report.networkErrors.push({
        viewport: name,
        url: response.url(),
        status: response.status(),
        method: response.request().method()
      });
    }
  });
  page.on("dialog", dialog => dialog.dismiss().catch(() => undefined));
  page.on("filechooser", chooser => chooser.setFiles(SAMPLE_BOOK).catch(() => undefined));

  const result = {
    name,
    viewport,
    pages: [],
    clicked: [],
    forms: [],
    links: [],
    screenshots: []
  };
  report.viewports.push(result);

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(800);
  result.pages.push({ label: "home", url: page.url(), title: cleanText(await page.title()) });

  await exerciseKnownFlows(page, result, name);
  await collectLinks(page, result);
  await clickVisibleControls(page, result, name);

  const screenshot = path.join(OUT_DIR, `${name}-final.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  result.screenshots.push(screenshot);
  await page.close();
}

async function exerciseKnownFlows(page, result, viewportName) {
  await fillIfVisible(page, ["#cfg-url"], AI_BASE_URL, result, "AI API URL");
  await fillIfVisible(page, ["#cfg-key"], AI_API_KEY, result, "AI API Key");
  await fillIfVisible(page, ["#cfg-model"], AI_MODEL, result, "AI model");

  await clickByTextOrSelector(page, result, "open AI settings", [
    "#mobile-action-ai",
    "button:has-text('AI')",
    "button:has-text('AI API')",
    "button:has-text('设置')"
  ]);
  await fillIfVisible(page, ["#cfg-url"], AI_BASE_URL, result, "AI API URL modal");
  await fillIfVisible(page, ["#cfg-key"], AI_API_KEY, result, "AI API Key modal");
  await fillIfVisible(page, ["#cfg-model"], AI_MODEL, result, "AI model modal");
  await clickByTextOrSelector(page, result, "save AI settings", [
    "button:has-text('保存')",
    "button:has-text('保存配置')",
    "button:has-text('✓')"
  ]);

  await clickByTextOrSelector(page, result, "online source", [
    "button:has-text('找书')",
    "button:has-text('在线')",
    "button:has-text('Z-Library')",
    "button:has-text('Z-Library 已绑定')"
  ]);
  await fillIfVisible(page, ["#mobile-cloud-query", "#cloud-query"], "dao", result, "Z-Library search query");
  await clickByTextOrSelector(page, result, "search books", [
    "button:has-text('搜索')",
    "button:has-text('找书')",
    "button[onclick*='onlineSearch']"
  ]);

  await clickByTextOrSelector(page, result, "import book", [
    "button:has-text('导入')",
    "button:has-text('本地书籍')",
    "#btn-import"
  ]);
  await page.waitForTimeout(500);
  await closeTransientUi(page);
  result.pages.push({ label: `${viewportName}-after-known-flows`, url: page.url(), title: cleanText(await page.title()) });
}

async function clickVisibleControls(page, result, viewportName) {
  const seen = new Set(result.clicked.map(item => item.key));
  for (let pass = 0; pass < 4; pass += 1) {
    await closeTransientUi(page);
    const count = await page.locator("button, [role='button']").count();
    for (let i = 0; i < count; i += 1) {
      const control = page.locator("button, [role='button']").nth(i);
      if (!(await control.isVisible().catch(() => false))) continue;
      const info = await describeControl(control);
      const key = `${info.tag}|${info.id}|${info.text}|${info.aria}`;
      if (seen.has(key)) continue;
      if (info.disabled) {
        seen.add(key);
        result.clicked.push({ label: `disabled:${info.text || info.id || info.aria || i}`, key, ok: true, skipped: "disabled" });
        continue;
      }
      if (/退出|注销|解绑|删除/.test(`${info.text} ${info.aria}`)) continue;
      seen.add(key);
      await closeTransientUi(page);
      await safeClick(page, control, result, `generic:${info.text || info.id || info.aria || i}`);
      await closeTransientUi(page);
    }
  }

  result.pages.push({ label: `${viewportName}-after-generic-clicks`, url: page.url(), title: cleanText(await page.title()) });
}

async function collectLinks(page, result) {
  const links = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent?.trim() || "",
    href: node.href,
    target: node.getAttribute("target") || ""
  })));
  result.links.push(...sanitizeValue(links));
}

async function clickByTextOrSelector(page, result, label, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await safeClick(page, locator, result, label);
      return true;
    }
  }
  result.clicked.push({ label: cleanText(label), ok: true, skipped: "not visible in current state" });
  return false;
}

async function fillIfVisible(page, selectors, value, result, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.fill(value);
      result.forms.push({ label, selector, ok: true, masked: maskIfSecret(label, value) });
      return true;
    }
  }
  result.forms.push({ label: cleanText(label), ok: true, skipped: "not visible in current state" });
  return false;
}

async function safeClick(page, locator, result, label) {
  const beforeUrl = page.url();
  const beforeText = await visibleTextDigest(page);
  const info = await describeControl(locator).catch(() => ({}));
  const entry = { label: cleanText(label), key: `${info.tag || ""}|${info.id || ""}|${info.text || ""}|${info.aria || ""}`, info, beforeUrl };
  try {
    await locator.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    entry.afterUrl = page.url();
    entry.changed = entry.afterUrl !== beforeUrl || beforeText !== await visibleTextDigest(page);
    entry.ok = true;
  } catch (error) {
    entry.ok = false;
    entry.error = cleanText(error instanceof Error ? error.message : String(error));
    report.fixesNeeded.push({ label: cleanText(label), error: entry.error });
  }
  result.clicked.push(entry);
}

async function describeControl(locator) {
  return locator.evaluate(node => ({
    tag: node.tagName.toLowerCase(),
    id: node.id || "",
    text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || "",
    aria: node.getAttribute("aria-label") || "",
    disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true")
  })).then(value => sanitizeValue(value));
}

async function visibleTextDigest(page) {
  return page.locator("body").evaluate(body => body.innerText.replace(/\s+/g, " ").trim().slice(0, 2000)).catch(() => "");
}

async function tryZlibLogin(context) {
  if (!ZLIB_EMAIL || !ZLIB_PASSWORD) return { ok: false, error: "missing zlib test credentials" };
  try {
    const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: ZLIB_EMAIL, password: ZLIB_PASSWORD },
      timeout: 25000
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    return {
      ok: response.ok(),
      status: response.status(),
      body: redactAuthBody(body)
    };
  } catch (error) {
    return { ok: false, error: cleanText(error instanceof Error ? error.message : String(error)) };
  }
}

async function saveAIConfig(context) {
  if (!AI_API_KEY) return { ok: false, error: "missing AI API key" };
  try {
    const response = await context.request.put(`${BASE_URL}/api/ai/config`, {
      data: { baseURL: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL },
      timeout: 15000
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    return {
      ok: response.ok(),
      status: response.status(),
      body: redactAuthBody(body)
    };
  } catch (error) {
    return { ok: false, error: cleanText(error instanceof Error ? error.message : String(error)) };
  }
}

function attachContextLogging(context) {
  context.setDefaultTimeout(8000);
}

async function launchChromium() {
  const executablePath = findInstalledChromium();
  return chromium.launch({
    headless: true,
    executablePath
  });
}

function findInstalledChromium() {
  const browserRoot = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(browserRoot)) return undefined;
  const candidates = fs.readdirSync(browserRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith("chromium-"))
    .map(entry => path.join(browserRoot, entry.name, "chrome-win64", "chrome.exe"))
    .filter(filePath => fs.existsSync(filePath));
  return candidates[0];
}

async function startServer(extraEnv) {
  const parsed = new URL(BASE_URL);
  const env = {
    ...process.env,
    ...extraEnv,
    HOST: parsed.hostname,
    PORT: parsed.port || "4173",
    SMARTREAD_DATA_DIR: path.join(OUT_DIR, `data-${extraEnv.SMARTREAD_BOOK_SOURCE || "web"}`),
    SMARTREAD_SESSION_SECRET: "full-audit-session-secret",
    SMARTREAD_ENCRYPTION_SECRET: "full-audit-encryption-secret",
    SMARTREAD_EMAIL_CODE_COOLDOWN_MS: "1000"
  };
  const stdout = fs.createWriteStream(path.join(OUT_DIR, `server-${extraEnv.SMARTREAD_BOOK_SOURCE || "web"}.out.log`));
  const stderr = fs.createWriteStream(path.join(OUT_DIR, `server-${extraEnv.SMARTREAD_BOOK_SOURCE || "web"}.err.log`));
  const child = spawn(process.execPath, [path.join(ROOT, "dist", "server", "index.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  for (let i = 0; i < 80; i += 1) {
    if (await healthOk(BASE_URL)) {
      return {
        stop: async () => {
          if (!child.killed) child.kill();
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 3000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Server did not start at ${BASE_URL}`);
}

function healthOk(baseUrl) {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}/api/health`, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function redactAuthBody(body) {
  if (!body || typeof body !== "object") return body;
  const copy = JSON.parse(JSON.stringify(body));
  if (copy.user?.email) copy.user.email = maskEmail(copy.user.email);
  if (copy.keyPreview) copy.keyPreview = String(copy.keyPreview);
  return copy;
}

async function closeTransientUi(page) {
  await page.keyboard.press("Escape").catch(() => undefined);
  const closers = [
    "button[aria-label*='关闭']",
    "button:has-text('✓')",
    "button:has-text('关闭')",
    "#overlay:not(.hidden)"
  ];
  for (const selector of closers) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(150).catch(() => undefined);
    }
  }
}

function resultNote(target, message) {
  target.notes ||= [];
  target.notes.push(cleanText(message));
}

function sanitizeValue(value) {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[\ud800-\udfff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function maskEmail(email) {
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

function maskIfSecret(label, value) {
  if (/key|password/i.test(label)) return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
  return value;
}

function writeReport() {
  const safeReport = sanitizeValue(report);
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(safeReport, null, 2), "utf8");
  const lines = [
    "# Full Button Audit",
    "",
    `- Started: ${safeReport.startedAt}`,
    `- Finished: ${safeReport.finishedAt || "failed"}`,
    `- Base URL: ${safeReport.baseUrl}`,
    `- Z-Library login: ${safeReport.zlibLogin?.ok ? "passed" : "failed"}${safeReport.zlibLogin?.usedMockFallback ? " (mock fallback used)" : ""}`,
    `- AI config: ${safeReport.aiConfig?.ok ? "passed" : "failed"}`,
    `- Viewports: ${safeReport.viewports.map(view => view.name).join(", ")}`,
    `- Network errors: ${safeReport.networkErrors.length}`,
    `- Console warnings/errors: ${safeReport.consoleErrors.length}`,
    `- Page errors: ${safeReport.pageErrors.length}`,
    "",
    "## Clicked Controls",
    ...safeReport.viewports.flatMap(view => [
      "",
      `### ${view.name}`,
      ...view.clicked.map(item => `- ${item.ok ? "OK" : "FAIL"} ${item.label}: ${item.info?.text || item.info?.id || item.reason || item.error || ""}${item.skipped ? ` (${item.skipped})` : ""}`)
    ])
  ];
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), lines.join("\n"), "utf8");
}
