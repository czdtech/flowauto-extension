export interface AiProvider {
  enhance(prompt: string): Promise<string>;
  rewrite(prompt: string, error: string): Promise<string>;
  variants(prompt: string, count: number): Promise<string[]>;
}

export type AiProviderType = "openai" | "gemini" | "proxy";

export interface AiSettings {
  provider: AiProviderType;
  apiKey: string;
  model: string;
  licenseKey?: string;
}
