import { KEYWORDS, SELECTORS } from "./selectors";
import { getElementName, normalizeForMatch } from "./utils/aria";
import { isVisible } from "./utils/dom";
import { logger } from "../shared/logger";

// ---------------------------------------------------------------------------
// Shadow DOM aware querying
// ---------------------------------------------------------------------------

/**
 * Recursively collect all elements matching a selector, including those
 * inside open shadow roots. This handles Web Component-based UIs.
 */
export function querySelectorAllDeep<T extends Element>(
  selector: string,
  root: ParentNode = document,
): T[] {
  const results: T[] = [];
  const regular = Array.from(root.querySelectorAll<T>(selector));
  results.push(...regular);

  // Traverse shadow roots
  const allElements = root.querySelectorAll("*");
  for (const el of allElements) {
    if (el.shadowRoot) {
      results.push(...querySelectorAllDeep<T>(selector, el.shadowRoot));
    }
  }
  return results;
}

function findAllByRoleDeep(role: string): HTMLElement[] {
  return querySelectorAllDeep<HTMLElement>(`[role="${role}"]`);
}

// ---------------------------------------------------------------------------
// Prompt input
// ---------------------------------------------------------------------------

export function findPromptInput(): HTMLTextAreaElement | HTMLElement {
  // Method 1: Standard textarea (classic approach)
  const textareas = querySelectorAllDeep<HTMLTextAreaElement>(
    SELECTORS.textarea,
  );
  for (const ta of textareas) {
    if ((ta.className || "").includes("recaptcha")) continue;
    if (!isVisible(ta)) continue;
    logger.debug(
      `findPromptInput: 找到 textarea, class="${ta.className.substring(0, 50)}", placeholder="${(ta.placeholder || "").substring(0, 50)}"`,
    );
    return ta;
  }

  // Method 2: role="textbox" elements
  const textboxes = findAllByRoleDeep("textbox").filter(isVisible);
  const promptMatchers = KEYWORDS.prompt.map((k) => normalizeForMatch(k));
  for (const tb of textboxes) {
    const name = normalizeForMatch(getElementName(tb));
    if (promptMatchers.some((k) => name.includes(k))) {
      logger.debug(
        `findPromptInput: 通过 ARIA 名称匹配找到 textbox: "${getElementName(tb)}"`,
      );
      return tb;
    }
  }

  // Method 3: contenteditable elements (common in new UIs)
  const editables = querySelectorAllDeep<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"]',
  ).filter(isVisible);
  for (const ce of editables) {
    const name = normalizeForMatch(getElementName(ce));
    const skipMatchers = ["search", "搜索", "可编辑文本", "editable text"].map(
      normalizeForMatch,
    );
    // Skip elements that look like the project name editor or search
    if (skipMatchers.some((k) => name.includes(k))) continue;
    // Heuristic: prompt inputs are typically larger than other editables
    const rect = ce.getBoundingClientRect();
    if (rect.width > 150) {
      logger.debug(
        `findPromptInput: 找到 contentEditable, tag=${ce.tagName}, aria="${ce.getAttribute("aria-label")}", size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
      return ce;
    }
  }

  // Method 4: Any textbox, skipping known non-prompt ones
  const skipMatchers = ["search", "搜索", "可编辑文本", "editable text"].map(
    normalizeForMatch,
  );
  for (const tb of textboxes) {
    const name = normalizeForMatch(getElementName(tb));
    if (skipMatchers.some((k) => name.includes(k))) continue;
    logger.debug(
      `findPromptInput: 回退到第一个可见 textbox: "${getElementName(tb)}"`,
    );
    return tb;
  }

  // Method 5: Any visible contentEditable that's large enough
  for (const ce of editables) {
    const rect = ce.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 30) {
      logger.debug(
        `findPromptInput: 最终回退到 contentEditable: tag=${ce.tagName}, size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
      return ce;
    }
  }

  // Log all candidates for debugging
  logger.error(
    `findPromptInput 失败! textareas=${textareas.length}, textboxes=${textboxes.length}, editables=${editables.length}`,
  );
  textboxes.forEach((tb, i) => {
    logger.debug(
      `  textbox[${i}]: tag=${tb.tagName}, visible=${isVisible(tb)}, name="${getElementName(tb).substring(0, 60)}"`,
    );
  });
  editables.forEach((ce, i) => {
    logger.debug(
      `  editable[${i}]: tag=${ce.tagName}, visible=${isVisible(ce)}, role="${ce.getAttribute("role")}", name="${getElementName(ce).substring(0, 60)}"`,
    );
  });

  throw new Error("未找到输入框 (Prompt input not found)");
}

// ---------------------------------------------------------------------------
// Create button
// ---------------------------------------------------------------------------

/**
 * Find the main submit/create button, excluding dropdown toggle buttons
 * that also contain "创建" text.
 */
export function findCreateButton(): HTMLButtonElement {
  const buttons = querySelectorAllDeep<HTMLButtonElement>(SELECTORS.buttons);
  const matchers = KEYWORDS.create.map((k) => normalizeForMatch(k));

  // Highest priority: button with type="submit" (DOM property, not just HTML attribute)
  const submitBtns = buttons.filter((b) => b.type === "submit" && isVisible(b));
  for (const b of submitBtns) {
    const name = normalizeForMatch(getElementName(b));
    if (matchers.some((k) => name.includes(k))) {
      logger.debug(
        `findCreateButton: 通过 type="submit" + 文本匹配: "${getElementName(b).substring(0, 40)}", disabled=${b.disabled}, aria-disabled=${b.getAttribute("aria-disabled")}`,
      );
      return b;
    }
  }

  // Primary: visible button with matching text/aria-label, not a dropdown toggle
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    if (b.hasAttribute("aria-expanded")) continue;
    const name = normalizeForMatch(getElementName(b));
    if (matchers.some((k) => name.includes(k))) {
      logger.debug(
        `findCreateButton: 找到创建按钮, disabled=${b.disabled}, text="${getElementName(b).substring(0, 40)}"`,
      );
      return b;
    }
  }

  // Fallback: look for any button with a "create" icon (Material icons)
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    if (b.hasAttribute("aria-expanded")) continue;
    const text = normalizeForMatch(b.textContent || "");
    // Material icon names like "add", "send", "create"
    if (text.includes("send") || text.includes("add_circle")) {
      logger.debug(
        `findCreateButton: 通过 Material Icon 找到按钮: "${(b.textContent || "").trim().substring(0, 40)}"`,
      );
      return b;
    }
  }

  // Log debugging info
  logger.error(`findCreateButton 失败!`);
  let count = 0;
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    count++;
    if (count <= 15) {
      logger.debug(
        `  button[${count}]: text="${getElementName(b).substring(0, 60)}", disabled=${b.disabled}, expanded=${b.getAttribute("aria-expanded")}`,
      );
    }
  }
  logger.debug(`  总可见按钮: ${count}`);

  throw new Error("未找到创建按钮 (Create button not found)");
}

// ---------------------------------------------------------------------------
// Settings panel toggle
// ---------------------------------------------------------------------------

/**
 * The settings panel toggle button whose name contains both crop info and
 * output count (e.g. "🍌 Nano Banana 2 crop_16_9 x2").
 */
export function findSettingsToggle(): HTMLButtonElement | null {
  const buttons = querySelectorAllDeep<HTMLButtonElement>(SELECTORS.buttons);
  for (const b of buttons) {
    if (!b.hasAttribute("aria-expanded")) continue;
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (name.includes("arrow_drop_down")) continue;
    if (/crop_/.test(name) && /x\d/.test(name)) return b;
  }

  // Fallback: any aria-expanded button that looks like a settings toggle
  // (contains model names or aspect ratio references)
  for (const b of buttons) {
    if (!b.hasAttribute("aria-expanded")) continue;
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (name.includes("arrow_drop_down")) continue;
    // Match model names or aspect ratio indicators
    if (
      name.includes("banana") ||
      name.includes("imagen") ||
      name.includes("veo") ||
      name.includes("16:9") ||
      name.includes("9:16") ||
      name.includes("crop")
    ) {
      logger.debug(
        `findSettingsToggle: 通过模型/画幅关键词找到: "${getElementName(b).substring(0, 60)}"`,
      );
      return b;
    }
  }

  logger.warn(`findSettingsToggle: 未找到设置面板切换按钮`);
  return null;
}

// ---------------------------------------------------------------------------
// Model dropdown
// ---------------------------------------------------------------------------

/**
 * The model dropdown button whose name contains "arrow_drop_down".
 */
export function findModelDropdown(): HTMLButtonElement | null {
  const buttons = querySelectorAllDeep<HTMLButtonElement>(SELECTORS.buttons);
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    const name = normalizeForMatch(getElementName(b));
    if (name.includes("arrow_drop_down")) return b;
  }

  // Fallback: look for any button with aria-haspopup="listbox" or aria-haspopup="menu"
  // that looks like a model selector
  for (const b of buttons) {
    if (!isVisible(b)) continue;
    const popup = b.getAttribute("aria-haspopup");
    if (popup === "listbox" || popup === "menu" || popup === "true") {
      const name = normalizeForMatch(getElementName(b));
      if (
        name.includes("banana") ||
        name.includes("imagen") ||
        name.includes("veo") ||
        name.includes("model")
      ) {
        logger.debug(
          `findModelDropdown: 通过 aria-haspopup 找到: "${getElementName(b).substring(0, 60)}"`,
        );
        return b;
      }
    }
  }

  logger.warn(`findModelDropdown: 未找到模型下拉按钮`);
  return null;
}

// ---------------------------------------------------------------------------
// Download buttons
// ---------------------------------------------------------------------------

export function getDownloadButtons(): HTMLButtonElement[] {
  const buttons = querySelectorAllDeep<HTMLButtonElement>(
    SELECTORS.downloadButtons,
  );
  return buttons.filter((b) => {
    const name = normalizeForMatch(getElementName(b));
    return KEYWORDS.download.some((k) => name.includes(normalizeForMatch(k)));
  });
}
