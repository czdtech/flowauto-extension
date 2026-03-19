import type { AiProvider, AiSettings } from "../../shared/ai-provider";
import { OpenAiProvider } from "./openai-provider";
import { GeminiProvider } from "./gemini-provider";
import { ProxyProvider } from "./proxy-provider";

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
      if (!settings.licenseKey) {
        throw new Error("License key required for proxy provider");
      }
      return new ProxyProvider(settings.licenseKey);
    default:
      throw new Error(`Unknown AI provider: ${settings.provider}`);
  }
}
