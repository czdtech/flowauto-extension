import { KEYWORDS, SELECTORS } from './selectors';
import { getElementName, normalizeForMatch } from './utils/aria';
import { findAllByRole, forceClick, isVisible } from './utils/dom';

export function findPromptTextarea(): HTMLTextAreaElement {
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>(SELECTORS.textarea));
  for (const ta of textareas) {
    const cls = ta.className || '';
    if (cls.includes('recaptcha')) continue;
    if (!isVisible(ta)) continue;
    return ta;
  }
  throw new Error('未找到输入框 (Prompt textarea not found)');
}

export function findCreateButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTORS.buttons));
  const matchers = KEYWORDS.create.map((k) => normalizeForMatch(k));
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (matchers.some((k) => name.includes(k))) return b;
  }
  throw new Error('未找到创建按钮 (Create button not found)');
}

export function findSettingsButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTORS.buttons));
  const matchers = KEYWORDS.settings.map((k) => normalizeForMatch(k));
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (matchers.some((k) => name.includes(k))) return b;
  }
  throw new Error('未找到设置按钮 (Settings button not found)');
}

export function findModeCombobox(): HTMLElement {
  const boxes = findAllByRole('combobox').filter(isVisible);
  const allModeMatchers = [
    ...KEYWORDS.modeTextToVideo,
    ...KEYWORDS.modeFramesToVideo,
    ...KEYWORDS.modeIngredients,
    ...KEYWORDS.modeCreateImage,
  ].map((k) => normalizeForMatch(k));

  for (const box of boxes) {
    const name = normalizeForMatch(getElementName(box));
    if (allModeMatchers.some((k) => name.includes(k))) return box;
  }

  throw new Error('未找到模式下拉框 (Mode combobox not found)');
}

export function findSettingsCombobox(kind: 'aspectRatio' | 'outputCount' | 'model'): HTMLElement {
  const boxes = findAllByRole('combobox').filter(isVisible);

  const keywords =
    kind === 'aspectRatio'
      ? KEYWORDS.aspectRatio
      : kind === 'outputCount'
        ? KEYWORDS.outputCount
        : KEYWORDS.model;

  const matchers = keywords.map((k) => normalizeForMatch(k));
  for (const box of boxes) {
    const name = normalizeForMatch(getElementName(box));
    const text = normalizeForMatch(box.textContent || '');
    if (matchers.some((k) => name.includes(k) || text.includes(k))) return box;
  }

  // Fallback: exclude the mode combobox (which contains mode keywords)
  // then pick by position among the remaining settings comboboxes.
  const modeMatchers = [
    ...KEYWORDS.modeTextToVideo,
    ...KEYWORDS.modeFramesToVideo,
    ...KEYWORDS.modeIngredients,
    ...KEYWORDS.modeCreateImage,
  ].map((k) => normalizeForMatch(k));

  const settingsBoxes = boxes.filter((box) => {
    const name = normalizeForMatch(getElementName(box));
    return !modeMatchers.some((k) => name.includes(k));
  });

  // Settings panel order is typically: [aspect, outputs, model]
  if (settingsBoxes.length >= 3) {
    const idx = kind === 'aspectRatio' ? 0 : kind === 'outputCount' ? 1 : 2;
    if (settingsBoxes[idx]) return settingsBoxes[idx];
  }

  throw new Error(`未找到设置项下拉框 [${kind}] (Settings combobox not found)`);
}

export function getDownloadButtons(): HTMLButtonElement[] {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTORS.downloadButtons));
  return buttons.filter((b) => {
    // We cannot use isVisible(b) here because overlay buttons on cards often have opacity: 0 until hovered.
    // They are in the DOM, so checking if they have an accessible name is enough.
    const name = normalizeForMatch(getElementName(b));
    return KEYWORDS.download.some((k) => name.includes(normalizeForMatch(k)));
  });
}

export function clickSettingsButton(): void {
  const btn = findSettingsButton();
  forceClick(btn);
}

