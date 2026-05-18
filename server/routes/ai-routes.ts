import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { decryptJson, encryptJson } from "../security.js";
import type { UserAIConfigRecord } from "../types.js";

export type FetchLike = typeof fetch;

type AIConfigBody = {
  baseURL?: string;
  apiKey?: string;
  model?: string;
};

type AIChatBody = {
  model?: string;
  messages?: unknown;
  stream?: boolean;
};

type DecryptedAIKey = {
  apiKey: string;
};

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_AI_MODEL = "gpt-5.5";

export async function registerAIRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  config: AppConfig,
  fetchImpl: FetchLike = globalThis.fetch
) {
  const ctx = { db, config };

  app.get("/api/ai/config/status", async (request) => {
    const user = requireUser(ctx, request);
    const row = getAIConfig(db, user.id);
    if (!row) return { configured: false, baseURL: DEFAULT_AI_BASE_URL, model: DEFAULT_AI_MODEL };

    let keyPreview = "";
    try {
      keyPreview = maskApiKey(decryptAIKey(row, config));
    } catch {
      keyPreview = "";
    }
    return {
      configured: Boolean(keyPreview),
      baseURL: row.base_url,
      model: row.model,
      keyPreview
    };
  });

  app.put("/api/ai/config", async (request, reply) => {
    const user = requireUser(ctx, request);
    const body = (request.body || {}) as AIConfigBody;
    const baseURL = normalizeAIBaseURL(body.baseURL || DEFAULT_AI_BASE_URL);
    if (!baseURL) return reply.code(400).send({ error: "API Base URL 必须是 http/https 地址" });

    const model = String(body.model || DEFAULT_AI_MODEL).trim();
    if (!model) return reply.code(400).send({ error: "请输入模型名称" });

    const existing = getAIConfig(db, user.id);
    const rawApiKey = String(body.apiKey || "").trim();
    if (!rawApiKey && !existing) return reply.code(400).send({ error: "请输入 API Key" });
    const encryptedApiKey = rawApiKey
      ? encryptJson({ apiKey: rawApiKey }, config.encryptionSecret)
      : existing?.encrypted_api_key;
    if (!encryptedApiKey) return reply.code(400).send({ error: "请输入 API Key" });

    const now = Date.now();
    db.run(
      `INSERT INTO user_ai_configs (user_id, base_url, encrypted_api_key, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         base_url = excluded.base_url,
         encrypted_api_key = excluded.encrypted_api_key,
         model = excluded.model,
         updated_at = excluded.updated_at`,
      user.id,
      baseURL,
      encryptedApiKey,
      model,
      existing?.created_at || now,
      now
    );

    const saved = getAIConfig(db, user.id);
    return {
      configured: true,
      baseURL: saved?.base_url || baseURL,
      model: saved?.model || model,
      keyPreview: rawApiKey ? maskApiKey(rawApiKey) : maskApiKey(decryptAIKey(saved!, config))
    };
  });

  app.post("/api/ai/chat", async (request, reply) => {
    const user = requireUser(ctx, request);
    const aiConfig = getAIConfig(db, user.id);
    if (!aiConfig) return reply.code(409).send({ error: "请先配置 AI API Key" });

    const body = (request.body || {}) as AIChatBody;
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return reply.code(400).send({ error: "缺少 messages" });
    }

    let apiKey: string;
    try {
      apiKey = decryptAIKey(aiConfig, config);
    } catch {
      return reply.code(409).send({ error: "AI API Key 配置异常，请重新保存" });
    }
    if (!apiKey) return reply.code(409).send({ error: "请先配置 AI API Key" });

    const url = toChatCompletionsURL(aiConfig.base_url);
    const payload = {
      model: String(body.model || aiConfig.model || DEFAULT_AI_MODEL),
      messages: body.messages,
      stream: Boolean(body.stream)
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.aiRequestTimeoutMs);
    let upstream: Response;
    try {
      upstream = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      const aborted = error instanceof Error && error.name === "AbortError";
      return reply.code(aborted ? 504 : 502).send({
        error: aborted ? "AI 请求超时" : "AI 服务暂时不可用"
      });
    }

    if (!upstream.ok) {
      clearTimeout(timeout);
      return reply.code(upstream.status >= 500 ? 502 : upstream.status).send({
        error: `AI 服务错误 (${upstream.status})`
      });
    }

    if (!payload.stream) {
      clearTimeout(timeout);
      const text = await upstream.text();
      try {
        return JSON.parse(text);
      } catch {
        return { choices: [{ message: { content: text } }] };
      }
    }

    if (!upstream.body) {
      clearTimeout(timeout);
      return reply.code(502).send({ error: "AI 服务没有返回流式内容" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    try {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) reply.raw.write(Buffer.from(value));
      }
    } catch {
      if (!reply.raw.destroyed) {
        reply.raw.write(`data: ${JSON.stringify({ error: "AI 流式响应中断" })}\n\n`);
      }
    } finally {
      clearTimeout(timeout);
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}

function getAIConfig(db: AppDatabase, userId: string): UserAIConfigRecord | undefined {
  return db.get<UserAIConfigRecord>("SELECT * FROM user_ai_configs WHERE user_id = ?", userId);
}

function decryptAIKey(row: UserAIConfigRecord, config: AppConfig): string {
  const value = decryptJson<DecryptedAIKey | string>(row.encrypted_api_key, config.encryptionSecret);
  return typeof value === "string" ? value : value.apiKey;
}

function normalizeAIBaseURL(value: string): string | null {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function toChatCompletionsURL(baseURL: string): string {
  const normalized = normalizeAIBaseURL(baseURL) || DEFAULT_AI_BASE_URL;
  const url = new URL(normalized);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/chat/completions")) {
    if (!pathname.endsWith("/v1")) pathname += "/v1";
    pathname += "/chat/completions";
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return "";
  if (apiKey.length <= 10) return `${apiKey.slice(0, 2)}...${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}
