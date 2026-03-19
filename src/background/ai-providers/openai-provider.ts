import type { AiProvider } from "../../shared/ai-provider";

const SYSTEM_ENHANCE =
  "You are a prompt engineer for AI image/video generation. Enhance this rough description into a detailed, vivid prompt. Return only the enhanced prompt, nothing else.";

const SYSTEM_REWRITE_PREFIX =
  "The following prompt was rejected for policy violation. Rewrite it to avoid the violation while keeping the creative intent.";

const SYSTEM_VARIANTS_PREFIX =
  "Generate creative variations of this prompt for AI image/video generation. Return each variation on a new line, numbered 1. 2. 3. etc.";

export class OpenAiProvider implements AiProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async enhance(prompt: string): Promise<string> {
    return this.chat(SYSTEM_ENHANCE, prompt);
  }

  async rewrite(prompt: string, error: string): Promise<string> {
    const system = `${SYSTEM_REWRITE_PREFIX} Error: ${error}. Return only the rewritten prompt.`;
    return this.chat(system, prompt);
  }

  async variants(prompt: string, count: number): Promise<string[]> {
    const system = SYSTEM_VARIANTS_PREFIX.replace(
      "Generate creative",
      `Generate ${count} creative`,
    );
    const raw = await this.chat(system, prompt);
    return parseNumberedList(raw, count);
  }

  private async chat(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.8,
      }),
    });

    if (res.status === 401) {
      throw new Error("Invalid API key (401)");
    }
    if (res.status === 429) {
      throw new Error("Rate limit exceeded (429)");
    }
    if (!res.ok) {
      throw new Error(`OpenAI API error (${res.status})`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response from OpenAI");
    return content;
  }
}

/** Parse a numbered list like "1. foo\n2. bar" into an array of strings. */
export function parseNumberedList(raw: string, expectedCount: number): string[] {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  // Return at most expectedCount items, or all if fewer
  return lines.slice(0, expectedCount);
}
