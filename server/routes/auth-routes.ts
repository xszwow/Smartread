import type { FastifyInstance } from "fastify";
import {
  authState,
  clearSessionCookie,
  createSession,
  currentSessionId,
  getCurrentUser,
  publicUser
} from "../auth.js";
import type { BookSourceAdapter } from "../adapters/book-source.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { buildLoginCodeEmail, type EmailService } from "../email.js";
import { encryptJson, hmacSha256, newId, normalizeEmail, randomNumericCode } from "../security.js";
import type { EmailVerificationCodeRecord, UserRecord } from "../types.js";
import { zlibLoginFailure } from "../zlib-errors.js";
import type { ZlibMirrorResolver } from "../zlib-mirror-resolver.js";

type AuthBody = {
  email?: string;
  password?: string;
};

type EmailCodeBody = {
  email?: string;
  code?: string;
};

const EMAIL_PURPOSE_LOGIN = "login";
const MAX_CODE_ATTEMPTS = 5;
const DESKTOP_LOCAL_EMAIL = "local-desktop@smartread.local";

export async function registerAuthRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  config: AppConfig,
  adapter: BookSourceAdapter,
  emailService: EmailService,
  zlibMirrorResolver?: ZlibMirrorResolver
) {
  const ctx = { db, config };

  app.get("/api/auth/config", async (request) => {
    const query = (request.query || {}) as { probe?: string };
    const shouldProbe = query.probe === "1";
    const selection = shouldProbe && zlibMirrorResolver ? await zlibMirrorResolver.resolve().catch(() => null) : null;
    return {
      zlibRegisterUrl: selection?.registerUrl || config.zlibRegisterUrl,
      zlibMirror: selection?.domain || config.zlibDomain,
      zlibEgress: selection?.egress || "direct",
      zlibProxyLabel: selection?.proxyLabel || null,
      zlibMirrors: config.zlibMirrors,
      emailDomainWhitelist: config.emailDomainWhitelist,
      aiDefaults: {
        baseURL: "https://api.openai.com/v1/chat/completions",
        model: "gpt-5.5"
      }
    };
  });

  app.post("/api/auth/email/request", async (request, reply) => {
    const body = (request.body || {}) as EmailCodeBody;
    const email = normalizeEmail(body.email || "");
    const emailError = validateEmail(email, config.emailDomainWhitelist);
    if (emailError) return reply.code(400).send({ error: emailError });

    const now = Date.now();
    const latest = db.get<Pick<EmailVerificationCodeRecord, "created_at">>(
      `SELECT created_at FROM email_verification_codes
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      email,
      EMAIL_PURPOSE_LOGIN
    );
    if (latest && latest.created_at > now - config.emailCodeCooldownMs) {
      return reply.code(429).send({ error: "验证码发送太频繁，请稍后再试" });
    }

    const code = randomNumericCode(6);
    const codeId = newId("code");
    db.run(
      `INSERT INTO email_verification_codes
       (id, email, code_hash, purpose, expires_at, attempts, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
      codeId,
      email,
      hashEmailCode(email, code, config.encryptionSecret),
      EMAIL_PURPOSE_LOGIN,
      now + config.emailCodeTtlMs,
      now
    );

    try {
      const message = buildLoginCodeEmail(code);
      await emailService.send({ to: email, ...message });
    } catch (error) {
      db.run("DELETE FROM email_verification_codes WHERE id = ?", codeId);
      app.log.warn({
        err: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "Error"
        }
      }, "failed to send login code");
      return reply.code(503).send({ error: "验证码发送失败，请稍后再试" });
    }

    return {
      ok: true,
      expiresInMs: config.emailCodeTtlMs,
      cooldownMs: config.emailCodeCooldownMs
    };
  });

  app.post("/api/auth/email/verify", async (request, reply) => {
    const body = (request.body || {}) as EmailCodeBody;
    const email = normalizeEmail(body.email || "");
    const code = String(body.code || "").trim();
    const emailError = validateEmail(email, config.emailDomainWhitelist);
    if (emailError) return reply.code(400).send({ error: emailError });
    if (!/^\d{6}$/.test(code)) return reply.code(400).send({ error: "请输入 6 位验证码" });

    const now = Date.now();
    const record = db.get<EmailVerificationCodeRecord>(
      `SELECT * FROM email_verification_codes
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      email,
      EMAIL_PURPOSE_LOGIN
    );
    if (!record || record.expires_at <= now) {
      return reply.code(400).send({ error: "验证码无效或已过期" });
    }
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      return reply.code(429).send({ error: "验证码错误次数过多，请重新获取" });
    }

    const expected = hashEmailCode(email, code, config.encryptionSecret);
    if (record.code_hash !== expected) {
      const attempts = record.attempts + 1;
      db.run("UPDATE email_verification_codes SET attempts = ? WHERE id = ?", attempts, record.id);
      const status = attempts >= MAX_CODE_ATTEMPTS ? 429 : 400;
      const message = attempts >= MAX_CODE_ATTEMPTS
        ? "验证码错误次数过多，请重新获取"
        : "验证码错误";
      return reply.code(status).send({ error: message });
    }

    db.run(
      `UPDATE email_verification_codes
       SET consumed_at = ?
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
      now,
      email,
      EMAIL_PURPOSE_LOGIN
    );
    const user = ensureUser(db, email, now);
    createSession(ctx, reply, user.id);
    return authState(ctx, publicUser(user));
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = (request.body || {}) as AuthBody;
    const email = normalizeEmail(body.email || "");
    const password = String(body.password || "");
    if (!email.includes("@") || !password) {
      return reply.code(400).send({
        error: "请输入 Z-Library 邮箱和密码",
        zlibRegisterUrl: await zlibRegisterUrl(config, zlibMirrorResolver)
      });
    }

    let sessionState;
    try {
      sessionState = await adapter.login(email, password);
    } catch (error) {
      const failure = zlibLoginFailure(error, config.zlibRequestTimeoutMs);
      return reply.code(failure.statusCode).send({
        error: failure.message,
        zlibRegisterUrl: await zlibRegisterUrl(config, zlibMirrorResolver)
      });
    }

    const now = Date.now();
    const currentUser = getCurrentUser(ctx, request);
    const user = currentUser
      ? db.get<UserRecord>("SELECT * FROM users WHERE id = ?", currentUser.id) || ensureUser(db, currentUser.email, now)
      : ensureUser(db, email, now);

    db.run(
      `INSERT INTO zlib_credentials (user_id, bound_email, encrypted_session, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         bound_email = excluded.bound_email,
         encrypted_session = excluded.encrypted_session,
         updated_at = excluded.updated_at`,
      user.id,
      email,
      encryptJson(sessionState, config.encryptionSecret),
      now,
      now
    );

    if (!currentUser) createSession(ctx, reply, user.id);
    return {
      ...authState(ctx, publicUser(user)),
      zlibRegisterUrl: await zlibRegisterUrl(config, zlibMirrorResolver)
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = currentSessionId(request);
    if (sessionId) db.run("DELETE FROM sessions WHERE id = ?", sessionId);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    let user = getCurrentUser(ctx, request);
    if (!user && config.deploymentMode === "desktop") {
      const localUser = ensureUser(db, DESKTOP_LOCAL_EMAIL);
      createSession(ctx, reply, localUser.id);
      user = publicUser(localUser);
    }
    if (!user) clearSessionCookie(reply, config);
    return authState(ctx, user);
  });
}

function ensureUser(db: AppDatabase, email: string, now = Date.now()): UserRecord {
  let user = db.get<UserRecord>("SELECT * FROM users WHERE email = ?", email);
  if (user) return user;
  user = { id: newId("usr"), email, created_at: now };
  db.run(
    "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
    user.id,
    user.email,
    user.created_at
  );
  return user;
}

function validateEmail(email: string, whitelist: string[]): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请输入有效邮箱";
  const domain = email.split("@").pop()?.toLowerCase() || "";
  if (whitelist.length && !whitelist.includes(domain)) return "暂不支持这个邮箱域名";
  return null;
}

async function zlibRegisterUrl(config: AppConfig, resolver?: ZlibMirrorResolver): Promise<string> {
  if (!resolver) return config.zlibRegisterUrl;
  return resolver.registerUrl();
}

function hashEmailCode(email: string, code: string, secret: string): string {
  return hmacSha256(`${EMAIL_PURPOSE_LOGIN}:${email}:${code}`, secret);
}
