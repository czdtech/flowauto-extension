import { describe, it, expect } from "vitest";
import { parsePromptText } from "../shared/prompt-parser";

describe("parsePromptText", () => {
  // Happy path
  it("parses single line prompt", () => {
    const result = parsePromptText("一只橘猫");
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[0].filename).toBeUndefined();
  });

  it("parses multiple single-line prompts", () => {
    const result = parsePromptText("一只橘猫\n一只黑猫");
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[1].prompt).toBe("一只黑猫");
  });

  it("parses filename, prompt format", () => {
    const result = parsePromptText("cat_orange, 一只橘猫在窗台上晒太阳");
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("cat_orange");
    expect(result[0].prompt).toBe("一只橘猫在窗台上晒太阳");
  });

  it("parses multi-line prompts separated by blank lines", () => {
    const text =
      "vi_001, 一只橘猫坐在窗台上\n阳光透过玻璃窗照射进来\n\nvi_002, 一只黑猫在月光下";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toContain("一只橘猫坐在窗台上");
    expect(result[0].prompt).toContain("阳光透过玻璃窗照射进来");
    expect(result[1].filename).toBe("vi_002");
  });

  // Comments
  it("ignores comment lines starting with #", () => {
    const result = parsePromptText("# 这是注释\ncat_01, 橘猫");
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("cat_01");
  });

  // Edge cases
  it("returns empty array for empty input", () => {
    expect(parsePromptText("")).toHaveLength(0);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parsePromptText("   \n\n  \n")).toHaveLength(0);
  });

  it("returns empty array for comment-only input", () => {
    expect(parsePromptText("# only comments\n# here")).toHaveLength(0);
  });

  it("trims whitespace from prompts", () => {
    const result = parsePromptText("  一只橘猫  ");
    expect(result[0].prompt).toBe("一只橘猫");
  });

  it("handles mixed comment and prompt lines", () => {
    const text = "# batch 1\ncat_01, 橘猫\n# batch 2\ncat_02, 黑猫";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
  });
});
