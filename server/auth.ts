import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { newSessionId } from "./security.js";
import type { AuthState, PublicUser, SessionRecord, UserRecord } from "./types.js";

const COOKIE_NAME = "smartread_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthContext = {
  db: AppDatabase;
  config: AppConfig;
};

export function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email };
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, sessionId: string, expiresAt: number) {
  reply.setCookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: "/",
    expires: new Date(expiresAt)
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    path: "/"
  });
}

export function createSession(ctx: AuthContext, reply: FastifyReply, userId: string) {
  const now = Date.now();
  const sessionId = newSessionId();
  const expiresAt = now + SESSION_TTL_MS;
  ctx.db.run(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    sessionId,
    userId,
    expiresAt,
    now
  );
  setSessionCookie(reply, ctx.config, sessionId, expiresAt);
}

export function currentSessionId(request: FastifyRequest): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[COOKIE_NAME];
}

export function getCurrentUser(ctx: AuthContext, request: FastifyRequest): PublicUser | null {
  const sessionId = currentSessionId(request);
  if (!sessionId) return null;
  const session = ctx.db.get<SessionRecord>(
    "SELECT * FROM sessions WHERE id = ?",
    sessionId
  );
  if (!session || session.expires_at <= Date.now()) {
    if (session) ctx.db.run("DELETE FROM sessions WHERE id = ?", sessionId);
    return null;
  }
  const user = ctx.db.get<UserRecord>("SELECT * FROM users WHERE id = ?", session.user_id);
  return user ? publicUser(user) : null;
}

export function requireUser(ctx: AuthContext, request: FastifyRequest): PublicUser {
  const user = getCurrentUser(ctx, request);
  if (!user) {
    const error = new Error("请先登录 SmartRead") as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }
  return user;
}

export function authState(ctx: AuthContext, user: PublicUser | null): AuthState {
  if (!user) return { user: null, aiConfigured: false, zlibBound: false };
  const ai = ctx.db.get<{ user_id: string }>(
    "SELECT user_id FROM user_ai_configs WHERE user_id = ?",
    user.id
  );
  const zlib = ctx.db.get<{ user_id: string }>(
    "SELECT user_id FROM zlib_credentials WHERE user_id = ?",
    user.id
  );
  return { user, aiConfigured: Boolean(ai), zlibBound: Boolean(zlib) };
}
