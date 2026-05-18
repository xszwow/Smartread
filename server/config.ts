import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.basename(path.dirname(here)) === "dist"
  ? path.resolve(here, "../..")
  : path.resolve(here, "..");
export const DEFAULT_ZLIB_DOMAIN = "https://z-lib.fm";
export const DEFAULT_ZLIB_MIRRORS = [
  "https://z-lib.fm",
  "https://z-library.sk",
  "https://z-library.is"
];
export const DEFAULT_ZLIB_TIMEOUT_MS = 60000;
export const DEFAULT_ZLIB_MIRROR_PROBE_TIMEOUT_MS = 8000;
export const DEFAULT_ZLIB_MIRROR_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_ZLIB_PROXY_PREFER_KEYWORDS = ["日本", "jp", "japan"];
export const DEFAULT_ZLIB_CLASH_PROXY_URL = "http://127.0.0.1:7890";
export const DEFAULT_ZLIB_CLASH_SELECTOR = "🚀 节点选择";
export const DEFAULT_ZLIB_CLASH_PREFERRED_GROUP = "🇯🇵 日本优选";
export const DEFAULT_ZLIB_CLASH_SWITCH_TTL_MS = 30 * 1000;
export const DEFAULT_ZLIB_CLASH_TEST_URL = "http://www.gstatic.com/generate_204";

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(projectRoot, ".env.local"));

export type AppConfig = {
  host: string;
  port: number;
  deploymentMode: "web" | "desktop";
  projectRoot: string;
  frontendDir: string;
  dataDir: string;
  dbPath: string;
  sessionSecret: string;
  encryptionSecret: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "none" | "strict";
  allowedOrigins: string[];
  zlibDomain: string;
  zlibLoginDomain: string;
  zlibRegisterUrl: string;
  zlibMirrors: string[];
  zlibProxyUrls: string[];
  zlibEgressMode: "auto" | "direct" | "proxy";
  zlibProxyPreferKeywords: string[];
  zlibClashApiUrl: string;
  zlibClashApiSecret: string;
  zlibClashProxyUrl: string;
  zlibClashSelector: string;
  zlibClashPreferredGroup: string;
  zlibClashSwitchTtlMs: number;
  zlibClashTestUrl: string;
  zlibMirrorProbeTimeoutMs: number;
  zlibMirrorCacheTtlMs: number;
  zlibRequestTimeoutMs: number;
  bookSource: "zlibrary" | "mock";
  smartreadEmailProvider: "smtp" | "worker";
  smartreadSmtpHost: string;
  smartreadSmtpPort: number;
  smartreadSmtpSecure: boolean;
  smartreadSmtpUser: string;
  smartreadSmtpPass: string;
  smartreadSmtpFrom: string;
  smartreadWorkerMailBaseUrl: string;
  smartreadWorkerMailPath: string;
  smartreadWorkerMailAuthHeader: string;
  smartreadWorkerMailAuthToken: string;
  smartreadWorkerMailFrom: string;
  smartreadWorkerMailFromName: string;
  emailDomainWhitelist: string[];
  emailCodeTtlMs: number;
  emailCodeCooldownMs: number;
  aiRequestTimeoutMs: number;
};

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ||
    process.env.SMARTREAD_DATA_DIR ||
    path.join(projectRoot, "data");

  const sessionSecret = overrides.sessionSecret ||
    process.env.SMARTREAD_SESSION_SECRET ||
    "dev-smartread-session-secret-change-me";

  const zlibDomain = normalizeBaseUrl(overrides.zlibDomain || process.env.ZLIB_DOMAIN || DEFAULT_ZLIB_DOMAIN);
  const zlibLoginDomain = overrides.zlibLoginDomain ||
    process.env.ZLIB_LOGIN_DOMAIN ||
    defaultZlibLoginUrl(zlibDomain);
  const zlibRegisterUrl = overrides.zlibRegisterUrl ||
    process.env.ZLIB_REGISTER_URL ||
    defaultZlibRegisterUrl(zlibDomain);
  const zlibMirrors = uniqueUrls([
    zlibDomain,
    ...parseCsv(process.env.ZLIB_MIRRORS || ""),
    ...DEFAULT_ZLIB_MIRRORS
  ]);
  const deploymentMode = overrides.deploymentMode ||
    (process.env.SMARTREAD_DEPLOYMENT === "desktop" || process.env.SMARTREAD_DESKTOP === "1" ? "desktop" : "web");
  const zlibClashApiUrl = normalizeOptionalBaseUrl(overrides.zlibClashApiUrl || process.env.ZLIB_CLASH_API_URL || "");
  const zlibClashPreferredGroup = overrides.zlibClashPreferredGroup ||
    process.env.ZLIB_CLASH_PREFERRED_GROUP ||
    DEFAULT_ZLIB_CLASH_PREFERRED_GROUP;
  const zlibClashProxyUrl = overrides.zlibClashProxyUrl ||
    process.env.ZLIB_CLASH_PROXY_URL ||
    (zlibClashApiUrl || deploymentMode === "desktop" ? DEFAULT_ZLIB_CLASH_PROXY_URL : "");
  const zlibProxyUrls = uniqueList([
    ...(zlibClashProxyUrl ? [`${zlibClashPreferredGroup}=${zlibClashProxyUrl}`] : []),
    ...parseList(process.env.ZLIB_PROXY_URLS || ""),
    ...parseList(process.env.ZLIB_PROXY_URL || "")
  ]);

  return {
    host: overrides.host || process.env.HOST || (deploymentMode === "desktop" ? "127.0.0.1" : "0.0.0.0"),
    port: Number(overrides.port || process.env.PORT || 4173),
    deploymentMode,
    projectRoot: overrides.projectRoot || projectRoot,
    frontendDir: overrides.frontendDir || process.env.SMARTREAD_FRONTEND_DIR || projectRoot,
    dataDir,
    dbPath: overrides.dbPath || process.env.SMARTREAD_DB_PATH || path.join(dataDir, "smartread.sqlite"),
    sessionSecret,
    encryptionSecret: overrides.encryptionSecret ||
      process.env.SMARTREAD_ENCRYPTION_SECRET ||
      sessionSecret,
    cookieSecure: overrides.cookieSecure ?? process.env.SMARTREAD_COOKIE_SECURE === "1",
    cookieSameSite: overrides.cookieSameSite || parseCookieSameSite(process.env.SMARTREAD_COOKIE_SAMESITE),
    allowedOrigins: overrides.allowedOrigins || parseList(process.env.SMARTREAD_ALLOWED_ORIGINS || ""),
    zlibDomain,
    zlibLoginDomain,
    zlibRegisterUrl,
    zlibMirrors: overrides.zlibMirrors || zlibMirrors,
    zlibProxyUrls: overrides.zlibProxyUrls || zlibProxyUrls,
    zlibEgressMode: overrides.zlibEgressMode ||
      parseZlibEgressMode(process.env.ZLIB_EGRESS_MODE),
    zlibProxyPreferKeywords: overrides.zlibProxyPreferKeywords ||
      parseList(process.env.ZLIB_PROXY_PREFER_KEYWORDS || DEFAULT_ZLIB_PROXY_PREFER_KEYWORDS.join(",")),
    zlibClashApiUrl,
    zlibClashApiSecret: overrides.zlibClashApiSecret || process.env.ZLIB_CLASH_API_SECRET || "",
    zlibClashProxyUrl,
    zlibClashSelector: overrides.zlibClashSelector ||
      process.env.ZLIB_CLASH_SELECTOR ||
      DEFAULT_ZLIB_CLASH_SELECTOR,
    zlibClashPreferredGroup,
    zlibClashSwitchTtlMs: Number(
      overrides.zlibClashSwitchTtlMs ||
      process.env.ZLIB_CLASH_SWITCH_TTL_MS ||
      DEFAULT_ZLIB_CLASH_SWITCH_TTL_MS
    ),
    zlibClashTestUrl: overrides.zlibClashTestUrl ||
      process.env.ZLIB_CLASH_TEST_URL ||
      DEFAULT_ZLIB_CLASH_TEST_URL,
    zlibMirrorProbeTimeoutMs: Number(
      overrides.zlibMirrorProbeTimeoutMs ||
      process.env.ZLIB_MIRROR_PROBE_TIMEOUT_MS ||
      DEFAULT_ZLIB_MIRROR_PROBE_TIMEOUT_MS
    ),
    zlibMirrorCacheTtlMs: Number(
      overrides.zlibMirrorCacheTtlMs ||
      process.env.ZLIB_MIRROR_CACHE_TTL_MS ||
      DEFAULT_ZLIB_MIRROR_CACHE_TTL_MS
    ),
    zlibRequestTimeoutMs: Number(overrides.zlibRequestTimeoutMs || process.env.ZLIB_TIMEOUT_MS || DEFAULT_ZLIB_TIMEOUT_MS),
    bookSource: overrides.bookSource || (process.env.SMARTREAD_BOOK_SOURCE === "mock" ? "mock" : "zlibrary"),
    smartreadEmailProvider: overrides.smartreadEmailProvider ||
      (process.env.SMARTREAD_EMAIL_PROVIDER === "smtp" ? "smtp" : "worker"),
    smartreadSmtpHost: overrides.smartreadSmtpHost || process.env.SMARTREAD_SMTP_HOST || "",
    smartreadSmtpPort: Number(overrides.smartreadSmtpPort || process.env.SMARTREAD_SMTP_PORT || 587),
    smartreadSmtpSecure: overrides.smartreadSmtpSecure ?? parseBoolean(process.env.SMARTREAD_SMTP_SECURE, false),
    smartreadSmtpUser: overrides.smartreadSmtpUser || process.env.SMARTREAD_SMTP_USER || "",
    smartreadSmtpPass: overrides.smartreadSmtpPass || process.env.SMARTREAD_SMTP_PASS || "",
    smartreadSmtpFrom: overrides.smartreadSmtpFrom || process.env.SMARTREAD_SMTP_FROM || "",
    smartreadWorkerMailBaseUrl: overrides.smartreadWorkerMailBaseUrl ||
      process.env.SMARTREAD_WORKER_MAIL_BASE_URL ||
      "https://mail.example.com",
    smartreadWorkerMailPath: overrides.smartreadWorkerMailPath ||
      process.env.SMARTREAD_WORKER_MAIL_PATH ||
      "/admin/send_mail",
    smartreadWorkerMailAuthHeader: overrides.smartreadWorkerMailAuthHeader ||
      process.env.SMARTREAD_WORKER_MAIL_AUTH_HEADER ||
      "x-admin-auth",
    smartreadWorkerMailAuthToken: overrides.smartreadWorkerMailAuthToken ||
      process.env.SMARTREAD_WORKER_MAIL_AUTH_TOKEN ||
      "",
    smartreadWorkerMailFrom: overrides.smartreadWorkerMailFrom ||
      process.env.SMARTREAD_WORKER_MAIL_FROM ||
      process.env.SMARTREAD_SMTP_FROM ||
      "noreply@example.com",
    smartreadWorkerMailFromName: overrides.smartreadWorkerMailFromName ||
      process.env.SMARTREAD_WORKER_MAIL_FROM_NAME ||
      "智读 SmartRead",
    emailDomainWhitelist: overrides.emailDomainWhitelist ||
      parseCsv(process.env.SMARTREAD_EMAIL_WHITELIST || ""),
    emailCodeTtlMs: Number(overrides.emailCodeTtlMs || process.env.SMARTREAD_EMAIL_CODE_TTL_MS || 10 * 60 * 1000),
    emailCodeCooldownMs: Number(overrides.emailCodeCooldownMs || process.env.SMARTREAD_EMAIL_CODE_COOLDOWN_MS || 60 * 1000),
    aiRequestTimeoutMs: Number(overrides.aiRequestTimeoutMs || process.env.SMARTREAD_AI_TIMEOUT_MS || 60000)
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function parseZlibEgressMode(value: string | undefined): "auto" | "direct" | "proxy" {
  if (value === "direct" || value === "proxy") return value;
  return "auto";
}

function parseCookieSameSite(value: string | undefined): "lax" | "none" | "strict" {
  const normalized = value?.toLowerCase();
  if (normalized === "none" || normalized === "strict") return normalized;
  return "lax";
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    items.push(value);
  }
  return items;
}

export function defaultZlibRegisterUrl(domain: string): string {
  const base = normalizeBaseUrl(domain);
  return `${base}/registration?redirectUrl=${encodeURIComponent(base + "/")}`;
}

export function defaultZlibLoginUrl(domain: string): string {
  return `${normalizeBaseUrl(domain)}/rpc.php`;
}

export function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_ZLIB_DOMAIN;
  }
}

function normalizeOptionalBaseUrl(value: string): string {
  if (!value) return "";
  return normalizeBaseUrl(value);
}

function uniqueUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const normalized = normalizeBaseUrl(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
