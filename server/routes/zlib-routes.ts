import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { decryptJson, encryptJson, mimeForExtension, newId, normalizeEmail, sanitizeFormat } from "../security.js";
import type { BookMetadata, DownloadJobRecord, ServerBookRecord, ZlibCredentialRecord } from "../types.js";
import type { BookSourceAdapter, ZlibSessionState } from "../adapters/book-source.js";
import { zlibLoginFailure } from "../zlib-errors.js";
import type { ZlibMirrorResolver } from "../zlib-mirror-resolver.js";
import { toPublicBook } from "./books-routes.js";

type DownloadBody = {
  sourceId?: string;
  format?: string;
  metadata?: BookMetadata;
};

type BindBody = {
  email?: string;
  password?: string;
};

export async function registerZlibRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  config: AppConfig,
  adapter: BookSourceAdapter,
  zlibMirrorResolver?: ZlibMirrorResolver
) {
  const ctx = { db, config };

  app.post("/api/book-sources/zlib/bind", async (request, reply) => {
    const user = requireUser(ctx, request);
    const body = (request.body || {}) as BindBody;
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
    return { ok: true, zlibBound: true, boundEmail: email };
  });

  app.post("/api/book-sources/zlib/unbind", async (request) => {
    const user = requireUser(ctx, request);
    db.run("DELETE FROM zlib_credentials WHERE user_id = ?", user.id);
    return { ok: true, zlibBound: false };
  });

  app.get("/api/zlib/search", async (request, reply) => {
    const user = requireUser(ctx, request);
    const query = request.query as { q?: string; page?: string; format?: string };
    const q = String(query.q || "").trim();
    if (!q) return reply.code(400).send({ error: "请输入搜索关键词" });
    const page = Math.max(1, Number(query.page || 1) || 1);
    const format = query.format ? sanitizeFormat(query.format) : undefined;
    const session = getBoundSession(db, config, user.id);
    if (!session) return reply.code(409).send({ error: "请先绑定 Z-Library 书源" });

    const result = await adapter.search(session, { q, page, format });
    const totalPages = Number.isFinite(result.totalPages) && Number(result.totalPages) > 0
      ? Number(result.totalPages)
      : null;
    return {
      ...result,
      totalPages,
      hasNext: typeof result.hasNext === "boolean"
        ? result.hasNext
        : totalPages !== null
          ? page < totalPages
          : result.results.length > 0
    };
  });

  app.post("/api/zlib/download", async (request, reply) => {
    const user = requireUser(ctx, request);
    const body = (request.body || {}) as DownloadBody;
    if (!body.sourceId) return reply.code(400).send({ error: "缺少书籍来源 ID" });
    const format = sanitizeFormat(body.format || body.metadata?.extension || "");
    const session = getBoundSession(db, config, user.id);
    if (!session) return reply.code(409).send({ error: "请先绑定 Z-Library 书源" });

    const now = Date.now();
    const jobId = newId("job");
    const metadata = normalizeMetadata(body.sourceId, format, body.metadata);
    db.run(
      `INSERT INTO download_jobs
       (id, user_id, source, source_id, status, format, book_id, error, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'zlib', ?, 'queued', ?, NULL, NULL, ?, ?, ?)`,
      jobId,
      user.id,
      body.sourceId,
      format,
      JSON.stringify(metadata),
      now,
      now
    );

    void processDownloadJob(db, config, adapter, user.id, jobId, session).catch(error => {
      app.log.error({ err: error, jobId }, "download job crashed");
    });

    return reply.code(202).send({ jobId, status: "queued" });
  });

  app.get("/api/downloads/:jobId", async (request, reply) => {
    const user = requireUser(ctx, request);
    const jobId = (request.params as { jobId: string }).jobId;
    const job = db.get<DownloadJobRecord>(
      "SELECT * FROM download_jobs WHERE id = ? AND user_id = ?",
      jobId,
      user.id
    );
    if (!job) return reply.code(404).send({ error: "找不到下载任务" });
    const book = job.book_id
      ? db.get<ServerBookRecord>("SELECT * FROM books WHERE id = ? AND user_id = ?", job.book_id, user.id)
      : undefined;
    return {
      job: {
        id: job.id,
        status: job.status,
        sourceId: job.source_id,
        format: job.format,
        error: job.error,
        bookId: job.book_id,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        book: book ? toPublicBook(book) : null
      }
    };
  });
}

async function zlibRegisterUrl(config: AppConfig, resolver?: ZlibMirrorResolver): Promise<string> {
  if (!resolver) return config.zlibRegisterUrl;
  return resolver.registerUrl();
}

function getBoundSession(db: AppDatabase, config: AppConfig, userId: string): ZlibSessionState | null {
  const cred = db.get<ZlibCredentialRecord>(
    "SELECT * FROM zlib_credentials WHERE user_id = ?",
    userId
  );
  if (!cred) return null;
  return decryptJson<ZlibSessionState>(cred.encrypted_session, config.encryptionSecret);
}

function normalizeMetadata(sourceId: string, format: "epub" | "pdf" | "txt", metadata?: BookMetadata): BookMetadata {
  return {
    sourceId,
    title: String(metadata?.title || sourceId),
    authors: Array.isArray(metadata?.authors) ? metadata.authors.filter(Boolean) : [],
    coverUrl: metadata?.coverUrl || null,
    year: metadata?.year || null,
    language: metadata?.language || null,
    extension: format,
    sizeLabel: metadata?.sizeLabel || null,
    rating: metadata?.rating || null,
    sourceUrl: metadata?.sourceUrl || null,
    downloadPath: metadata?.downloadPath || null
  };
}

async function processDownloadJob(
  db: AppDatabase,
  config: AppConfig,
  adapter: BookSourceAdapter,
  userId: string,
  jobId: string,
  session: ZlibSessionState
) {
  const job = db.get<DownloadJobRecord>(
    "SELECT * FROM download_jobs WHERE id = ? AND user_id = ?",
    jobId,
    userId
  );
  if (!job) return;
  db.run("UPDATE download_jobs SET status = 'running', updated_at = ? WHERE id = ?", Date.now(), jobId);
  const metadata = JSON.parse(job.metadata_json || "{}") as BookMetadata;
  try {
    const download = await adapter.download(session, {
      sourceId: job.source_id,
      format: sanitizeFormat(job.format),
      metadata
    });
    const bookId = newId("book");
    const ext = sanitizeFormat(download.extension || job.format);
    const bookDir = path.join(config.dataDir, "books", userId, bookId);
    await fs.mkdir(bookDir, { recursive: true });
    const filePath = path.join(bookDir, `original.${ext}`);
    await fs.writeFile(filePath, download.bytes);

    const now = Date.now();
    db.run(
      `INSERT INTO books
       (id, user_id, source, source_id, title, authors_json, cover_url, year, language,
        extension, size_label, mime_type, file_path, status, current_page, current_cfi,
        progress, total_pages, added_at, last_read)
       VALUES (?, ?, 'zlib', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, NULL, 0, NULL, ?, ?)`,
      bookId,
      userId,
      job.source_id,
      metadata.title || job.source_id,
      JSON.stringify(metadata.authors || []),
      metadata.coverUrl || null,
      metadata.year || null,
      metadata.language || null,
      ext,
      metadata.sizeLabel || null,
      download.mimeType || mimeForExtension(ext),
      filePath,
      now,
      0
    );
    db.run(
      "UPDATE download_jobs SET status = 'saved', book_id = ?, error = NULL, updated_at = ? WHERE id = ?",
      bookId,
      Date.now(),
      jobId
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.run(
      "UPDATE download_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
      message,
      Date.now(),
      jobId
    );
  }
}
