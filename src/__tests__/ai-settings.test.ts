import { describe, expect, it } from "vitest";

import { resolveConfiguredAiSettings } from "../background/ai-settings";
import type { AiSettings } from "../shared/ai-provider";

describe("resolveConfiguredAiSettings", () => {
  it("returns undefined when AI settings are missing", () => {
    expect(resolveConfiguredAiSettings(undefined, "pro")).toBeUndefined();
  });

  it("accepts own-key providers for entitled tiers", () => {
    const settings: AiSettings = {
      provider: "openai",
      apiKey: "  sk-test  ",
      model: "gpt-4o-mini",
    };

    expect(resolveConfiguredAiSettings(settings, "pro")).toEqual({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
  });

  it("rejects own-key providers for free tier", () => {
    const settings: AiSettings = {
      provider: "gemini",
      apiKey: "gem-key",
      model: "gemini-2.0-flash",
    };

    expect(resolveConfiguredAiSettings(settings, "free")).toBeUndefined();
  });

  it("accepts proxy provider for Pro+ when a license key is available", () => {
    const settings: AiSettings = {
      provider: "proxy",
      apiKey: "",
      model: "",
    };

    expect(resolveConfiguredAiSettings(settings, "pro_plus", "lic_123")).toEqual({
      provider: "proxy",
      apiKey: "",
      model: "",
      licenseKey: "lic_123",
    });
  });

  it("rejects proxy provider without a license key", () => {
    const settings: AiSettings = {
      provider: "proxy",
      apiKey: "",
      model: "",
    };

    expect(resolveConfiguredAiSettings(settings, "pro_plus")).toBeUndefined();
  });

  it("rejects proxy provider for non-Pro+ tiers", () => {
    const settings: AiSettings = {
      provider: "proxy",
      apiKey: "",
      model: "",
    };

    expect(resolveConfiguredAiSettings(settings, "pro", "lic_123")).toBeUndefined();
  });
});
