import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- global fetch mock setup ----------
const fetchMock = vi.fn<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const h = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: h,
    redirected: false,
    statusText: "",
    type: "basic",
    url: "",
    clone: () => jsonResponse(body, status, headers),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// ---------- import under test ----------
import { ProxyProvider } from "../background/ai-providers/proxy-provider";

beforeEach(() => {
  fetchMock.mockReset();
});

describe("ProxyProvider", () => {
  const provider = new ProxyProvider("test-license-key");

  // ========== enhance ==========
  describe("enhance", () => {
    it("sends correct request and returns result", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: "enhanced prompt" }),
      );

      const result = await provider.enhance("a cat");
      expect(result).toBe("enhanced prompt");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://flowauto-ai-proxy.workers.dev/api/ai/enhance",
      );
      expect(init?.method).toBe("POST");
      expect(
        (init?.headers as Record<string, string>)["X-License-Key"],
      ).toBe("test-license-key");
      expect(
        (init?.headers as Record<string, string>)["Content-Type"],
      ).toBe("application/json");

      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ prompt: "a cat" });
    });
  });

  // ========== rewrite ==========
  describe("rewrite", () => {
    it("sends prompt and error, returns result", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: "safe prompt" }),
      );

      const result = await provider.rewrite("bad prompt", "policy violation");
      expect(result).toBe("safe prompt");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://flowauto-ai-proxy.workers.dev/api/ai/rewrite",
      );
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ prompt: "bad prompt", error: "policy violation" });
    });
  });

  // ========== variants ==========
  describe("variants", () => {
    it("returns array result directly", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: ["v1", "v2", "v3"] }),
      );

      const result = await provider.variants("a cat", 3);
      expect(result).toEqual(["v1", "v2", "v3"]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://flowauto-ai-proxy.workers.dev/api/ai/variants",
      );
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ prompt: "a cat", count: 3 });
    });

    it("wraps non-array result in array", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: "single variant" }),
      );

      const result = await provider.variants("a cat", 1);
      expect(result).toEqual(["single variant"]);
    });
  });

  // ========== error handling ==========
  describe("error handling", () => {
    it("throws quota exceeded on 429", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Monthly quota exceeded" }, 429),
      );

      await expect(provider.enhance("test")).rejects.toThrow(
        "AI quota exceeded",
      );
    });

    it("throws auth error on 401", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Missing license key" }, 401),
      );

      await expect(provider.enhance("test")).rejects.toThrow("AI proxy error: 401");
    });

    it("throws auth error on 403", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Invalid license key" }, 403),
      );

      await expect(provider.enhance("test")).rejects.toThrow("AI proxy error: 403");
    });

    it("throws on generic server error", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Internal error" }, 500),
      );

      await expect(provider.enhance("test")).rejects.toThrow("AI proxy error: 500");
    });

    it("throws on network error", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(provider.enhance("test")).rejects.toThrow("Failed to fetch");
    });
  });
});
