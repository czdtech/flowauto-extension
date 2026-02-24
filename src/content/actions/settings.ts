import type { AspectRatio, GenerationMode, TaskItem } from '../../shared/types';
import { KEYWORDS } from '../selectors';
import { findModeCombobox, findSettingsButton, findSettingsCombobox } from '../finders';
import { getElementName, normalizeForMatch } from '../utils/aria';
import { findAllByRole, forceClick, isVisible, sleep, waitFor } from '../utils/dom';

function keywordMatch(text: string, keywords: readonly string[]): boolean {
  const n = normalizeForMatch(text);
  return keywords.some((k) => n.includes(normalizeForMatch(k)));
}

const POPUP_ITEM_SELECTOR =
  '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

function queryPopupItems(root: ParentNode): HTMLElement[] {
  const items = Array.from(root.querySelectorAll<HTMLElement>(POPUP_ITEM_SELECTOR));
  return items.filter((o) => o.isConnected && isVisible(o));
}

function distanceBetweenRects(a: DOMRect, b: DOMRect): number {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

function findOpenPopupRoot(anchor: HTMLElement): HTMLElement | null {
  // Prefer aria-controls/aria-owns when available (most reliable and cheapest).
  const byId =
    (anchor.getAttribute('aria-controls') || anchor.getAttribute('aria-owns'))?.trim() ?? '';
  if (byId) {
    const el = document.getElementById(byId);
    if (el && isVisible(el)) return el;
  }

  const candidates = [
    ...findAllByRole('listbox'),
    ...findAllByRole('menu'),
  ].filter((el) => el.isConnected && isVisible(el));

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // If multiple popups exist, pick the one nearest to the clicked combobox.
  const aRect = anchor.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    // Prefer candidates that already contain selectable items.
    const hasItems = queryPopupItems(c).length > 0;
    const cRect = c.getBoundingClientRect();
    const dist = distanceBetweenRects(aRect, cRect);
    const score = dist + (hasItems ? 0 : 10_000);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

async function waitForPopupItems(anchor: HTMLElement): Promise<{ root: HTMLElement; items: HTMLElement[] }> {
  return await waitFor(
    () => {
      const root = findOpenPopupRoot(anchor);
      if (!root) return null;
      const items = queryPopupItems(root);
      return items.length ? { root, items } : null;
    },
    // Slower polling + scoped queries drastically reduce CPU vs scanning the full document every 100ms.
    { timeoutMs: 8000, intervalMs: 200, debugName: 'options' }
  );
}

async function selectOptionFromCombobox(anchor: HTMLElement, optionKeywords: readonly string[]): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      forceClick(anchor);
      await sleep(250);

      const { items } = await waitForPopupItems(anchor);
      for (const opt of items) {
        const name = getElementName(opt);
        if (keywordMatch(name, optionKeywords) || keywordMatch(opt.textContent || '', optionKeywords)) {
          forceClick(opt);
          await sleep(250);
          return;
        }
      }

      const found = items.map((o) => `"${getElementName(o)}" [${o.getAttribute('role')}]`).join(', ');
      throw new Error(`Option not found: ${optionKeywords.join(' / ')}. Found items: ${found}`);
    } catch (e) {
      lastError = e;
      // Best-effort: close any open popup and retry the click (sometimes the first click is swallowed).
      try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* ignore */ }
      try { document.body.click(); } catch { /* ignore */ }
      await sleep(200);
    }
  }

  // Add extra context to debug why the dropdown didn't open / didn't render roles.
  const counts = {
    option: findAllByRole('option').length,
    menuitem: findAllByRole('menuitem').length,
    menuitemradio: findAllByRole('menuitemradio').length,
    menuitemcheckbox: findAllByRole('menuitemcheckbox').length,
    listbox: findAllByRole('listbox').length,
    menu: findAllByRole('menu').length,
  };

  // Keep the original error prefix so logs stay searchable.
  throw new Error(
    `waitFor timeout (options). roleCounts=${JSON.stringify(counts)}. rootErr=${String(lastError)}`
  );
}

export async function openSettingsPanel(): Promise<void> {
  const btn = findSettingsButton();
  const isOpen = (): boolean => {
    const expanded = btn.getAttribute('aria-expanded');
    if (expanded === 'true') return true;

    // Some builds don't expose aria-expanded. If any settings combobox is already visible, treat as open.
    const boxes = findAllByRole('combobox').filter(isVisible);
    return boxes.some((box) => {
      const name = getElementName(box);
      return (
        keywordMatch(name, KEYWORDS.aspectRatio) ||
        keywordMatch(name, KEYWORDS.outputCount) ||
        keywordMatch(name, KEYWORDS.model)
      );
    });
  };

  if (isOpen()) {
    console.log(`[FlowAuto] 设置面板已展开 (已检测到展开状态)`);
    return;
  }

  console.log(`[FlowAuto] 点击打开设置面板`);
  forceClick(btn);
  await waitFor(() => (isOpen() ? true : null), {
    timeoutMs: 2500,
    intervalMs: 200,
    debugName: 'open-settings-panel',
  });
  await sleep(150);
}

export async function setMode(mode: GenerationMode): Promise<void> {
  const box = findModeCombobox();

  const optionKeywords =
    mode === 'text-to-video'
      ? KEYWORDS.modeTextToVideo
      : mode === 'ingredients'
        ? KEYWORDS.modeIngredients
        : mode === 'create-image'
          ? KEYWORDS.modeCreateImage
          : KEYWORDS.modeFramesToVideo;

  const current = getElementName(box);
  if (keywordMatch(current, optionKeywords)) {
    console.log(`[FlowAuto] 当前已是目标模式: ${mode}`);
    return;
  }

  console.log(`[FlowAuto] 更改模式为: ${mode}（当前: "${current}"）`);
  await selectOptionFromCombobox(box, optionKeywords);
  await sleep(500);
}

export async function setAspectRatio(aspectRatio: AspectRatio): Promise<void> {
  await openSettingsPanel();

  const box = findSettingsCombobox('aspectRatio');
  const current = getElementName(box);
  if (current.includes(aspectRatio)) return;

  console.log(`[FlowAuto] 更改画幅为: ${aspectRatio}`);
  await selectOptionFromCombobox(box, [aspectRatio]);
}

export async function setOutputCount(outputCount: number): Promise<void> {
  await openSettingsPanel();

  const box = findSettingsCombobox('outputCount');
  const current = getElementName(box);
  const desired = String(outputCount);
  if (current.includes(desired)) return;

  console.log(`[FlowAuto] 更改 outputs 为: ${outputCount}`);
  await selectOptionFromCombobox(box, [desired]);
}

function modelOptionKeywords(model: TaskItem['model']): string[] {
  switch (model) {
    case 'veo3.1-fast':
      return ['Veo 3.1 - Fast', '3.1', 'Fast'];
    case 'veo3.1-quality':
      return ['Veo 3.1 - Quality', '3.1', 'Quality'];
    case 'veo2-fast':
      return ['Veo 2 - Fast', 'Veo 2', 'Fast'];
    case 'veo2-quality':
      return ['Veo 2 - Quality', 'Veo 2', 'Quality'];
    case 'nano-banana-pro':
      return ['Nano Banana Pro', 'Banana Pro', '🍌'];
    case 'nano-banana':
      return ['Nano Banana', 'Banana', '🍌'];
    case 'imagen4':
      return ['Imagen 4', 'Imagen'];
    default:
      return [String(model)];
  }
}

export async function setModel(model: TaskItem['model']): Promise<void> {
  await openSettingsPanel();

  const box = findSettingsCombobox('model');
  const current = getElementName(box);
  const desiredKeywords = modelOptionKeywords(model);
  if (keywordMatch(current, desiredKeywords)) return;

  console.log(`[FlowAuto] 更改模型为: ${model}`);
  await selectOptionFromCombobox(box, desiredKeywords);
}

