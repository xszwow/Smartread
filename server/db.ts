import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  run(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  private migrate() {
    this.resetLegacyAppAuthSchema();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS zlib_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bound_email TEXT NOT NULL,
        encrypted_session TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_email_codes_lookup
        ON email_verification_codes(email, purpose, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_email_codes_expires
        ON email_verification_codes(expires_at);

      CREATE TABLE IF NOT EXISTS user_ai_configs (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        base_url TEXT NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        authors_json TEXT NOT NULL DEFAULT '[]',
        cover_url TEXT,
        year TEXT,
        language TEXT,
        extension TEXT NOT NULL,
        size_label TEXT,
        mime_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        current_page INTEGER NOT NULL DEFAULT 0,
        current_cfi TEXT,
        progress REAL NOT NULL DEFAULT 0,
        total_pages INTEGER,
        added_at INTEGER NOT NULL,
        last_read INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_books_user_added ON books(user_id, added_at DESC);

      CREATE TABLE IF NOT EXISTS download_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        format TEXT NOT NULL,
        book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
        error TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_download_jobs_user_created
        ON download_jobs(user_id, created_at DESC);
    `);
  }

  private resetLegacyAppAuthSchema() {
    const columns = this.db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    const hasAppPasswordColumn = columns.some(column => column.name === "password_hash");
    if (!hasAppPasswordColumn) return;

    this.db.exec(`
      DROP TABLE IF EXISTS download_jobs;
      DROP TABLE IF EXISTS books;
      DROP TABLE IF EXISTS zlib_credentials;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
    `);
  }
}
