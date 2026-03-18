import { findPromptInput } from '../finders';
import { typeInputElement } from '../utils/dom';

/**
 * Inject prompt text into the Flow page's input element.
 * Retries up to 3 times with verification after each attempt.
 */
export async function setPromptText(prompt: string): Promise<void> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const input = findPromptInput();
    console.log(`[FlowAuto] 注入 Prompt (尝试 ${attempt}/${MAX_ATTEMPTS})`);

    await typeInputElement(input, prompt);
    await new Promise(r => setTimeout(r, 150));

    // Verify
    const actual =
      input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
        ? String(input.value)
        : input.isContentEditable ? (input.textContent || '') : '';

    if (actual.includes(prompt.substring(0, 15))) {
      console.log(`[FlowAuto] ✅ Prompt 注入成功`);
      return;
    }

    console.warn(`[FlowAuto] ⚠️ Prompt 验证失败 (尝试 ${attempt})`);
    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 200));
  }

  console.error(`[FlowAuto] ❌ Prompt 注入多次失败`);
}
