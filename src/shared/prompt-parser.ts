import type { ParsedPromptItem } from './types';

function splitFilenamePrompt(line: string): { filename?: string; prompt: string } {
  const idxComma = line.indexOf(',');
  const idxCommaCn = line.indexOf('，');
  const idx = idxComma === -1 ? idxCommaCn : idxCommaCn === -1 ? idxComma : Math.min(idxComma, idxCommaCn);

  if (idx === -1) return { prompt: line.trim() };

  const filename = line.slice(0, idx).trim();
  const prompt = line.slice(idx + 1).trim();

  // Avoid treating "just a comma" as a filename format.
  if (!filename || !prompt) return { prompt: line.trim() };

  return { filename, prompt };
}

export function parsePromptText(input: string): ParsedPromptItem[] {
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

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

    if (trimmed.startsWith('#')) continue;
    current.push(line);
  }

  if (current.length) blocks.push(current);

  // If the user wrote no blank lines at all, treat each non-empty line as its own prompt.
  const hasBlankLine = /\n\s*\n/.test(input);
  const normalizedBlocks = hasBlankLine ? blocks : blocks.flatMap((b) => b.map((l) => [l]));

  return normalizedBlocks
    .map((blockLines) => {
      const [first, ...rest] = blockLines;
      const firstParsed = splitFilenamePrompt(first);
      const promptRest = rest.length ? '\n' + rest.join('\n') : '';
      return {
        filename: firstParsed.filename,
        prompt: (firstParsed.prompt + promptRest).trim(),
      } satisfies ParsedPromptItem;
    })
    .filter((x) => x.prompt.length > 0);
}

