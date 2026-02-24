import { getElementName, normalizeForMatch } from '../utils/aria';
import { findAllByRole, forceClick, isVisible, sleep, waitFor } from '../utils/dom';

export type TopTab = 'video' | 'image';

function isChecked(el: HTMLElement): boolean {
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked) return ariaChecked === 'true';
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected) return ariaSelected === 'true';
  // Fallback: some radios reflect state via classnames; ignore.
  return false;
}

export function getActiveTopTab(): TopTab | null {
  const radios = findAllByRole('radio').filter(isVisible);
  if (!radios.length) return null;

  const videoWanted = ['视频', 'videocam', 'video'];
  const imageWanted = ['图片', 'image'];
  const videoMatchers = videoWanted.map((k) => normalizeForMatch(k));
  const imageMatchers = imageWanted.map((k) => normalizeForMatch(k));

  const matchesKind = (el: HTMLElement, kind: TopTab): boolean => {
    const name = normalizeForMatch(getElementName(el));
    const matchers = kind === 'video' ? videoMatchers : imageMatchers;
    return matchers.some((k) => name.includes(k));
  };

  // Prefer checked state first (most reliable).
  for (const r of radios) {
    if (!isChecked(r)) continue;
    if (matchesKind(r, 'video')) return 'video';
    if (matchesKind(r, 'image')) return 'image';
  }

  // If checked state isn't exposed, fall back to "first matching" only when
  // there's exactly one kind present (prevents mis-detection).
  const hasVideo = radios.some((r) => matchesKind(r, 'video'));
  const hasImage = radios.some((r) => matchesKind(r, 'image'));
  if (hasVideo && !hasImage) return 'video';
  if (hasImage && !hasVideo) return 'image';

  return null;
}

export async function selectTab(tab: TopTab): Promise<void> {
  const radios = findAllByRole('radio').filter(isVisible);
  const wanted = tab === 'video' ? ['视频', 'videocam', 'video'] : ['图片', 'image'];
  const matchers = wanted.map((k) => normalizeForMatch(k));

  const target = radios.find((r) => matchers.some((k) => normalizeForMatch(getElementName(r)).includes(k)));
  if (!target) {
    console.warn(`[FlowAuto] selectTab: 未找到 ${tab} 标签页按钮，可能是选择器失效`);
    return;
  }

  if (isChecked(target)) {
    console.log(`[FlowAuto] selectTab: 已经在 ${tab} 标签页`);
    return;
  }
  forceClick(target);

  // Wait a moment for results grid to switch.
  await sleep(200);
  await waitFor(
    () => (isChecked(target) ? true : null),
    { timeoutMs: 2000, intervalMs: 100, debugName: 'selectTab' }
  );
  console.log(`[FlowAuto] selectTab: 成功切换到 ${tab}`);
}

