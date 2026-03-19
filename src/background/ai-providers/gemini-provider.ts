import type { AiProvider } from "../../shared/ai-provider";
import { parseNumberedList } from "./openai-provider";

const SYSTEM_ENHANCE =
  "You are a prompt engineer for AI image/video generation. Enhance this rough description into a detailed, vivid prompt. Return only the enhanced prompt, nothing else.";

const SYSTEM_REWRITE_PREFIX =
  "The following prompt was rejected for policy violation. Rewrite it to avoid the violation while keeping the creative intent.";

const SYSTEM_VARIANTS_PREFIX =
  "Generate creative variations of this prompt for AI image/video generation. Return each variation on a new line, numbered 1. 2. 3. etc.";

export class GeminiProvider implements AiProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.0-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async enhance(prompt: string): Promise<string> {
    return this.generate(SYSTEM_ENHANCE, prompt);
  }

  async rewrite(prompt: string, error: string): Promise<string> {
    const system = `${SYSTEM_REWRITE_PREFIX} Error: ${error}. Return only the rewritten prompt.`;
    return this.generate(system, prompt);
  }

  async variants(prompt: string, count: number): Promise<string[]> {
    const system = SYSTEM_VARIANTS_PREFIX.replace(
      "Generate creative",
      `Generate ${count} creative`,
    );
    const raw = await this.generate(system, prompt);
    return parseNumberedList(raw, count);
  }

  private async generate(system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0.8 },
      }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid API key (401)");
    }
    if (res.status === 429) {
      throw new Error("Rate limit exceeded (429)");
    }
    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status})`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error("Empty response from Gemini");
    return content;
  }
}
