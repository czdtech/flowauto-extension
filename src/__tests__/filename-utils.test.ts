import { describe, it, expect } from "vitest";
import {
  sanitizePathSegment,
  shortPrompt,
  buildProjectDir,
  buildTaskBaseName,
} from "../shared/filename-utils";

describe("sanitizePathSegment", () => {
  it("passes through clean names", () => {
    expect(sanitizePathSegment("my-project")).toBe("my-project");
  });

  it("replaces invalid path characters", () => {
    const result = sanitizePathSegment('my/project:name<>');
    expect(result).not.toContain("/");
    expect(result).not.toContain(":");
    expect(result).not.toContain("<");
  });

  it("trims whitespace", () => {
    expect(sanitizePathSegment("  hello  ")).toBe("hello");
  });

  it("returns fallback for empty string", () => {
    expect(sanitizePathSegment("")).toBe("untitled");
  });

  it("returns custom fallback for empty string", () => {
    expect(sanitizePathSegment("", "default")).toBe("default");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(200);
    expect(sanitizePathSegment(long).length).toBe(80);
  });

  it("handles Windows reserved names", () => {
    const result = sanitizePathSegment("CON");
    expect(result).toBe("CON_");
  });

  it("handles null/undefined input gracefully", () => {
    expect(sanitizePathSegment(null as any)).toBe("untitled");
    expect(sanitizePathSegment(undefined as any)).toBe("untitled");
  });
});

describe("shortPrompt", () => {
  it("returns short prompts unchanged", () => {
    expect(shortPrompt("hello world")).toBe("hello world");
  });

  it("truncates long prompts to 40 chars by default", () => {
    const long = "a".repeat(100);
    expect(shortPrompt(long).length).toBe(40);
  });

  it("respects custom maxLen", () => {
    expect(shortPrompt("a".repeat(100), 20).length).toBe(20);
  });

  it("returns 'prompt' for empty input", () => {
    expect(shortPrompt("")).toBe("prompt");
  });

  it("collapses whitespace", () => {
    expect(shortPrompt("hello   world")).toBe("hello world");
  });
});

describe("buildProjectDir", () => {
  it("returns FlowAuto/sanitized-name format", () => {
    expect(buildProjectDir("My Project")).toBe("FlowAuto/My Project");
  });

  it("uses Flow as fallback for empty name", () => {
    expect(buildProjectDir("")).toBe("FlowAuto/Flow");
  });
});

describe("buildTaskBaseName", () => {
  it("uses filename when provided", () => {
    const result = buildTaskBaseName(
      { filename: "custom_name", prompt: "一只橘猫" },
      0,
    );
    expect(result).toContain("custom_name");
    expect(result).toContain("__o00");
  });

  it("falls back to prompt when no filename", () => {
    const result = buildTaskBaseName({ prompt: "一只橘猫在窗台上" }, 3);
    expect(result).toContain("__o03");
  });

  it("pads output index to 2 digits", () => {
    const result = buildTaskBaseName({ prompt: "test" }, 5);
    expect(result).toContain("__o05");
  });

  it("handles double-digit output index", () => {
    const result = buildTaskBaseName({ prompt: "test" }, 12);
    expect(result).toContain("__o12");
  });
});
