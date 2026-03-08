import { getElementName, normalizeForMatch } from '../utils/aria';
import { findAllByRole, forceClick, isVisible, sleep, waitFor } from '../utils/dom';
import { openSettingsPanel } from './settings';

export type TopTab = 'video' | 'image';

export function getActiveTopTab(): TopTab | null {
  const tabs = findAllByRole('tab').filter(isVisible);

  const videoMatchers = ['videocam', 'video'].map(normalizeForMatch);
  const imageMatchers = ['image'].map(normalizeForMatch);

  for (const tab of tabs) {
    if (tab.getAttribute('aria-selected') !== 'true') continue;
    const name = normalizeForMatch(getElementName(tab));
    if (videoMatchers.some((k) => name.includes(k))) return 'video';
    if (imageMatchers.some((k) => name.includes(k))) return 'image';
  }

  // Fallback: infer from settings toggle button text when panel is collapsed.
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const b of buttons) {
    if (!b.hasAttribute('aria-expanded')) continue;
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (name.includes('arrow_drop_down')) continue;
    if (name.includes('视频') || name.includes('veo')) return 'video';
    if (name.includes('nano') || name.includes('imagen') || name.includes('banana')) return 'image';
  }

  return null;
}

export async function selectTab(tab: TopTab): Promise<void> {
  await openSettingsPanel();

  const wanted = tab === 'video' ? ['videocam', 'video'] : ['image'];
  const matchers = wanted.map(normalizeForMatch);

  let target: HTMLElement | null = null;
  try {
    target = await waitFor(() => {
      const tabs = findAllByRole('tab').filter(isVisible);
      return tabs.find((t) => {
        const name = normalizeForMatch(getElementName(t));
        return matchers.some((k) => name.includes(k));
      }) || null;
    }, { timeoutMs: 10000, intervalMs: 500, debugName: `selectTab-${tab}` });
  } catch (e) {
    console.warn(`[FlowAuto] selectTab: 未找到 ${tab} 标签页按钮`);
    return;
  }

  if (!target) return;

  if (target.getAttribute('aria-selected') === 'true') {
    console.log(`[FlowAuto] selectTab: 已经在 ${tab} 标签页`);
    return;
  }

  forceClick(target);
  await sleep(500);
  console.log(`[FlowAuto] selectTab: 成功切换到 ${tab}`);
}
