import type { ParsedPromptItem } from "./types";

export interface InlineRef {
  raw: string; // e.g. "@角色图1.png"
  filename: string; // e.g. "角色图1.png"
}

const INLINE_REF_RE =
  /@([\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff.-]+\.\w{1,5})/g;

export function extractInlineRefs(prompt: string): InlineRef[] {
  const refs: InlineRef[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(INLINE_REF_RE)) {
    const filename = match[1];
    if (!filename) continue;
    const key = filename.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ raw: match[0], filename });
  }
  return refs;
}

export function parsePromptText(input: string): ParsedPromptItem[] {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }

    if (trimmed.startsWith("#")) continue;
    current.push(line);
  }

  if (current.length) blocks.push(current);

  // If the user wrote no blank lines at all, treat each non-empty line as its own prompt.
  const hasBlankLine = /\n\s*\n/.test(input);
  const normalizedBlocks = hasBlankLine
    ? blocks
    : blocks.flatMap((b) => b.map((l) => [l]));

  return normalizedBlocks
    .map((blockLines) => {
      const prompt = blockLines.join("\n").trim();
      const inlineRefs = extractInlineRefs(prompt).map((x) => x.filename);
      return {
        prompt,
        inlineRefs: inlineRefs.length > 0 ? inlineRefs : undefined,
      } satisfies ParsedPromptItem;
    })
    .filter((x) => x.prompt.length > 0);
}
