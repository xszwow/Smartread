import { createRequire } from "node:module";
import {
  defaultZlibLoginUrl,
  defaultZlibRegisterUrl,
  normalizeBaseUrl,
  type AppConfig
} from "./config.js";
import { ZlibClashController } from "./zlib-clash-controller.js";
import {
  createProxyAgents,
  redactProxyUrl,
  zlibEgressRoutes,
  type ZlibEgressRoute
} from "./zlib-proxy.js";

const require = createRequire(import.meta.url);

export type ZlibMirrorStatus = {
  domain: string;
  loginDomain: string;
  registerUrl: string;
  egress: "direct" | "proxy";
  proxyUrl?: string;
  proxyLabel?: string;
  proxyPreferred: boolean;
  loginOk: boolean;
  registerOk: boolean;
  latencyMs: number;
  checkedAt: number;
  error?: string;
};

export type ZlibMirrorSelection = {
  domain: string;
  loginDomain: string;
  registerUrl: string;
  egress: "direct" | "proxy";
  proxyUrl?: string;
  proxyLabel?: string;
  proxyPreferred: boolean;
  statuses: ZlibMirrorStatus[];
  checkedAt: number;
};

type ResolverOptions = {
  fetch?: typeof fetch;
  axiosRequest?: (options: Record<string, unknown>) => Promise<{ status: number }>;
  clashController?: ZlibClashController;
  now?: () => number;
};

const TEMPORARY_FAILURE_TTL_MS = 60 * 1000;

export class ZlibMirrorResolver {
  private readonly fetchImpl: typeof fetch;
  private readonly axiosRequest: (options: Record<string, unknown>) => Promise<{ status: number }>;
  private readonly clashController: ZlibClashController;
  private readonly now: () => number;
  private cached: ZlibMirrorSelection | null = null;
  private inFlight: Promise<ZlibMirrorSelection> | null = null;
  private failedUntil = new Map<string, number>();

  constructor(private readonly config: AppConfig, options: ResolverOptions = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.axiosRequest = options.axiosRequest || ((requestOptions) => {
      const axios = require("axios");
      return axios.request(requestOptions);
    });
    this.clashController = options.clashController || new ZlibClashController(config, {
      fetch: this.fetchImpl,
      now: options.now
    });
    this.now = options.now || (() => Date.now());
  }

  async resolve(options: { force?: boolean } = {}): Promise<ZlibMirrorSelection> {
    const now = this.now();
    if (!options.force && this.cached && now - this.cached.checkedAt < this.config.zlibMirrorCacheTtlMs) {
      return this.cached;
    }
    if (!options.force && this.inFlight) return this.inFlight;

    this.inFlight = this.probeMirrors();
    try {
      this.cached = await this.inFlight;
      return this.cached;
    } finally {
      this.inFlight = null;
    }
  }

  async registerUrl(): Promise<string> {
    try {
      return (await this.resolve()).registerUrl;
    } catch {
      return this.config.zlibRegisterUrl;
    }
  }

  current(): ZlibMirrorSelection {
    return this.cached || this.staticSelection();
  }

  markFailure(domain: string, proxyUrl?: string): void {
    const normalized = normalizeBaseUrl(domain);
    this.failedUntil.set(this.failureKey(normalized, proxyUrl), this.now() + TEMPORARY_FAILURE_TTL_MS);
    if (this.cached?.domain === normalized && this.cached.proxyUrl === proxyUrl) this.cached = null;
  }

  private async probeMirrors(): Promise<ZlibMirrorSelection> {
    const routes = zlibEgressRoutes(this.config);
    if (routes.some(route => route.kind === "proxy")) {
      await this.clashController.ensurePreferredGroup().catch(() => undefined);
    }
    const candidates = this.config.zlibMirrors.flatMap(domain =>
      routes.map(route => this.candidate(domain, route))
    );
    const statuses = await Promise.all(candidates.map(candidate => this.probe(candidate)));
    const now = this.now();
    const activeStatuses = statuses.filter(status =>
      (this.failedUntil.get(this.failureKey(status.domain, status.proxyUrl)) || 0) <= now
    );
    const pool = activeStatuses.length ? activeStatuses : statuses;
    const loginAndRegister = this.bestStatus(pool.filter(status => status.loginOk && status.registerOk));
    const loginOnly = this.bestStatus(pool.filter(status => status.loginOk));
    const selected = loginAndRegister || loginOnly || this.staticSelection().statuses[0];
    const registerSource = this.bestStatus(pool.filter(status => status.registerOk)) || selected;
    return {
      domain: selected.domain,
      loginDomain: selected.loginDomain,
      registerUrl: registerSource.registerUrl,
      egress: selected.egress,
      proxyUrl: selected.proxyUrl,
      proxyLabel: selected.proxyLabel,
      proxyPreferred: selected.proxyPreferred,
      statuses,
      checkedAt: now
    };
  }

  private candidate(domain: string, route: ZlibEgressRoute) {
    const normalized = normalizeBaseUrl(domain);
    return {
      domain: normalized,
      loginDomain: normalized === this.config.zlibDomain
        ? this.config.zlibLoginDomain
        : defaultZlibLoginUrl(normalized),
      registerUrl: normalized === this.config.zlibDomain
        ? this.config.zlibRegisterUrl
        : defaultZlibRegisterUrl(normalized),
      egress: route.kind,
      proxyUrl: route.proxyUrl || undefined,
      proxyLabel: route.kind === "proxy" ? route.label : undefined,
      proxyPreferred: route.preferred
    };
  }

  private async probe(candidate: {
    domain: string;
    loginDomain: string;
    registerUrl: string;
    egress: "direct" | "proxy";
    proxyUrl?: string;
    proxyLabel?: string;
    proxyPreferred: boolean;
  }): Promise<ZlibMirrorStatus> {
    const started = this.now();
    const [login, register] = await Promise.all([
      this.probeUrl(candidate.loginDomain, candidate),
      this.probeUrl(candidate.registerUrl, candidate)
    ]);
    const error = [login.error, register.error].filter(Boolean).join("; ") || undefined;
    return {
      ...candidate,
      loginOk: login.ok,
      registerOk: register.ok,
      latencyMs: this.now() - started,
      checkedAt: this.now(),
      error
    };
  }

  private async probeUrl(
    url: string,
    route: { egress: "direct" | "proxy"; proxyUrl?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    if (route.proxyUrl) return this.probeUrlViaAxios(url, route.proxyUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.zlibMirrorProbeTimeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SmartRead Z-Library mirror probe"
        }
      });
      return {
        ok: response.status >= 200 && response.status < 400,
        error: response.status >= 200 && response.status < 400 ? undefined : `${url} ${response.status}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `${url} ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeUrlViaAxios(url: string, proxyUrl: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.axiosRequest({
        url,
        method: "GET",
        timeout: this.config.zlibMirrorProbeTimeoutMs,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
          "user-agent": "SmartRead Z-Library mirror probe"
        },
        proxy: false,
        zlibProxyUrl: proxyUrl,
        ...createProxyAgents(proxyUrl)
      });
      return {
        ok: response.status >= 200 && response.status < 400,
        error: response.status >= 200 && response.status < 400
          ? undefined
          : `${url} via ${redactProxyUrl(proxyUrl)} ${response.status}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `${url} via ${redactProxyUrl(proxyUrl)} ${message}` };
    }
  }

  private bestStatus(statuses: ZlibMirrorStatus[]): ZlibMirrorStatus | null {
    if (!statuses.length) return null;
    return [...statuses].sort((a, b) => this.statusScore(b) - this.statusScore(a))[0] || null;
  }

  private statusScore(status: ZlibMirrorStatus): number {
    let score = 0;
    if (status.loginOk) score += 1000;
    if (status.registerOk) score += 100;
    if (status.proxyPreferred) score += 60;
    if (status.egress === "direct" && !this.config.zlibProxyUrls.length) score += 20;
    score -= Math.min(status.latencyMs, 10000) / 10000;
    return score;
  }

  private failureKey(domain: string, proxyUrl?: string): string {
    return `${normalizeBaseUrl(domain)}|${proxyUrl || "direct"}`;
  }

  private staticSelection(): ZlibMirrorSelection {
    const status: ZlibMirrorStatus = {
      domain: this.config.zlibDomain,
      loginDomain: this.config.zlibLoginDomain,
      registerUrl: this.config.zlibRegisterUrl,
      egress: "direct",
      proxyPreferred: false,
      loginOk: true,
      registerOk: true,
      latencyMs: 0,
      checkedAt: this.now()
    };
    return {
      domain: status.domain,
      loginDomain: status.loginDomain,
      registerUrl: status.registerUrl,
      egress: status.egress,
      proxyPreferred: status.proxyPreferred,
      statuses: [status],
      checkedAt: status.checkedAt
    };
  }
}
