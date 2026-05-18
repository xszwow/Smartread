import { createRequire } from "node:module";
import type { AppConfig } from "./config.js";

const require = createRequire(import.meta.url);

export type ZlibEgressRoute = {
  id: string;
  kind: "direct" | "proxy";
  label: string;
  proxyUrl: string | null;
  preferred: boolean;
};

const PROXY_URL_PATTERN = /^(https?|socks4a?|socks5h?):\/\//i;

export function zlibEgressRoutes(config: AppConfig): ZlibEgressRoute[] {
  const proxies = config.zlibProxyUrls
    .map(raw => parseProxyEntry(raw, config.zlibProxyPreferKeywords))
    .filter((entry): entry is ZlibEgressRoute => Boolean(entry));
  const routes: ZlibEgressRoute[] = [];
  if (config.zlibEgressMode !== "proxy") {
    routes.push({
      id: "direct",
      kind: "direct",
      label: "直连",
      proxyUrl: null,
      preferred: false
    });
  }
  if (config.zlibEgressMode !== "direct") {
    routes.push(...sortProxyRoutes(proxies));
  }
  return routes;
}

export function redactProxyUrl(proxyUrl: string | null | undefined): string | undefined {
  if (!proxyUrl) return undefined;
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "***";
    }
    return url.toString();
  } catch {
    return proxyUrl.replace(/\/\/[^/@\s]+@/, "//***:***@");
  }
}

export function createProxyAgents(proxyUrl: string): { httpAgent: unknown; httpsAgent: unknown } {
  if (/^socks/i.test(proxyUrl)) {
    const { SocksProxyAgent } = require("socks-proxy-agent");
    const agent = new SocksProxyAgent(proxyUrl);
    return { httpAgent: agent, httpsAgent: agent };
  }
  const { HttpProxyAgent } = require("http-proxy-agent");
  const { HttpsProxyAgent } = require("https-proxy-agent");
  return {
    httpAgent: new HttpProxyAgent(proxyUrl),
    httpsAgent: new HttpsProxyAgent(proxyUrl)
  };
}

function parseProxyEntry(raw: string, preferKeywords: string[]): ZlibEgressRoute | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let label = "";
  let proxyUrl = trimmed;
  const equalIndex = trimmed.indexOf("=");
  const pipeIndex = trimmed.indexOf("|");
  if (equalIndex > 0 && PROXY_URL_PATTERN.test(trimmed.slice(equalIndex + 1).trim())) {
    label = trimmed.slice(0, equalIndex).trim();
    proxyUrl = trimmed.slice(equalIndex + 1).trim();
  } else if (pipeIndex > 0 && PROXY_URL_PATTERN.test(trimmed.slice(pipeIndex + 1).trim())) {
    label = trimmed.slice(0, pipeIndex).trim();
    proxyUrl = trimmed.slice(pipeIndex + 1).trim();
  }

  if (!PROXY_URL_PATTERN.test(proxyUrl)) return null;

  try {
    const url = new URL(proxyUrl);
    if (!label && url.hash) label = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    proxyUrl = url.toString();
    if (!label) label = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return null;
  }

  const haystack = `${label} ${proxyUrl}`.toLowerCase();
  const preferred = preferKeywords.some(keyword => keyword && haystack.includes(keyword.toLowerCase()));
  return {
    id: `proxy:${label}:${proxyUrl}`,
    kind: "proxy",
    label,
    proxyUrl,
    preferred
  };
}

function sortProxyRoutes(routes: ZlibEgressRoute[]): ZlibEgressRoute[] {
  return [...routes].sort((a, b) => Number(b.preferred) - Number(a.preferred));
}
