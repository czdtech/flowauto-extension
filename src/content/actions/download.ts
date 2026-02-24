import { MSG } from '../../shared/constants';
import { sleep } from '../utils/dom';

export type MediaType = 'image' | 'video';

export interface DownloadNamingHint {
  dir: string;
  baseName: string;
  taskId: string;
  outputIndex: number;
}

const MIN_RESULT_PX = 80;

function isLikelyResultThumbnail(img: HTMLImageElement): boolean {
  // Prefer natural size (no layout), fall back to rendered size.
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (nw >= MIN_RESULT_PX && nh >= MIN_RESULT_PX) return true;

  const w = img.clientWidth || img.width || 0;
  const h = img.clientHeight || img.height || 0;
  return w >= MIN_RESULT_PX && h >= MIN_RESULT_PX;
}

/**
 * Given an <img> element, walk up the DOM tree to find the card wrapper.
 * A "card" is the nearest ancestor that contains at least 2 buttons
 * (overlay action buttons like download, favorite, etc.).
 */
function findCardWrapper(img: HTMLImageElement): Element | null {
  let el: Element | null = img.parentElement;
  let depth = 0;
  while (el && el !== document.body && depth < 12) {
    if (el.getElementsByTagName('button').length >= 2) return el;
    el = el.parentElement;
    depth++;
  }
  return null;
}

/**
 * Get all result image cards sorted by DOM order (newest first in Flow's grid).
 */
function getResultCards(): { img: HTMLImageElement; card: Element }[] {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
  const results: { img: HTMLImageElement; card: Element }[] = [];
  const seenCards = new Set<Element>();

  for (const img of imgs) {
    if (!img.isConnected) continue;
    if (!img.src || img.src.startsWith('data:')) continue;
    if (!isLikelyResultThumbnail(img)) continue;

    const card = findCardWrapper(img);
    if (card && !seenCards.has(card)) {
      seenCards.add(card);
      results.push({ img, card });
    }
  }

  return results;
}

/**
 * Download images by directly extracting img.src and sending to background
 * for chrome.downloads.download(). This completely bypasses the hover/overlay
 * complexity that was causing unreliable downloads.
 */
export async function downloadTopNLatestWithNaming(
  mediaType: MediaType,
  n: number,
  naming: (outputIndex: number) => DownloadNamingHint,
  baselineUrls?: Set<string>
): Promise<void> {
  if (mediaType === 'image') {
    await downloadImagesDirectly(n, naming, baselineUrls);
  } else {
    await downloadVideosFallback(n, naming);
  }
}

async function downloadImagesDirectly(
  n: number,
  naming: (outputIndex: number) => DownloadNamingHint,
  baselineUrls?: Set<string>
): Promise<void> {
  const cards = getResultCards();

  let targets: { img: HTMLImageElement; card: Element }[];
  if (baselineUrls && baselineUrls.size > 0) {
    const newCards = cards.filter(c => !baselineUrls.has(c.img.src));
    console.log(`[FlowAuto] 找到 ${cards.length} 张卡片，其中 ${newCards.length} 张为新生成，下载前 ${n} 张`);
    targets = newCards.slice(0, n);
  } else {
    console.log(`[FlowAuto] 找到 ${cards.length} 张卡片（无基线），下载最后 ${n} 张`);
    targets = cards.slice(-n);
  }

  if (targets.length === 0) {
    console.warn(`[FlowAuto] 未找到任何图片卡片，跳过下载`);
    return;
  }

  let downloaded = 0;

  for (let i = 0; i < targets.length; i++) {
    const { img } = targets[i];
    const hint = naming(i + 1);
    const src = img.src;

    if (!src || src.startsWith('data:')) {
      console.warn(`[FlowAuto] 第 ${i + 1} 张图片 src 无效 (${src?.substring(0, 30)}...)，跳过`);
      continue;
    }

    console.log(`[FlowAuto] 下载图片 ${i + 1}/${targets.length}: ${src.substring(0, 80)}...`);

    try {
      await chrome.runtime.sendMessage({
        type: MSG.DOWNLOAD_BY_URL,
        url: src,
        dir: hint.dir,
        baseName: hint.baseName,
      });
      downloaded++;
    } catch (e) {
      console.error(`[FlowAuto] 下载消息发送失败:`, e);
    }

    await sleep(300);
  }

  console.log(`[FlowAuto] 图片下载完成！成功发起 ${downloaded}/${targets.length} 张`);
}

/**
 * Video download fallback: still uses the overlay button approach since
 * videos can't be downloaded from a simple img.src.
 * (Will be improved in later milestones.)
 */
async function downloadVideosFallback(
  n: number,
  naming: (outputIndex: number) => DownloadNamingHint
): Promise<void> {
  console.log(`[FlowAuto] 视频下载暂未实现直接下载，跳过 (共 ${n} 个)`);
  // TODO: Implement video download via overlay buttons or API in M5+.
  void naming;
}
