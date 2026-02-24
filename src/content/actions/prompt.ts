import { findPromptTextarea } from '../finders';
import { typeReactTextarea } from '../utils/dom';

export function setPromptText(prompt: string): void {
  const ta = findPromptTextarea();
  console.log(`[FlowAuto] 注入 Prompt 文本... (${prompt.substring(0, 30)}...)`);
  typeReactTextarea(ta, prompt);
}

