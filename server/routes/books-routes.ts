import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import type { ServerBookRecord } from "../types.js";

export function toPublicBook(record: ServerBookRecord) {
  return {
    id: record.id,
    source: record.source,
    sourceId: record.source_id,
    title: record.title,
    authors: JSON.parse(record.authors_json || "[]") as string[],
    coverUrl: record.cover_url,
    year: record.year,
    language: record.language,
    extension: record.extension,
    sizeLabel: record.size_label,
    mimeType: record.mime_type,
    status: record.status,
    currentPage: record.current_page,
    currentCfi: record.current_cfi,
    progress: record.progress,
    totalPages: record.total_pages,
    addedAt: record.added_at,
    lastRead: record.last_read
  };
}

export async function registerBooksRoutes(app: FastifyInstance, db: AppDatabase, config: AppConfig) {
  const ctx = { db, config };

  app.get("/api/books", async (request) => {
    const user = requireUser(ctx, request);
    const rows = db.all<ServerBookRecord>(
      "SELECT * FROM books WHERE user_id = ? ORDER BY added_at DESC",
      user.id
    );
    return { books: rows.map(toPublicBook) };
  });

  app.get("/api/books/:id/file", async (request, reply) => {
    const user = requireUser(ctx, request);
    const id = (request.params as { id: string }).id;
    const book = db.get<ServerBookRecord>(
      "SELECT * FROM books WHERE id = ? AND user_id = ?",
      id,
      user.id
    );
    if (!book) return reply.code(404).send({ error: "找不到这本书" });

    const resolvedDataDir = path.resolve(config.dataDir);
    const resolvedFile = path.resolve(book.file_path);
    if (!resolvedFile.startsWith(resolvedDataDir + path.sep)) {
      return reply.code(500).send({ error: "书籍文件路径异常" });
    }
    if (!fs.existsSync(resolvedFile)) return reply.code(404).send({ error: "文件不存在" });

    reply.header("Content-Disposition", `inline; filename="${book.id}.${book.extension}"`);
    return reply.type(book.mime_type).send(fs.createReadStream(resolvedFile));
  });

  app.delete("/api/books/:id", async (request, reply) => {
    const user = requireUser(ctx, request);
    const id = (request.params as { id: string }).id;
    const book = db.get<ServerBookRecord>(
      "SELECT * FROM books WHERE id = ? AND user_id = ?",
      id,
      user.id
    );
    if (!book) return reply.code(404).send({ error: "找不到这本书" });

    const resolvedDataDir = path.resolve(config.dataDir);
    const resolvedFile = path.resolve(book.file_path);
    if (!resolvedFile.startsWith(resolvedDataDir + path.sep)) {
      return reply.code(500).send({ error: "书籍文件路径异常" });
    }

    db.run("DELETE FROM books WHERE id = ? AND user_id = ?", id, user.id);
    fs.rmSync(path.dirname(resolvedFile), { recursive: true, force: true });
    return { ok: true };
  });

  app.patch("/api/books/:id/progress", async (request, reply) => {
    const user = requireUser(ctx, request);
    const id = (request.params as { id: string }).id;
    const body = (request.body || {}) as {
      currentPage?: number;
      currentCfi?: string | null;
      progress?: number;
      totalPages?: number | null;
      lastRead?: number;
    };
    const book = db.get<ServerBookRecord>(
      "SELECT * FROM books WHERE id = ? AND user_id = ?",
      id,
      user.id
    );
    if (!book) return reply.code(404).send({ error: "找不到这本书" });

    const currentPage = Number.isFinite(body.currentPage) ? Math.max(0, Number(body.currentPage)) : book.current_page;
    const progress = Number.isFinite(body.progress)
      ? Math.max(0, Math.min(100, Number(body.progress)))
      : book.progress;
    const totalPages = Number.isFinite(body.totalPages) ? Math.max(0, Number(body.totalPages)) : book.total_pages;
    const lastRead = Number.isFinite(body.lastRead) ? Number(body.lastRead) : Date.now();
    db.run(
      `UPDATE books
       SET current_page = ?, current_cfi = ?, progress = ?, total_pages = ?, last_read = ?
       WHERE id = ? AND user_id = ?`,
      currentPage,
      body.currentCfi || null,
      progress,
      totalPages,
      lastRead,
      id,
      user.id
    );
    const updated = db.get<ServerBookRecord>("SELECT * FROM books WHERE id = ? AND user_id = ?", id, user.id);
    return { book: updated ? toPublicBook(updated) : null };
  });
}
