export type UserRecord = {
  id: string;
  email: string;
  created_at: number;
};

export type PublicUser = {
  id: string;
  email: string;
};

export type AuthState = {
  user: PublicUser | null;
  aiConfigured: boolean;
  zlibBound: boolean;
};

export type SessionRecord = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

export type ZlibCredentialRecord = {
  user_id: string;
  bound_email: string;
  encrypted_session: string;
  created_at: number;
  updated_at: number;
};

export type EmailVerificationCodeRecord = {
  id: string;
  email: string;
  code_hash: string;
  purpose: string;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
  created_at: number;
};

export type UserAIConfigRecord = {
  user_id: string;
  base_url: string;
  encrypted_api_key: string;
  model: string;
  created_at: number;
  updated_at: number;
};

export type ServerBookRecord = {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  title: string;
  authors_json: string;
  cover_url: string | null;
  year: string | null;
  language: string | null;
  extension: string;
  size_label: string | null;
  mime_type: string;
  file_path: string;
  status: string;
  current_page: number;
  current_cfi: string | null;
  progress: number;
  total_pages: number | null;
  added_at: number;
  last_read: number;
};

export type DownloadJobRecord = {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  status: "queued" | "running" | "saved" | "failed";
  format: string;
  book_id: string | null;
  error: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

export type BookMetadata = {
  sourceId: string;
  title: string;
  authors?: string[];
  coverUrl?: string | null;
  year?: string | null;
  language?: string | null;
  extension?: string | null;
  sizeLabel?: string | null;
  rating?: string | null;
  sourceUrl?: string | null;
  downloadPath?: string | null;
};
