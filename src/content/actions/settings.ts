import type { AspectRatio, GenerationMode, TaskItem } from "../../shared/types";
import { logger } from "../../shared/logger";
import { KEYWORDS } from "../selectors";
import { findModelDropdown, findSettingsToggle } from "../finders";
import { getElementName, normalizeForMatch } from "../utils/aria";
import {
  findAllByRole,
  forceClick,
  isVisible,
  sleep,
  waitFor,
} from "../utils/dom";

function keywordMatch(text: string, keywords: readonly string[]): boolean {
  const n = normalizeForMatch(text);
  return keywords.some((k) => n.includes(normalizeForMatch(k)));
}

// ---------------------------------------------------------------------------
// Settings panel toggle
// ---------------------------------------------------------------------------

export async function openSettingsPanel(): Promise<void> {
  let toggle: HTMLButtonElement | null = null;
  try {
    toggle = await waitFor(() => findSettingsToggle() || null, {
      timeoutMs: 15000,
      intervalMs: 500,
      debugName: "findSettingsToggle",
    });
  } catch (e) {
    logger.warn("未找到设置面板切换按钮，跳过");
    return;
  }

  if (toggle.getAttribute("aria-expanded") === "true") return;

  logger.debug("展开设置面板");
  forceClick(toggle);
  await waitFor(
    () => (toggle.getAttribute("aria-expanded") === "true" ? true : null),
    { timeoutMs: 3000, intervalMs: 200, debugName: "open-settings-panel" },
  );
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Generic tab selection helper
// ---------------------------------------------------------------------------

async function clickTabByKeywords(keywords: readonly string[]): Promise<void> {
  await openSettingsPanel();

  const matchers = keywords.map((k) => normalizeForMatch(k));
  let target: HTMLElement | null = null;

  try {
    target = await waitFor(
      () => {
        const tabs = findAllByRole("tab").filter(isVisible);
        return (
          tabs.find((t) => {
            const name = normalizeForMatch(getElementName(t));
            return matchers.some((k) => name.includes(k));
          }) || null
        );
      },
      {
        timeoutMs: 10000,
        intervalMs: 500,
        debugName: `clickTabByKeywords-${keywords.join("-")}`,
      },
    );
  } catch (e) {
    const tabs = findAllByRole("tab").filter(isVisible);
    const found = tabs.map((t) => `"${getElementName(t)}"`).join(", ");
    throw new Error(
      `Tab not found: ${keywords.join(" / ")}. Visible tabs: ${found}`,
    );
  }

  if (target && target.getAttribute("aria-selected") === "true") return;

  if (target) {
    forceClick(target);
    await sleep(400);
  }
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export async function setMode(mode: GenerationMode): Promise<void> {
  if (mode === "create-image") return;

  if (
    mode === "text-to-video" ||
    mode === "frames-first" ||
    mode === "frames-first-last"
  ) {
    try {
      await clickTabByKeywords(KEYWORDS.videoModeFrames);
    } catch {
      logger.debug(
        "Frames sub-tab not found; may already be default",
      );
    }
    return;
  }

  if (mode === "ingredients") {
    await clickTabByKeywords(KEYWORDS.videoModeIngredients);
    return;
  }

  logger.warn(
    `模式 "${mode}" 在新 UI 中可能不再可用，跳过模式设置`,
  );
}

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

const ASPECT_RATIO_KEYWORDS: Record<AspectRatio, readonly string[]> = {
  "16:9": KEYWORDS.aspect_16_9,
  "4:3": KEYWORDS.aspect_4_3,
  "1:1": KEYWORDS.aspect_1_1,
  "3:4": KEYWORDS.aspect_3_4,
  "9:16": KEYWORDS.aspect_9_16,
};

export async function setAspectRatio(aspectRatio: AspectRatio): Promise<void> {
  await clickTabByKeywords(ASPECT_RATIO_KEYWORDS[aspectRatio]);
}

// ---------------------------------------------------------------------------
// Output count
// ---------------------------------------------------------------------------

export async function setOutputCount(outputCount: number): Promise<void> {
  await clickTabByKeywords([`x${outputCount}`]);
}

// ---------------------------------------------------------------------------
// Model (dropdown menu)
// ---------------------------------------------------------------------------

const POPUP_ITEM_SELECTOR =
  '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

function queryPopupItems(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(POPUP_ITEM_SELECTOR),
  ).filter((o) => o.isConnected && isVisible(o));
}

function findOpenPopupRoot(anchor: HTMLElement): HTMLElement | null {
  const byId =
    (
      anchor.getAttribute("aria-controls") || anchor.getAttribute("aria-owns")
    )?.trim() ?? "";
  if (byId) {
    const el = document.getElementById(byId);
    if (el && isVisible(el)) return el;
  }

  const candidates = [
    ...findAllByRole("listbox"),
    ...findAllByRole("menu"),
  ].filter((el) => el.isConnected && isVisible(el));

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const aRect = anchor.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const cRect = c.getBoundingClientRect();
    const dx = aRect.left + aRect.width / 2 - (cRect.left + cRect.width / 2);
    const dy = aRect.top + aRect.height / 2 - (cRect.top + cRect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

async function waitForPopupItems(
  anchor: HTMLElement,
): Promise<{ root: HTMLElement; items: HTMLElement[] }> {
  return await waitFor(
    () => {
      const root = findOpenPopupRoot(anchor);
      if (!root) return null;
      const items = queryPopupItems(root);
      return items.length ? { root, items } : null;
    },
    { timeoutMs: 8000, intervalMs: 200, debugName: "popup-items" },
  );
}

async function selectFromPopup(
  anchor: HTMLElement,
  optionKeywords: readonly string[],
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      forceClick(anchor);
      await sleep(300);

      const { items } = await waitForPopupItems(anchor);
      for (const opt of items) {
        const name = getElementName(opt);
        if (
          keywordMatch(name, optionKeywords) ||
          keywordMatch(opt.textContent || "", optionKeywords)
        ) {
          forceClick(opt);
          await sleep(300);
          return;
        }
      }

      const found = items.map((o) => `"${getElementName(o)}"`).join(", ");
      throw new Error(
        `Option not found: ${optionKeywords.join(" / ")}. Found: ${found}`,
      );
    } catch (e) {
      lastError = e;
      try {
        (document.activeElement as HTMLElement | null)?.blur();
      } catch {
        /* ignore */
      }
      try {
        document.body.click();
      } catch {
        /* ignore */
      }
      await sleep(200);
    }
  }

  throw new Error(
    `Model selection failed after ${MAX_ATTEMPTS} attempts. Last: ${String(lastError)}`,
  );
}

function modelOptionKeywords(model: TaskItem["model"]): string[] {
  switch (model) {
    case "veo3.1-fast":
      return ["Veo 3.1 - Fast"];
    case "veo3.1-quality":
      return ["Veo 3.1 - Quality"];
    case "nano-banana-pro":
      return ["Banana Pro"];
    case "nano-banana-2":
      return ["Banana 2"];
    case "imagen4":
      return ["Imagen 4", "Imagen"];
    default:
      return [String(model)];
  }
}

export async function setModel(model: TaskItem["model"]): Promise<void> {
  await openSettingsPanel();

  const dropdown = findModelDropdown();
  if (!dropdown) {
    logger.warn("未找到模型下拉按钮，跳过模型设置");
    return;
  }

  const currentName = getElementName(dropdown);
  const desiredKeywords = modelOptionKeywords(model);
  if (keywordMatch(currentName, desiredKeywords)) return;

  logger.info(`更改模型为: ${model}`);
  await selectFromPopup(dropdown, desiredKeywords);
}
