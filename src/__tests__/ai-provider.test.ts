import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------- global fetch mock setup ----------
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: "",
    type: "basic",
    url: "",
    clone: () => jsonResponse(body, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// ---------- imports under test ----------
import { createAiProvider } from "../background/ai-providers";
import { OpenAiProvider, parseNumberedList } from "../background/ai-providers/openai-provider";
import { GeminiProvider } from "../background/ai-providers/gemini-provider";
import { ProxyProvider } from "../background/ai-providers/proxy-provider";
import type { AiSettings } from "../shared/ai-provider";

beforeEach(() => {
  fetchMock.mockReset();
});

// ========== Factory ==========
describe("createAiProvider", () => {
  it("returns OpenAiProvider for 'openai'", () => {
    const s: AiSettings = { provider: "openai", apiKey: "key", model: "gpt-4o-mini" };
    const p = createAiProvider(s);
    expect(p).toBeInstanceOf(OpenAiProvider);
  });

  it("returns GeminiProvider for 'gemini'", () => {
    const s: AiSettings = { provider: "gemini", apiKey: "key", model: "gemini-2.0-flash" };
    const p = createAiProvider(s);
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it("returns ProxyProvider for 'proxy' with licenseKey", () => {
    const s: AiSettings = { provider: "proxy", apiKey: "", model: "", licenseKey: "lk_123" };
    const p = createAiProvider(s);
    expect(p).toBeInstanceOf(ProxyProvider);
  });

  it("throws for 'proxy' without licenseKey", () => {
    const s: AiSettings = { provider: "proxy", apiKey: "", model: "" };
    expect(() => createAiProvider(s)).toThrow(/license key required/i);
  });

  it("throws for unknown provider", () => {
    const s = { provider: "foo" as any, apiKey: "key", model: "" };
    expect(() => createAiProvider(s)).toThrow(/unknown/i);
  });
});

// ========== OpenAI Provider ==========
describe("OpenAiProvider", () => {
  const provider = new OpenAiProvider("test-key", "gpt-4o-mini");

  it("enhance sends correct request and returns content", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "enhanced prompt" } }],
      }),
    );

    const result = await provider.enhance("a cat");
    expect(result).toBe("enhanced prompt");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toBe("a cat");
  });

  it("rewrite includes error in system prompt", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "safe prompt" } }],
      }),
    );

    const result = await provider.rewrite("bad prompt", "policy violation");
    expect(result).toBe("safe prompt");

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toContain("policy violation");
  });

  it("variants parses numbered list correctly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "1. variant one\n2. variant two\n3. variant three" } }],
      }),
    );

    const result = await provider.variants("a cat", 3);
    expect(result).toEqual(["variant one", "variant two", "variant three"]);
  });

  it("throws on 401 (invalid API key)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid" }, 401));
    await expect(provider.enhance("test")).rejects.toThrow("Invalid API key (401)");
  });

  it("throws on 429 (rate limit)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "limit" }, 429));
    await expect(provider.enhance("test")).rejects.toThrow("Rate limit exceeded (429)");
  });

  it("throws on empty response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    await expect(provider.enhance("test")).rejects.toThrow("Empty response");
  });

  it("throws on network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(provider.enhance("test")).rejects.toThrow("Failed to fetch");
  });
});

// ========== Gemini Provider ==========
describe("GeminiProvider", () => {
  const provider = new GeminiProvider("gem-key", "gemini-2.0-flash");

  it("enhance sends correct request and returns content", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "gemini enhanced" }] } }],
      }),
    );

    const result = await provider.enhance("a dog");
    expect(result).toBe("gemini enhanced");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("key=gem-key");
    expect(url).toContain("gemini-2.0-flash");
  });

  it("rewrite includes error in system instruction", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "safe output" }] } }],
      }),
    );

    const result = await provider.rewrite("bad", "content policy");
    expect(result).toBe("safe output");

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.systemInstruction.parts[0].text).toContain("content policy");
  });

  it("variants parses numbered list", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "1. alpha\n2. beta" }] } }],
      }),
    );

    const result = await provider.variants("prompt", 2);
    expect(result).toEqual(["alpha", "beta"]);
  });

  it("throws on 401/403 (invalid key)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(provider.enhance("test")).rejects.toThrow("Invalid API key");
  });

  it("throws on 429 (rate limit)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(provider.enhance("test")).rejects.toThrow("Rate limit exceeded");
  });

  it("throws on empty response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    await expect(provider.enhance("test")).rejects.toThrow("Empty response");
  });
});

// ========== parseNumberedList ==========
describe("parseNumberedList", () => {
  it("parses standard numbered list", () => {
    expect(parseNumberedList("1. First\n2. Second\n3. Third", 3)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("truncates to expected count", () => {
    expect(parseNumberedList("1. A\n2. B\n3. C\n4. D", 2)).toEqual(["A", "B"]);
  });

  it("handles fewer items than expected", () => {
    expect(parseNumberedList("1. Only one", 3)).toEqual(["Only one"]);
  });

  it("skips blank lines", () => {
    expect(parseNumberedList("1. A\n\n2. B", 2)).toEqual(["A", "B"]);
  });

  it("handles text without numbers", () => {
    expect(parseNumberedList("just plain text\nanother line", 2)).toEqual([
      "just plain text",
      "another line",
    ]);
  });
});
