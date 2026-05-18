import type { AppConfig } from "./config.js";

type ClashControllerOptions = {
  fetch?: typeof fetch;
  now?: () => number;
};

export class ZlibClashController {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private lastSwitchAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly config: AppConfig, options: ClashControllerOptions = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.now = options.now || (() => Date.now());
  }

  async ensurePreferredGroup(): Promise<void> {
    if (!this.config.zlibClashApiUrl) return;
    const now = this.now();
    if (now - this.lastSwitchAt < this.config.zlibClashSwitchTtlMs) return;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.switchGroup();
    try {
      await this.inFlight;
      this.lastSwitchAt = this.now();
    } finally {
      this.inFlight = null;
    }
  }

  private async switchGroup(): Promise<void> {
    const endpoint = `${this.config.zlibClashApiUrl}/proxies/${encodeURIComponent(this.config.zlibClashSelector)}`;
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.config.zlibClashApiSecret) {
      headers.authorization = `Bearer ${this.config.zlibClashApiSecret}`;
    }
    const response = await this.fetchImpl(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: this.config.zlibClashPreferredGroup })
    });
    if (!response.ok) {
      throw new Error(`Mihomo selector switch failed: HTTP ${response.status}`);
    }
  }
}
