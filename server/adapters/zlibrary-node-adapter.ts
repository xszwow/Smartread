import { createRequire } from "node:module";
import { DEFAULT_ZLIB_DOMAIN, DEFAULT_ZLIB_TIMEOUT_MS, defaultZlibLoginUrl } from "../config.js";
import { mimeForExtension } from "../security.js";
import { createProxyAgents } from "../zlib-proxy.js";
import type { ZlibMirrorResolver, ZlibMirrorSelection } from "../zlib-mirror-resolver.js";
import type {
  BookSourceAdapter,
  DownloadRequest,
  DownloadResponse,
  SearchParams,
  SearchResponse,
  ZlibSessionState
} from "./book-source.js";

type AdapterOptions = {
  zlibDomain?: string;
  zlibLoginDomain?: string;
  requestTimeoutMs?: number;
  mirrorResolver?: ZlibMirrorResolver;
};

const require = createRequire(import.meta.url);
const DIRECT_SEARCH_PAGE_SIZE = 50;
const FALLBACK_SEARCH_PAGE_SIZE = 20;

export class ZlibraryNodeAdapter implements BookSourceAdapter {
  private readonly options: AdapterOptions;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AdapterOptions = {}) {
    this.options = options;
  }

  async login(email: string, password: string): Promise<ZlibSessionState> {
    return this.withExclusive(() => this.withMirrorRetry(async mirror => {
      const lib = this.createLib(mirror);
      await lib.login(email, password);
      const cookies = this.extractCookies(lib);
      if (!Object.keys(cookies).length) {
        throw new Error("ZLib login did not return a session");
      }
      return {
        cookies,
        mirror: lib.mirror,
        domain: lib.domain,
        createdAt: Date.now()
      };
    }));
  }

  async validateSession(session: ZlibSessionState): Promise<void> {
    await this.withExclusive(() => this.withMirrorRetry(async mirror => {
      const lib = this.restoreLib(session, mirror);
      await lib._r(`${lib.mirror}/users/downloads`);
    }));
  }

  async search(session: ZlibSessionState, params: SearchParams): Promise<SearchResponse> {
    return this.withExclusive(() => this.withMirrorRetry(async mirror => {
      const lib = this.restoreLib(session, mirror);
      const extensions = params.format ? [params.format.toUpperCase()] : ["EPUB", "PDF", "TXT"];
      const direct = await this.directSearch(lib, params, extensions);
      if (direct.results.length) return direct;

      try {
        const fallback = await this.searchWithPaginator(lib, params, extensions);
        if (fallback.results.length) {
          return {
            ...fallback,
            totalPages: fallback.totalPages ?? direct.totalPages
          };
        }
      } catch {
        // Keep the direct empty result as a recoverable no-results state.
      }

      return direct;
    }));
  }

  async download(session: ZlibSessionState, request: DownloadRequest): Promise<DownloadResponse> {
    return this.withExclusive(() => this.withMirrorRetry(async mirror => {
      const lib = this.restoreLib(session, mirror);
      if (request.metadata?.downloadPath) {
        const direct = await this.directDownload(lib, request);
        if (direct) return direct;
      }
      const book = await lib.getById(request.sourceId);
      const bytes = await book.download(request.format.toUpperCase());
      return {
        bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        extension: request.format,
        mimeType: mimeForExtension(request.format),
        fileName: `${request.metadata?.title || request.sourceId}.${request.format}`
      };
    }));
  }

  private async directSearch(lib: any, params: SearchParams, extensions: string[]): Promise<SearchResponse> {
    let url = `${lib.mirror}/s/${encodeURIComponent(params.q)}?`;
    for (const ext of extensions) url += `&extensions%5B%5D=${encodeURIComponent(ext)}`;
    url += `&page=${params.page}`;
    const html = await lib._r(url);
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const cards = Array.from(document.querySelectorAll("z-bookcard"));
    const totalMatch = String(html).match(/pagesTotal:\s*(\d+)/);
    const totalPages = totalMatch ? Number(totalMatch[1]) : null;
    return {
      page: params.page,
      totalPages,
      hasNext: cards.length > 0 && (
        totalPages !== null
          ? params.page < totalPages
          : cards.length >= DIRECT_SEARCH_PAGE_SIZE
      ),
      results: cards.map((card: any) => this.normalizeBookCard(card, lib.mirror))
        .filter((item: any) => item.sourceId && item.title)
    };
  }

  private async searchWithPaginator(lib: any, params: SearchParams, extensions: string[]): Promise<SearchResponse> {
    const paginator = await lib.search(params.q, false, null, null, [], extensions, FALLBACK_SEARCH_PAGE_SIZE);
    while (paginator.page < params.page) {
      const previousPage = paginator.page;
      await paginator.nextPage();
      if (paginator.page === previousPage) break;
      if (paginator.page >= (paginator.total || params.page)) break;
    }
    const rawResults = await paginator.next();
    const totalPages = Number.isFinite(paginator.total) && paginator.total > 0 ? paginator.total : null;
    const currentPage = paginator.page || params.page;
    return {
      page: currentPage,
      totalPages,
      hasNext: totalPages !== null ? currentPage < totalPages : rawResults.length >= FALLBACK_SEARCH_PAGE_SIZE,
      results: rawResults.map((item: any) => this.normalizeSearchItem(item))
        .filter((item: any) => item.sourceId && item.title)
    };
  }

  private normalizeBookCard(card: any, mirror: string) {
    const attr = (name: string) => card.getAttribute(name) || "";
    const textSlot = (name: string) => card.querySelector(`[slot="${name}"]`)?.textContent?.trim() || "";
    const image = card.querySelector("img");
    const href = attr("href");
    return {
      sourceId: String(attr("id")),
      title: textSlot("title"),
      authors: textSlot("author") ? [textSlot("author")] : [],
      coverUrl: image?.getAttribute("data-src") || image?.getAttribute("src") || null,
      year: attr("year") || null,
      language: attr("language") || null,
      extension: attr("extension") ? attr("extension").toLowerCase() : null,
      sizeLabel: attr("filesize") || null,
      rating: attr("rating") || null,
      sourceUrl: href ? new URL(href, mirror).toString() : null,
      downloadPath: attr("download") || null
    };
  }

  private async directDownload(lib: any, request: DownloadRequest): Promise<DownloadResponse | null> {
    try {
      const { getAxiosInstance } = require("zlibrary-nodejs/src/axiosInstance");
      const url = new URL(request.metadata?.downloadPath || "", lib.mirror).toString();
      const response = await getAxiosInstance().get(url, {
        responseType: "arraybuffer",
        timeout: this.options.requestTimeoutMs || DEFAULT_ZLIB_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: (status: number) => status >= 200 && status < 400
      });
      const contentType = String(response.headers?.["content-type"] || "");
      if (contentType.includes("text/html")) return null;
      return {
        bytes: Buffer.from(response.data),
        extension: request.format,
        mimeType: contentType || mimeForExtension(request.format),
        fileName: `${request.metadata?.title || request.sourceId}.${request.format}`
      };
    } catch {
      return null;
    }
  }

  private createLib(mirror = this.staticMirror()): any {
    const { AsyncZlib } = require("zlibrary-nodejs");
    const customDomains: Record<string, string> = {};
    customDomains.ZLIB_DOMAIN = mirror.domain;
    customDomains.LOGIN_DOMAIN = mirror.loginDomain;
    const lib = new AsyncZlib({ customDomains });
    this.configureProxy(mirror.proxyUrl);
    this.applyTimeout();
    return lib;
  }

  private restoreLib(session: ZlibSessionState, mirror = this.staticMirror()): any {
    const lib = this.createLib(mirror);
    const cookies = session.cookies || {};
    lib.cookies = cookies;
    lib.mirror = mirror.domain || session.mirror || lib.mirror;
    lib.domain = mirror.domain || session.domain || lib.domain;
    lib.profile = {};
    const { createAxiosInstance } = require("zlibrary-nodejs/src/axiosInstance");
    createAxiosInstance([], cookies);
    this.configureProxy(mirror.proxyUrl);
    this.applyTimeout();
    return lib;
  }

  private configureProxy(proxyUrl?: string) {
    try {
      const { getAxiosInstance } = require("zlibrary-nodejs/src/axiosInstance");
      const instance = getAxiosInstance();
      instance.defaults.proxy = false;
      delete instance.defaults.httpAgent;
      delete instance.defaults.httpsAgent;
      if (proxyUrl) {
        const agents = createProxyAgents(proxyUrl);
        instance.defaults.httpAgent = agents.httpAgent;
        instance.defaults.httpsAgent = agents.httpsAgent;
      }
    } catch {
      // Best-effort: the upstream package owns its axios singleton.
    }
  }

  private applyTimeout() {
    try {
      const { getAxiosInstance } = require("zlibrary-nodejs/src/axiosInstance");
      getAxiosInstance().defaults.timeout = this.options.requestTimeoutMs || DEFAULT_ZLIB_TIMEOUT_MS;
    } catch {
      // Best-effort: the upstream package owns its axios singleton.
    }
  }

  private extractCookies(lib: any): Record<string, string> {
    if (lib.cookies && typeof lib.cookies === "object") return { ...lib.cookies };
    try {
      const { getCurrentCookies } = require("zlibrary-nodejs/src/axiosInstance");
      return { ...getCurrentCookies() };
    } catch {
      return {};
    }
  }

  private normalizeSearchItem(item: any) {
    const authors = Array.isArray(item.authors)
      ? item.authors.map((entry: any) => entry?.author || entry).filter(Boolean)
      : [];
    return {
      sourceId: String(item.id || ""),
      title: String(item.name || item.title || "").trim(),
      authors,
      coverUrl: item.cover || null,
      year: item.year || null,
      language: item.language || null,
      extension: item.extension ? String(item.extension).toLowerCase() : null,
      sizeLabel: item.size || item.filesize || null,
      rating: item.rating || null,
      sourceUrl: item.url || null,
      downloadPath: item.downloadPath || null
    };
  }

  private async withMirrorRetry<T>(operation: (mirror: ZlibMirrorSelection) => Promise<T>): Promise<T> {
    let mirror = await this.resolveMirror();
    try {
      return await operation(mirror);
    } catch (error) {
      if (!this.options.mirrorResolver || !isMirrorNetworkError(error)) throw error;
      this.options.mirrorResolver.markFailure(mirror.domain, mirror.proxyUrl);
      mirror = await this.resolveMirror(true);
      return operation(mirror);
    }
  }

  private async resolveMirror(force = false): Promise<ZlibMirrorSelection> {
    if (!this.options.mirrorResolver) return this.staticMirror();
    return this.options.mirrorResolver.resolve({ force });
  }

  private staticMirror(): ZlibMirrorSelection {
    const domain = this.options.zlibDomain || DEFAULT_ZLIB_DOMAIN;
    const loginDomain = this.options.zlibLoginDomain || defaultZlibLoginUrl(domain);
    return {
      domain,
      loginDomain,
      registerUrl: "",
      egress: "direct",
      proxyPreferred: false,
      statuses: [],
      checkedAt: Date.now()
    };
  }

  private async withExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function isMirrorNetworkError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return /timeout|timed out|exceeded|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|ECONNABORTED|403|429|500|502|503|504/i
    .test(`${code} ${detail}`);
}
