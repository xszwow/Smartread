export function zlibLoginFailure(error: unknown, timeoutMs: number): { statusCode: number; message: string } {
  const detail = error instanceof Error ? error.message : String(error);
  if (isTimeoutError(error, detail)) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return {
      statusCode: 504,
      message: `Z-Library 登录超时：已等待 ${seconds} 秒。可能是镜像响应慢或服务器出口网络不可达，请稍后重试；如果持续失败，可以在 .env.local 调大 ZLIB_TIMEOUT_MS，或配置 ZLIB_MIRRORS / ZLIB_PROXY_URLS。`
    };
  }
  return {
    statusCode: 401,
    message: `Z-Library 登录失败：${detail}`
  };
}

function isTimeoutError(error: unknown, detail: string): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return /timeout|timed out|exceeded|ETIMEDOUT|ECONNABORTED/i.test(`${code} ${detail}`);
}
