import type { BookMetadata } from "../types.js";

export type ZlibSessionState = {
  cookies?: Record<string, string>;
  mirror?: string;
  domain?: string;
  createdAt?: number;
  [key: string]: unknown;
};

export type SearchParams = {
  q: string;
  page: number;
  format?: "epub" | "pdf" | "txt";
};

export type SearchResponse = {
  page: number;
  totalPages: number | null;
  hasNext: boolean;
  results: BookMetadata[];
};

export type DownloadRequest = {
  sourceId: string;
  format: "epub" | "pdf" | "txt";
  metadata?: BookMetadata;
};

export type DownloadResponse = {
  bytes: Buffer;
  extension: "epub" | "pdf" | "txt";
  mimeType: string;
  fileName?: string;
};

export interface BookSourceAdapter {
  login(email: string, password: string): Promise<ZlibSessionState>;
  validateSession(session: ZlibSessionState): Promise<void>;
  search(session: ZlibSessionState, params: SearchParams): Promise<SearchResponse>;
  download(session: ZlibSessionState, request: DownloadRequest): Promise<DownloadResponse>;
}
