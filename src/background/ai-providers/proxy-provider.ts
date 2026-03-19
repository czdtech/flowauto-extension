import type { AiProvider } from "../../shared/ai-provider";

const PROXY_BASE_URL = "https://flowauto-ai-proxy.workers.dev";

export class ProxyProvider implements AiProvider {
  private licenseKey: string;

  constructor(licenseKey: string) {
    this.licenseKey = licenseKey;
  }

  async enhance(prompt: string): Promise<string> {
    return this.call("/api/ai/enhance", { prompt });
  }

  async rewrite(prompt: string, error: string): Promise<string> {
    return this.call("/api/ai/rewrite", { prompt, error });
  }

  async variants(prompt: string, count: number): Promise<string[]> {
    const result = await this.call("/api/ai/variants", { prompt, count });
    return Array.isArray(result) ? result : [result];
  }

  private async call(
    path: string,
    body: Record<string, unknown>,
  ): Promise<any> {
    const res = await fetch(`${PROXY_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": this.licenseKey,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      throw new Error("AI quota exceeded");
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI proxy error: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { result: unknown };
    return data.result;
  }
}
