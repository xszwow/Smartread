import path from "node:path";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import type { BookSourceAdapter } from "./adapters/book-source.js";
import { MockBookSourceAdapter } from "./adapters/mock-source.js";
import { ZlibraryNodeAdapter } from "./adapters/zlibrary-node-adapter.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerBooksRoutes } from "./routes/books-routes.js";
import { registerZlibRoutes } from "./routes/zlib-routes.js";
import { registerAIRoutes, type FetchLike } from "./routes/ai-routes.js";
import { createEmailService, type EmailService } from "./email.js";
import { ZlibMirrorResolver } from "./zlib-mirror-resolver.js";

export type BuildAppOptions = {
  config?: Partial<AppConfig>;
  db?: AppDatabase;
  adapter?: BookSourceAdapter;
  emailService?: EmailService;
  fetch?: FetchLike;
  zlibMirrorResolver?: ZlibMirrorResolver;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const config = loadConfig(options.config);
  const db = options.db || new AppDatabase(config.dbPath);
  const zlibMirrorResolver = options.zlibMirrorResolver || new ZlibMirrorResolver(config);
  const adapter = options.adapter || (
    config.bookSource === "mock"
      ? new MockBookSourceAdapter()
      : new ZlibraryNodeAdapter({
          zlibDomain: config.zlibDomain,
          zlibLoginDomain: config.zlibLoginDomain,
          requestTimeoutMs: config.zlibRequestTimeoutMs,
          mirrorResolver: zlibMirrorResolver
        })
  );
  const emailService = options.emailService || createEmailService(config, options.fetch);

  const app = Fastify({ logger: true });
  app.decorate("smartreadDb", db);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !isAllowedOrigin(config, origin)) return;

    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-credentials", "true");
    reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.addHook("onClose", async () => {
    db.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = (error as Error & { statusCode?: number }).statusCode || 500;
    const message = error instanceof Error ? error.message : "Internal server error";
    if (status >= 500) {
      app.log.error({
        err: {
          name: error instanceof Error ? error.name : "Error",
          message,
          code: (error as Error & { code?: string }).code,
          status
        }
      }, message);
    }
    reply.code(status).send({ error: message });
  });

  await app.register(fastifyCookie, {
    secret: config.sessionSecret
  });

  app.get("/api/health", async () => ({
    ok: true,
    deploymentMode: config.deploymentMode
  }));

  await registerAuthRoutes(app, db, config, adapter, emailService, zlibMirrorResolver);
  await registerBooksRoutes(app, db, config);
  await registerZlibRoutes(app, db, config, adapter, zlibMirrorResolver);
  await registerAIRoutes(app, db, config, options.fetch);

  await app.register(fastifyStatic, {
    root: config.frontendDir,
    prefix: "/",
    index: "index.html",
    allowedPath: (filePath) => isAllowedStaticPath(config.frontendDir, filePath)
  });

  return app;
}

function isAllowedStaticPath(frontendDir: string, filePath: string): boolean {
  const rel = filePath.startsWith("/")
    ? decodeURIComponent(filePath).replace(/^\/+/, "")
    : path.relative(frontendDir, filePath).replace(/\\/g, "/");
  if (rel.startsWith("../") || path.isAbsolute(rel)) return false;
  if (rel === "" || rel === "index.html" || rel === "index.css") return true;
  return rel.startsWith("css/") || rel.startsWith("js/") || rel.startsWith("images/");
}

function isAllowedOrigin(config: AppConfig, origin: string): boolean {
  return config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}
