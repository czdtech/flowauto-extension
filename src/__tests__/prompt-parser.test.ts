import { describe, it, expect } from "vitest";
import { parsePromptText, extractInlineRefs } from "../shared/prompt-parser";

describe("parsePromptText", () => {
  // Happy path
  it("parses single line prompt", () => {
    const result = parsePromptText("一只橘猫");
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[0].inlineRefs).toBeUndefined();
  });

  it("parses multiple single-line prompts", () => {
    const result = parsePromptText("一只橘猫\n一只黑猫");
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[1].prompt).toBe("一只黑猫");
  });

  it("parses multi-line prompts separated by blank lines", () => {
    const text =
      "一只橘猫坐在窗台上\n阳光透过玻璃窗照射进来\n\n一只黑猫在月光下";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toContain("一只橘猫坐在窗台上");
    expect(result[0].prompt).toContain("阳光透过玻璃窗照射进来");
    expect(result[1].prompt).toBe("一只黑猫在月光下");
  });

  // Comments
  it("ignores comment lines starting with #", () => {
    const result = parsePromptText("# 这是注释\n橘猫在阳光下");
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("橘猫在阳光下");
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
    const text = "# batch 1\n橘猫\n# batch 2\n黑猫";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
  });

  it("treats pipe as regular text, not a separator", () => {
    const result = parsePromptText("cat_orange.png | 一只橘猫在窗台上晒太阳");
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("cat_orange.png | 一只橘猫在窗台上晒太阳");
    expect(result[0].inlineRefs).toBeUndefined();
  });

  it("does not treat comma as a delimiter", () => {
    const result = parsePromptText(
      "阳光明媚的沙滩，印度农村地区的沙滩边。角色在河岸边",
    );
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toContain("阳光明媚的沙滩，印度农村地区的沙滩边");
  });

  // Inline @references
  it("extracts inline @filename.ext references", () => {
    const result = parsePromptText(
      "@角色图1.png 中的角色和 @角色图2.png 中的角色在河边",
    );
    expect(result).toHaveLength(1);
    expect(result[0].inlineRefs).toEqual(["角色图1.png", "角色图2.png"]);
    expect(result[0].prompt).toBe(
      "@角色图1.png 中的角色和 @角色图2.png 中的角色在河边",
    );
  });

  it("extracts single inline ref", () => {
    const result = parsePromptText("使用 @bg.jpg 作为背景");
    expect(result).toHaveLength(1);
    expect(result[0].inlineRefs).toEqual(["bg.jpg"]);
  });

  it("deduplicates repeated inline refs", () => {
    const result = parsePromptText("@hero.png 在左边，@hero.png 在右边");
    expect(result).toHaveLength(1);
    expect(result[0].inlineRefs).toEqual(["hero.png"]);
  });

  it("does not extract @ without file extension", () => {
    const result = parsePromptText("联系 @张三 讨论方案");
    expect(result).toHaveLength(1);
    expect(result[0].inlineRefs).toBeUndefined();
  });

  it("handles inline refs in multi-line prompt blocks", () => {
    const text = "@bg.png 作为背景\n前景放置 @char.png\n\n纯文字提示词";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
    expect(result[0].inlineRefs).toEqual(["bg.png", "char.png"]);
    expect(result[1].inlineRefs).toBeUndefined();
  });
});

describe("extractInlineRefs", () => {
  it("extracts multiple refs", () => {
    const refs = extractInlineRefs("@a.png and @b.jpg");
    expect(refs).toEqual([
      { raw: "@a.png", filename: "a.png" },
      { raw: "@b.jpg", filename: "b.jpg" },
    ]);
  });

  it("returns empty for no refs", () => {
    expect(extractInlineRefs("no refs here")).toEqual([]);
  });

  it("handles CJK filenames", () => {
    const refs = extractInlineRefs("使用 @角色图.webp 生成");
    expect(refs).toHaveLength(1);
    expect(refs[0].filename).toBe("角色图.webp");
  });
});
