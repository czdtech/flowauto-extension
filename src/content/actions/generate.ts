import { findCreateButton, findPromptInput } from "../finders";
import { forceClick, sleep, waitFor } from "../utils/dom";

export interface GenerationWaitResult {
  newCount: number;
  baselineUrls: Set<string>;
}

const MIN_RESULT_PX = 80;

function getTrackableImgUrl(img: HTMLImageElement): string | null {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (src.startsWith("data:")) return null;
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
  const isDisabled =
    btn.disabled || btn.getAttribute("aria-disabled") === "true";
  if (isDisabled) {
    console.log(
      `[FlowAuto] 创建按钮处于禁用状态 (disabled=${btn.disabled}, aria-disabled=${btn.getAttribute("aria-disabled")})，尝试触发输入事件唤醒...`,
    );
    try {
      const input = findPromptInput();
      input.focus();
      if (
        input instanceof HTMLTextAreaElement ||
        input instanceof HTMLInputElement
      ) {
        input.value += " ";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        document.execCommand("insertText", false, " ");
      }
      await sleep(500);
    } catch (e) {
      console.warn("[FlowAuto] 唤醒按钮失败:", e);
    }
  }
  forceClick(btn);
  console.log(`[FlowAuto] 点击了创建按钮`);
}

/**
 * Wait for generation to complete using multiple signals:
 *
 *   Signal A (button): Create button re-enabled AFTER being disabled.
 *                       Only fires if the button was observed as disabled at
 *                       least once (the new Flow UI may keep the button enabled
 *                       throughout generation).
 *   Signal B (stability): New image URL count reached expectedCount AND
 *                         has been unchanged for STABLE_REQUIRED consecutive
 *                         polls.
 *   Signal C (loading): No loading/progress indicators remain AND at least
 *                       one new image has appeared.
 *
 * Returns baselineUrls so the download step can distinguish new from old.
 */
export async function waitForGenerationComplete(
  expectedCount: number,
  timeoutMs: number,
): Promise<GenerationWaitResult> {
  const baselineUrls = collectResultImageSrcs();
  const newUrls = new Set<string>();
  const pendingImgs = new Set<HTMLImageElement>();
  let observer: MutationObserver | null = null;

  console.log(
    `[FlowAuto] 等待生成完成: 基线图片URL数=${baselineUrls.size}, 期望新增=${expectedCount}, 超时=${timeoutMs}ms`,
  );

  // Give the request time to reach Flow's server.
  await sleep(3000);

  const STABLE_REQUIRED = 3; // 3 consecutive unchanged polls = ~6 s stable
  const PARTIAL_STABLE_REQUIRED = 2; // partial results stable for ~4 s
  let stableCount = 0;
  let lastNewCount = -1;
  let noLoadingStableCount = 0;
  let lastNoLoadingCount = -1;
  let logTimer = 0;
  let tick = 0;
  let buttonWasDisabled = false;
  // Signal D sets this flag instead of throwing, so waitFor exits immediately.
  let generationError: string | null = null;

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

    if (pendingImgs.size < 200) pendingImgs.add(img);
  };

  const scanNodeForImgs = (node: Node): void => {
    if (node instanceof HTMLImageElement) {
      recordImg(node);
      return;
    }
    if (!(node instanceof Element)) return;
    const imgs = node.querySelectorAll<HTMLImageElement>("img");
    let seen = 0;
    for (const img of imgs) {
      recordImg(img);
      seen++;
      if (seen >= 50) break;
    }
  };

  /**
   * Check if a newly added DOM node (or its subtree) contains failure text.
   * This is called from the MutationObserver callback, so it only runs on
   * NEW mutations — old failure cards from prior tasks are never checked.
   * We check text length to avoid matching huge parent containers that get
   * re-rendered; real failure cards have short, specific text.
   */
  const checkNodeForFailure = (node: Node): void => {
    if (generationError) return; // already detected
    if (!(node instanceof HTMLElement)) return;
    // Only check after initial render stabilizes (tick >= 3 is checked in the poll)
    if (tick < 3) return;

    const text = node.textContent || "";
    // Real failure cards have bounded text content (< 500 chars).
    // Huge containers (toolbar, gallery) have thousands of characters.
    if (text.length > 500 || text.length < 4) return;

    if (
      text.includes("失败") &&
      (text.includes("政策") || text.includes("违反"))
    ) {
      // Verify the element is visible and card-sized (not a tiny hidden span)
      const rect = node.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        console.error(
          `[FlowAuto] ❌ 信号D(MutationObserver): 检测到新失败卡片: "${text.substring(0, 100)}"`,
        );
        generationError = `生成失败（内容策略）: ${text.substring(0, 100)}`;
      }
    }
  };

  /**
   * Detect if the page is currently showing loading/progress indicators.
   * This handles the new Flow UI that uses progress bars or loading animations
   * instead of disabling the Create button.
   */
  const hasLoadingIndicators = (): boolean => {
    // Check for common loading patterns:
    // 1. Progress bars (circular or linear)
    const progressBars = document.querySelectorAll(
      '[role="progressbar"], [aria-busy="true"], .loading, [class*="progress"], [class*="loading"], [class*="spinner"]',
    );
    for (const el of progressBars) {
      if (
        el instanceof HTMLElement &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0
      ) {
        return true;
      }
    }

    // 2. Elements with percentage text (e.g., "48%")
    // Check image cards specifically for progress overlays
    const cards = document.querySelectorAll("img");
    for (const img of cards) {
      const parent = img.closest("[class]");
      if (!parent) continue;
      const siblings = parent.querySelectorAll("*");
      for (const sib of siblings) {
        const text = (sib.textContent || "").trim();
        if (
          /^\d{1,3}\s*%$/.test(text) &&
          sib instanceof HTMLElement &&
          sib.offsetWidth > 0
        ) {
          return true;
        }
      }
    }

    return false;
  };

  try {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            scanNodeForImgs(n);
            // Signal D: check newly added nodes for failure text
            checkNodeForFailure(n);
          }
        } else if (
          m.type === "attributes" &&
          m.target instanceof HTMLImageElement
        ) {
          recordImg(m.target);
        }
      }
    });
    observer.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
  } catch {
    // Best-effort
  }

  try {
    await waitFor(
      () => {
        tick++;

        // Signal D (immediate): if MutationObserver detected failure, exit now.
        if (generationError) {
          return true;
        }

        // Promote pending images.
        if (pendingImgs.size) {
          for (const img of Array.from(pendingImgs)) {
            if (!img.isConnected) {
              pendingImgs.delete(img);
              continue;
            }
            if (isLikelyResultImage(img)) recordImg(img);
          }
        }

        // Low-frequency full resync.
        if (tick % 4 === 0) {
          const currentUrls = collectResultImageSrcs();
          for (const u of currentUrls) {
            if (!baselineUrls.has(u)) newUrls.add(u);
          }
        }

        const newCount = newUrls.size;

        // Signal A: button was disabled and is now re-enabled.
        // IMPORTANT: Only fire if we previously observed the button as disabled.
        // In the new Flow UI, the button may NEVER become disabled.
        try {
          const btn = findCreateButton();
          const disabled =
            btn.disabled || btn.getAttribute("aria-disabled") === "true";
          if (disabled) {
            buttonWasDisabled = true;
            console.log(`[FlowAuto] 信号A: 创建按钮已变为 disabled`);
          } else if (buttonWasDisabled) {
            // Button was disabled and is now re-enabled — generation complete
            console.log(
              `[FlowAuto] ✅ 信号A: 创建按钮从 disabled 恢复为可用，新图片URL: ${newCount}`,
            );
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
            console.log(
              `[FlowAuto] ✅ 信号B: 新图片URL稳定在 ${newCount} 张，${STABLE_REQUIRED} 次轮询未变化，视为完成`,
            );
            return true;
          }
        } else {
          stableCount = 0;
          lastNewCount = newCount;
        }

        // Signal C: no loading indicators remain and image count is stable.
        // For expectedCount > 1, avoid returning immediately on the first new image.
        if (!buttonWasDisabled && newCount > 0 && !hasLoadingIndicators()) {
          if (newCount >= expectedCount) {
            console.log(
              `[FlowAuto] ✅ 信号C: 无加载指示器 + 有新图片(${newCount}), 视为完成`,
            );
            return true;
          }

          if (newCount === lastNoLoadingCount) {
            noLoadingStableCount++;
          } else {
            lastNoLoadingCount = newCount;
            noLoadingStableCount = 1;
          }

          if (noLoadingStableCount >= PARTIAL_STABLE_REQUIRED) {
            console.warn(
              `[FlowAuto] ⚠️ 信号C: 无加载且新增稳定在 ${newCount}/${expectedCount}，视为本轮结束`,
            );
            return true;
          }
        } else {
          noLoadingStableCount = 0;
          lastNoLoadingCount = -1;
        }

        logTimer++;
        if (logTimer % 3 === 0) {
          console.log(
            `[FlowAuto] 生成中... 新图片: ${newCount}/${expectedCount}, 稳定: ${stableCount}/${STABLE_REQUIRED}`,
          );
        }

        return null;
      },
      { timeoutMs, intervalMs: 2000, debugName: "wait-generation-complete" },
    );
  } finally {
    observer?.disconnect();
  }

  // If Signal D detected a failure, throw now (outside waitFor so it propagates).
  if (generationError) {
    throw new Error(generationError);
  }

  // Brief stabilization before download.
  await sleep(1500);

  // Final resync for accurate logging + downstream baseline filtering.
  const finalUrls = collectResultImageSrcs();
  for (const u of finalUrls) {
    if (!baselineUrls.has(u)) newUrls.add(u);
  }
  const actualNew = newUrls.size;
  console.log(
    `[FlowAuto] 生成完成！新增图片URL: ${actualNew} (基线: ${baselineUrls.size})`,
  );

  return { newCount: actualNew, baselineUrls };
}

export async function createAndWaitForGeneration(options: {
  expectedCount: number;
  timeoutMs: number;
}): Promise<GenerationWaitResult> {
  await clickCreate();
  await sleep(500);
  return await waitForGenerationComplete(
    options.expectedCount,
    options.timeoutMs,
  );
}
