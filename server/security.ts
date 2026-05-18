import crypto from "node:crypto";

const SESSION_BYTES = 32;
const IV_BYTES = 12;
const SCRYPT_KEY_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt);
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [, salt, expected] = hash.split("$");
  if (!salt || !expected) return false;
  const key = await scrypt(password, salt);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === key.length && crypto.timingSafeEqual(key, expectedBuffer);
}

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_BYTES, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function newId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function newSessionId(): string {
  return crypto.randomBytes(SESSION_BYTES).toString("base64url");
}

export function randomNumericCode(length = 6): string {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}

export function hmacSha256(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function encryptionKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptJson(value: unknown, secret: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: encrypted.toString("base64url")
  });
}

export function decryptJson<T>(payload: string, secret: string): T {
  const parsed = JSON.parse(payload) as { iv: string; tag: string; data: string };
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(parsed.iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function sanitizeFormat(value: string | null | undefined): "epub" | "pdf" | "txt" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "epub" || normalized === "pdf" || normalized === "txt") return normalized;
  throw new Error("暂不支持这个格式");
}

export function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "epub":
      return "application/epub+zip";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
