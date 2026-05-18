import { mimeForExtension } from "../security.js";
import type {
  BookSourceAdapter,
  DownloadRequest,
  DownloadResponse,
  SearchParams,
  SearchResponse,
  ZlibSessionState
} from "./book-source.js";

export class MockBookSourceAdapter implements BookSourceAdapter {
  async login(email: string, password: string): Promise<ZlibSessionState> {
    if (password === "bad-password") throw new Error("Invalid mock credentials");
    return {
      cookies: { mock_user: email },
      mirror: "mock://zlib",
      domain: "mock://zlib",
      createdAt: Date.now()
    };
  }

  async validateSession(_session: ZlibSessionState): Promise<void> {
    return;
  }

  async search(_session: ZlibSessionState, params: SearchParams): Promise<SearchResponse> {
    const format = params.format || "epub";
    return {
      page: params.page,
      totalPages: 1,
      hasNext: false,
      results: [
        {
          sourceId: `mock-${format}-1`,
          title: `Mock ${params.q} Book`,
          authors: ["SmartRead Test"],
          coverUrl: null,
          year: "2026",
          language: "english",
          extension: format,
          sizeLabel: "1 KB",
          rating: "5.0/5.0",
          sourceUrl: "mock://zlib/book/mock-1"
        }
      ]
    };
  }

  async download(_session: ZlibSessionState, request: DownloadRequest): Promise<DownloadResponse> {
    const title = request.metadata?.title || "Mock Book";
    const text = `# ${title}\n\nThis is a mock downloaded book for SmartRead tests.\n`;
    return {
      bytes: Buffer.from(text, "utf8"),
      extension: request.format,
      mimeType: mimeForExtension(request.format),
      fileName: `${title}.${request.format}`
    };
  }
}
