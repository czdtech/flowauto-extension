import type { AiProvider, AiSettings } from "../../shared/ai-provider";
import { OpenAiProvider } from "./openai-provider";
import { GeminiProvider } from "./gemini-provider";

export function createAiProvider(settings: AiSettings): AiProvider {
  switch (settings.provider) {
    case "openai":
      return new OpenAiProvider(settings.apiKey, settings.model || "gpt-4o-mini");
    case "gemini":
      return new GeminiProvider(
        settings.apiKey,
        settings.model || "gemini-2.0-flash",
      );
    case "proxy":
      throw new Error("Proxy provider is not yet implemented (P6 scope)");
    default:
      throw new Error(`Unknown AI provider: ${settings.provider}`);
  }
}
