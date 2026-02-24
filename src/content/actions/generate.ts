import { findCreateButton } from '../finders';
import { forceClick, sleep, waitFor } from '../utils/dom';

export interface GenerationWaitResult {
  newCount: number;
  baselineUrls: Set<string>;
}

const MIN_RESULT_PX = 80;

function getTrackableImgUrl(img: HTMLImageElement): string | null {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (src.startsWith('data:')) return null;
  return src;
}

function isLikelyResultImage(img: HTMLImageElement): boolean {
  // Prefer natural size (no layout), fall back to rendered size.
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (nw >= MIN_RESULT_PX && nh >= MIN_RESULT_PX) return true;

  const w = img.clientWidth || img.width || 0;
  const h = img.clientHeight || img.height || 0;
  return w >= MIN_RESULT_PX && h >= MIN_RESULT_PX;
}

/**
 * Collect src URLs of all "result" images currently on the page.
 * Used to distinguish new images from pre-existing ones after generation.
 */
export function collectResultImageSrcs(): Set<string> {
  const urls = new Set<string>();
  const imgs = Array.from(document.images);
  for (const img of imgs) {
    if (!img.isConnected) continue;
    const src = getTrackableImgUrl(img);
    if (!src) continue;
    if (!isLikelyResultImage(img)) continue;
    urls.add(src);
  }
  return urls;
}

export async function clickCreate(): Promise<void> {
  const btn = findCreateButton();
  if (btn.disabled) {
    console.log(`[FlowAuto] 创建按钮暂时 disabled，等待 500ms...`);
    await sleep(500);
  }
  forceClick(btn);
  console.log(`[FlowAuto] 点击了创建按钮`);
}

/**
 * Wait for generation to complete using two independent signals:
 *
 *   Signal A (button): Create button re-enabled after being disabled.
 *   Signal B (stability): New image URL count reached expectedCount AND
 *                         has been unchanged for STABLE_REQUIRED consecutive
 *                         polls (= STABLE_REQUIRED * intervalMs ms).
 *
 * Either signal alone can declare completion. Signal B prevents the 120 s
 * timeout when Flow leaves the button disabled after generation finishes.
 *
 * Returns baselineUrls so the download step can distinguish new from old.
 */
export async function waitForGenerationComplete(
  expectedCount: number,
  timeoutMs: number
): Promise<GenerationWaitResult> {
  const baselineUrls = collectResultImageSrcs();
  const newUrls = new Set<string>();
  const pendingImgs = new Set<HTMLImageElement>();
  let observer: MutationObserver | null = null;

  console.log(`[FlowAuto] 等待生成完成: 基线图片URL数=${baselineUrls.size}, 期望新增=${expectedCount}, 超时=${timeoutMs}ms`);

  // Give the request time to reach Flow's server and the button to go disabled.
  await sleep(3000);

  const STABLE_REQUIRED = 3; // 3 consecutive unchanged polls = ~6 s stable
  let stableCount = 0;
  let lastNewCount = -1;
  let logTimer = 0;
  let tick = 0;

  const recordImg = (img: HTMLImageElement): void => {
    if (!img.isConnected) return;
    const src = getTrackableImgUrl(img);
    if (!src) return;
    if (baselineUrls.has(src)) return;

    if (isLikelyResultImage(img)) {
      newUrls.add(src);
      pendingImgs.delete(img);
      return;
    }

    // Keep a small pending set so we can "promote" images that were 0x0 while loading.
    if (pendingImgs.size < 200) pendingImgs.add(img);
  };

  const scanNodeForImgs = (node: Node): void => {
    if (node instanceof HTMLImageElement) {
      recordImg(node);
      return;
    }
    if (!(node instanceof Element)) return;
    const imgs = node.querySelectorAll<HTMLImageElement>('img');
    // Avoid worst-case spikes if a large subtree is injected; a periodic resync covers misses.
    let seen = 0;
    for (const img of imgs) {
      recordImg(img);
      seen++;
      if (seen >= 50) break;
    }
  };

  try {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) scanNodeForImgs(n);
        } else if (m.type === 'attributes' && m.target instanceof HTMLImageElement) {
          recordImg(m.target);
        }
      }
    });
    observer.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });
  } catch {
    // Best-effort: if MutationObserver fails for any reason, we still have the polling resync below.
  }

  try {
    await waitFor(
      () => {
        tick++;

        // Promote pending images that become "real" thumbnails after load/layout.
        if (pendingImgs.size) {
          for (const img of Array.from(pendingImgs)) {
            if (!img.isConnected) { pendingImgs.delete(img); continue; }
            if (isLikelyResultImage(img)) recordImg(img);
          }
        }

        // Low-frequency full resync keeps Signal B robust even if we miss some mutations.
        if (tick % 4 === 0) {
          const currentUrls = collectResultImageSrcs();
          for (const u of currentUrls) {
            if (!baselineUrls.has(u)) newUrls.add(u);
          }
        }

        const newCount = newUrls.size;

        // Signal A: button re-enabled.
        try {
          const btn = findCreateButton();
          const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
          if (!disabled) {
            console.log(`[FlowAuto] ✅ 信号A: 创建按钮已恢复可用，新图片URL: ${newCount}`);
            return true;
          }
        } catch {
          // Button not found — skip this signal.
        }

        // Signal B: image count reached expected AND has been stable.
        if (newCount >= expectedCount) {
          if (newCount === lastNewCount) {
            stableCount++;
          } else {
            stableCount = 1;
            lastNewCount = newCount;
          }
          if (stableCount >= STABLE_REQUIRED) {
            console.log(`[FlowAuto] ✅ 信号B: 新图片URL稳定在 ${newCount} 张，${STABLE_REQUIRED} 次轮询未变化，视为完成`);
            return true;
          }
        } else {
          stableCount = 0;
          lastNewCount = newCount;
        }

        logTimer++;
        if (logTimer % 2 === 0) {
          console.log(`[FlowAuto] 生成中... 新图片URL: ${newCount}/${expectedCount}, 稳定计数: ${stableCount}/${STABLE_REQUIRED}`);
        }

        return null;
      },
      { timeoutMs, intervalMs: 2000, debugName: 'wait-generation-complete' }
    );
  } finally {
    observer?.disconnect();
  }

  // Brief stabilization before download.
  await sleep(1500);

  // Final resync for accurate logging + downstream baseline filtering.
  const finalUrls = collectResultImageSrcs();
  for (const u of finalUrls) {
    if (!baselineUrls.has(u)) newUrls.add(u);
  }
  const actualNew = newUrls.size;
  console.log(`[FlowAuto] 生成完成！新增图片URL: ${actualNew} (基线: ${baselineUrls.size})`);

  return { newCount: expectedCount, baselineUrls };
}

export async function createAndWaitForGeneration(options: {
  expectedCount: number;
  timeoutMs: number;
}): Promise<GenerationWaitResult> {
  await clickCreate();
  await sleep(500);
  return await waitForGenerationComplete(options.expectedCount, options.timeoutMs);
}
