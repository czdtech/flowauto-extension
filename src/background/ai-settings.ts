import type { AiSettings } from "../shared/ai-provider";
import { isFeatureEnabled, type Tier } from "../shared/feature-gate";

export function resolveConfiguredAiSettings(
  aiSettings: AiSettings | undefined,
  tier: Tier,
  licenseKey?: string,
): AiSettings | undefined {
  if (!aiSettings) return undefined;

  if (aiSettings.provider === "proxy") {
    if (!isFeatureEnabled("ai_proxy", tier) || !licenseKey) return undefined;
    return { ...aiSettings, licenseKey };
  }

  const apiKey = aiSettings.apiKey.trim();
  if (!isFeatureEnabled("ai_own_key", tier) || !apiKey) return undefined;
  return { ...aiSettings, apiKey };
}
