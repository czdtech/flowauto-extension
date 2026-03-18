/**
 * Inject a File/Blob into Flow's image upload mechanism.
 *
 * Flow's upload flow (verified via browser console):
 *   1. User clicks "+" → resource panel opens
 *   2. User clicks upload icon → Flow's JS finds a hidden <input type="file">
 *      and calls input.click() → native file dialog opens
 *
 * Our approach:
 *   BEFORE clicking the upload button, we find all existing <input type="file">
 *   elements AND watch for new ones via MutationObserver. On each, we override
 *   the instance-level click() so that when Flow calls input.click(), our code
 *   sets files via DataTransfer and dispatches 'change' instead of opening
 *   the native dialog.
 *
 *   This is SAFE: only instance-level overrides, no prototype pollution.
 *
 * Fallback strategies:
 *   B. Clipboard paste on the prompt area
 *   C. Drag-and-drop on the prompt area
 */

import { querySelectorAllDeep } from "../finders";
import { getElementName, normalizeForMatch } from "../utils/aria";
import { forceClick, isVisible, randomSleep, sleep, waitFor } from "../utils/dom";
import { logger, errorMsg } from "../../shared/logger";

// ---------------------------------------------------------------------------
// DOM finders
// ---------------------------------------------------------------------------

function findPromptAddButton(): HTMLButtonElement | null {
  const buttons = querySelectorAllDeep<HTMLButtonElement>("button");
  for (const btn of buttons) {
    if (!isVisible(btn)) continue;
    const name = normalizeForMatch(getElementName(btn));
    if (name.includes("add_2") && name.includes("创建")) return btn;
  }
  for (const btn of buttons) {
    if (!isVisible(btn)) continue;
    const name = normalizeForMatch(getElementName(btn));
    if (name.includes("add_2")) return btn;
  }
  return null;
}

function isResourcePanelOpen(): boolean {
  const btn = findPromptAddButton();
  return btn?.getAttribute("aria-expanded") === "true";
}

function findUploadButtonInPanel(): HTMLButtonElement | null {
  const all = querySelectorAllDeep<HTMLElement>(
    'button, [role="menuitem"], [role="button"]',
  );
  for (const el of all) {
    if (!isVisible(el)) continue;
    const name = normalizeForMatch(getElementName(el));
    if (
      (name.includes("上传") || name.includes("upload")) &&
      !name.includes("添加媒体")
    ) {
      return el as HTMLButtonElement;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resource panel helpers
// ---------------------------------------------------------------------------

async function openResourcePanel(): Promise<void> {
  if (isResourcePanelOpen()) return;
  const btn = findPromptAddButton();
  if (!btn) throw new Error('未找到提示词旁的 "+" 按钮 (add_2)');
  forceClick(btn);
  await waitFor(isResourcePanelOpen, {
    timeoutMs: 5000,
    intervalMs: 300,
    debugName: "open-resource-panel",
  });
  await randomSleep(250, 500);
}

async function closeResourcePanel(): Promise<void> {
  if (!isResourcePanelOpen()) return;
  const btn = findPromptAddButton();
  if (btn) forceClick(btn);
  await randomSleep(300, 600);
  if (isResourcePanelOpen()) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await randomSleep(300, 600);
  }
}

// ---------------------------------------------------------------------------
// Media UUID helpers
// ---------------------------------------------------------------------------

const MEDIA_UUID_RE =
  /media(?:\.getMediaUrlRedirect|\/).*?[?&/]name[=/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function collectMediaUuids(): Set<string> {
  const uuids = new Set<string>();
  const imgs = document.querySelectorAll<HTMLImageElement>("img");
  for (const img of imgs) {
    const src = img.src || img.getAttribute("src") || "";
    const match = src.match(MEDIA_UUID_RE);
    if (match) uuids.add(match[1]);
    const dataSrc = img.getAttribute("data-src") || "";
    const match2 = dataSrc.match(MEDIA_UUID_RE);
    if (match2) uuids.add(match2[1]);
  }
  return uuids;
}



function isSelectedState(el: HTMLElement | null): boolean {
  if (!el) return false;
  const attrValues = [
    el.getAttribute("aria-selected"),
    el.getAttribute("aria-checked"),
    el.getAttribute("aria-pressed"),
    el.getAttribute("data-state"),
  ]
    .map((x) => (x || "").toLowerCase())
    .filter(Boolean);
  if (
    attrValues.some(
      (v) =>
        v === "true" ||
        v === "selected" ||
        v === "checked" ||
        v === "active" ||
        v === "on",
    )
  ) {
    return true;
  }
  const classText = String(el.className || "").toLowerCase();
  if (
    classText.includes("selected") ||
    classText.includes("active") ||
    classText.includes("checked")
  ) {
    return true;
  }
  if (
    el.querySelector(
      '[aria-selected="true"], [aria-checked="true"], [aria-pressed="true"], [data-state="selected"], [data-state="checked"]',
    )
  ) {
    return true;
  }
  return false;
}

function findAddToPromptButton(panelRoot: HTMLElement): HTMLElement | null {
  const controls = querySelectorAllDeep<HTMLElement>(
    'button, [role="button"], [role="menuitem"]',
    panelRoot,
  );
  for (const el of controls) {
    if (!isVisible(el)) continue;
    const name = normalizeForMatch(getElementName(el));
    if (!name) continue;
    const isAttachAction =
      name.includes("添加到提示") ||
      name.includes("添加到提示词") ||
      (name.includes("add") && name.includes("prompt")) ||
      (name.includes("add") && name.includes("reference")) ||
      name.includes("加入提示");
    if (!isAttachAction) continue;
    if (name.includes("上传") || name.includes("upload")) continue;
    return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resource panel search helper
// ---------------------------------------------------------------------------

/**
 * Find and use the search input in the resource panel to filter images by name.
 * Returns true if a search input was found and the search term was typed.
 */
async function searchInResourcePanel(
  panelRoot: HTMLElement,
  searchTerm: string,
): Promise<boolean> {
  const selectors = [
    'input[type="search"]',
    'input[type="text"]',
    '[role="searchbox"]',
    'input[placeholder*="搜索"]',
    'input[placeholder*="search"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="搜索"]',
    'input[aria-label*="search"]',
  ];

  let searchInput: HTMLInputElement | null = null;
  for (const sel of selectors) {
    searchInput = panelRoot.querySelector<HTMLInputElement>(sel);
    if (searchInput && isVisible(searchInput)) break;
    searchInput = null;
  }

  if (!searchInput) {
    const allInputs = panelRoot.querySelectorAll<HTMLInputElement>("input");
    for (const inp of allInputs) {
      if (!isVisible(inp)) continue;
      const t = inp.type.toLowerCase();
      if (t === "file" || t === "hidden" || t === "checkbox" || t === "radio")
        continue;
      searchInput = inp;
      break;
    }
  }

  if (!searchInput) {
    logger.debug("资源面板未找到搜索框，将使用滚动查找");
    return false;
  }

  searchInput.focus();
  await randomSleep(200, 400);

  searchInput.value = "";
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  searchInput.dispatchEvent(new Event("change", { bubbles: true }));
  await randomSleep(200, 400);

  for (const ch of searchTerm) {
    searchInput.value += ch;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(30 + Math.random() * 50);
  }
  searchInput.dispatchEvent(new Event("change", { bubbles: true }));

  // Only a brief initial pause; the caller will use waitForSearchResultsStable
  // to adaptively wait for the full filter result.
  await randomSleep(300, 500);

  logger.debug(`资源面板搜索: "${searchTerm}"，等待过滤结果`);
  return true;
}

/**
 * Wait until the list of visible items inside `panelRoot` stabilises after
 * a search/filter operation.  We watch the total element count (not img src
 * loading) since we match items by text labels, which render immediately.
 */
async function waitForSearchResultsStable(
  panelRoot: HTMLElement,
  opts?: { timeoutMs?: number; intervalMs?: number; stableCount?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const intervalMs = opts?.intervalMs ?? 400;
  const stableCount = opts?.stableCount ?? 3;

  const start = Date.now();
  let lastCount = -1;
  let streak = 0;

  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);

    const currentCount = panelRoot.querySelectorAll<HTMLElement>(
      'li, [role="option"], [role="listitem"]',
    ).length || panelRoot.querySelectorAll("img").length;

    if (currentCount === lastCount) {
      streak++;
      if (streak >= stableCount) {
        logger.debug(
          `搜索结果已稳定: ${currentCount} 项 (${streak} 次不变, ${Date.now() - start}ms)`,
        );
        return;
      }
    } else {
      streak = 0;
      lastCount = currentCount;
    }
  }

  logger.debug(
    `搜索结果等待超时 (${timeoutMs}ms), 当前 ${lastCount} 项`,
  );
}

// ---------------------------------------------------------------------------
// Quick-select: pick an already-uploaded image from the resource panel by UUID
// ---------------------------------------------------------------------------

/**
 * Locate the resource panel DOM container.
 *
 * When the "+" button is expanded (`aria-expanded="true"`), Flow renders a
 * popup/overlay panel for selecting previously uploaded images.  We try to
 * find this panel via `aria-controls` / `aria-owns`, or by searching for
 * common popup roles near the button.  Returns `null` if the panel container
 * cannot be determined.
 */
function findResourcePanelContainer(): HTMLElement | null {
  const btn = findPromptAddButton();
  if (!btn) return null;

  // 1. Try aria-controls / aria-owns → getElementById
  for (const attr of ["aria-controls", "aria-owns"]) {
    const id = btn.getAttribute(attr)?.trim();
    if (id) {
      const el = document.getElementById(id);
      if (el && isVisible(el)) return el;
    }
  }

  // 2. Look for a visible popup/listbox/menu that appeared near the button.
  const btnRect = btn.getBoundingClientRect();
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('[role="listbox"]'),
    ...document.querySelectorAll<HTMLElement>('[role="menu"]'),
    ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ...document.querySelectorAll<HTMLElement>('[data-state="open"]'),
  ].filter((el) => el.isConnected && isVisible(el));

  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const cRect = c.getBoundingClientRect();
    const dx =
      btnRect.left + btnRect.width / 2 - (cRect.left + cRect.width / 2);
    const dy = btnRect.bottom - cRect.top;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  // 3. Sibling / next-sibling overlay heuristic: the panel is often the
  //    next sibling of the button's parent or a sibling of the form.
  if (!best) {
    const form = btn.closest("form");
    if (form) {
      for (const child of form.querySelectorAll<HTMLElement>("div")) {
        if (!isVisible(child)) continue;
        if (child.querySelectorAll("img").length >= 1) {
          const role = child.getAttribute("role");
          if (
            role === "listbox" ||
            role === "menu" ||
            role === "dialog" ||
            child.getAttribute("data-state") === "open" ||
            child.querySelector('[role="listbox"], [role="menu"]')
          ) {
            best = child;
            break;
          }
        }
      }
    }
  }

  return best;
}

/**
 * Try to attach an image by selecting it from Flow's resource panel using
 * **filename text matching**.  Flow's resource panel search performs exact
 * filename matching — when we type a filename into the search box, the
 * first matching item in the left-side list IS the target.  We just need
 * to find and click that item by its text label.
 *
 * This is far more reliable than scanning thumbnail `img.src` for UUIDs,
 * because text labels are available immediately while `src` attributes
 * are lazy-loaded via `media.getMediaUrlRedirect`.
 *
 * IMPORTANT: We restrict the search to within the resource panel
 * container to avoid accidentally matching result gallery images.
 */
async function trySelectFromResourcePanel(
  filename: string,
): Promise<boolean> {
  try {
    const urlBefore = location.href;
    await openResourcePanel();
    await randomSleep(600, 1200);

    // Scope search to the resource panel container.
    const panelRoot = findResourcePanelContainer();
    const searchRoot = panelRoot ?? null;

    if (!searchRoot) {
      logger.warn(`无法定位资源面板容器，跳过面板选择以避免误点击`);
      await closeResourcePanel().catch(() => {});
      return false;
    }

    logger.debug(
      `资源面板容器: tag=${searchRoot.tagName}, role=${searchRoot.getAttribute("role")}, children=${searchRoot.querySelectorAll("img").length} imgs`,
    );

    const searched = await searchInResourcePanel(searchRoot, filename);
    if (!searched) {
      logger.debug("未找到搜索框，跳过资源面板选择");
      await closeResourcePanel().catch(() => {});
      return false;
    }

    // Wait for the search to filter the list. We use a short stable wait
    // on element count (not img src) since we're matching by text, not UUID.
    await waitForSearchResultsStable(searchRoot, {
      timeoutMs: 5000,
      intervalMs: 400,
      stableCount: 3,
    });

    // Find a clickable item whose text label matches the filename.
    const match = findItemByFilenameText(searchRoot, filename);

    if (!match) {
      logger.debug(
        `资源面板搜索 "${filename}" 无精确匹配项，回退到上传`,
      );
      await closeResourcePanel().catch(() => {});
      return false;
    }

    logger.debug(
      `资源面板: 找到 "${filename}"，点击选择 (tag=${match.tagName})`,
    );
    forceClick(match);
    await randomSleep(300, 600);

    // If the panel is still open (some UI variants require an extra click
    // on the image itself inside the selected item), try clicking an img
    // child as backup.
    const isPanelStillOpen =
      document.body.contains(searchRoot) && isVisible(searchRoot);
    if (isPanelStillOpen && !isSelectedState(match)) {
      const imgChild = match.querySelector<HTMLImageElement>("img");
      if (imgChild) {
        forceClick(imgChild);
        await randomSleep(200, 400);
      }
    }

    // Some UI variants require explicit "Add to prompt" confirmation.
    let attachBtn: HTMLElement | null = null;
    if (document.body.contains(searchRoot) && isVisible(searchRoot)) {
      attachBtn = findAddToPromptButton(searchRoot);
      if (attachBtn) {
        logger.debug('资源面板: 检测到"添加到提示"按钮，执行确认');
        forceClick(attachBtn);
        await randomSleep(250, 500);
      }
    }

    // Navigation guard.
    if (location.href !== urlBefore) {
      logger.error(
        `资源面板点击导致页面导航! ${urlBefore} → ${location.href}`,
      );
      await closeResourcePanel().catch(() => {});
      return false;
    }

    const panelClosed =
      !document.body.contains(searchRoot) || !isVisible(searchRoot);

    await closeResourcePanel().catch(() => {});

    logger.info(
      `从资源面板选择成功: ${filename}${attachBtn ? " (confirm)" : panelClosed ? " (auto-closed)" : ""}`,
    );
    return true;
  } catch (e: unknown) {
    logger.warn(`资源面板选择失败: ${errorMsg(e)}`);
    await closeResourcePanel().catch(() => {});
    return false;
  }
}

/**
 * Find a clickable item in the resource panel whose **visible label**
 * exactly equals the target filename (case-insensitive).
 *
 * IMPORTANT: Flow's list items include Material Icon font names in their
 * `textContent` (e.g. the DOM text is `"image1.jpg"` not `"1.jpg"`).
 * We handle this by:
 *   1. Extracting only the "real" text (ignoring icon font elements)
 *   2. Falling back to `endsWith` matching on full textContent
 *
 * Returns the element only when a match is found; `null` otherwise.
 */
function findItemByFilenameText(
  root: HTMLElement,
  filename: string,
): HTMLElement | null {
  const target = filename.trim().toLowerCase();
  if (!target) return null;

  // Collect ALL descendants — list items might be plain divs in Flow.
  // We check a broad set of selectors plus any element with images.
  const candidates = root.querySelectorAll<HTMLElement>(
    'li, [role="option"], [role="listitem"], [role="button"], button, [tabindex], div',
  );

  const debugTexts: string[] = [];

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    if (el === root) continue;

    // Strategy 1: Extract text from direct text nodes only (skips icon fonts)
    const directText = getDirectTextContent(el).trim().toLowerCase();
    // Strategy 2: Full textContent (may include icon names)
    const fullText = (el.textContent || "").trim().toLowerCase();

    if (!fullText) continue;
    // Skip elements that are clearly not filename items (too long, contain
    // unrelated UI text like "搜索资源", "最近使用过", etc.)
    if (fullText.length > 100) continue;

    // Collect debug info (first 10 items only)
    if (debugTexts.length < 10) {
      debugTexts.push(
        `[${el.tagName}] direct="${directText}" full="${fullText}"`,
      );
    }

    // Exact match on direct text (best case)
    if (directText === target) {
      logger.debug(
        `文件名精确匹配 (directText): "${directText}" === "${target}"`,
      );
      return el;
    }

    // Exact match on full text (in case there are no icon issues)
    if (fullText === target) {
      logger.debug(
        `文件名精确匹配 (fullText): "${fullText}" === "${target}"`,
      );
      return el;
    }

    // endsWith match: textContent is "image1.jpg", target is "1.jpg"
    // Only match if the text ENDS with the target and is not too much longer
    // (to avoid false matches with long descriptions).
    if (
      fullText.endsWith(target) &&
      fullText.length <= target.length + 30
    ) {
      logger.debug(
        `文件名尾部匹配: "${fullText}" endsWith "${target}"`,
      );
      return el;
    }
  }

  // Log debug info for troubleshooting
  logger.debug(
    `面板中无满足精确匹配的项 (搜索目标: "${target}")`,
    debugTexts.length > 0
      ? `候选项: ${debugTexts.join(" | ")}`
      : "无候选项",
  );
  return null;
}

/**
 * Extract text content from an element's DIRECT text nodes and non-icon
 * child elements only.  This strips out Material Icon font text (rendered
 * via `<span class="material-symbols-*">icon_name</span>` or `<i>`).
 */
function getDirectTextContent(el: HTMLElement): string {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as HTMLElement;
      const tag = child.tagName;
      const cls = (child.className || "").toLowerCase();
      // Skip icon elements
      if (
        tag === "I" ||
        tag === "SVG" ||
        tag === "MAT-ICON" ||
        cls.includes("material") ||
        cls.includes("icon") ||
        cls.includes("goog-icon") ||
        child.getAttribute("aria-hidden") === "true"
      ) {
        continue;
      }
      // Recurse into non-icon children
      text += getDirectTextContent(child);
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Strategy A: Instance-level file-input interception
// ---------------------------------------------------------------------------

/**
 * Install click() overrides on all existing + future <input type="file">
 * elements. When Flow calls input.click(), our override fires instead:
 * it sets the files and dispatches 'change', bypassing the native dialog.
 *
 * The key insight: the override must set files INSIDE the click() call,
 * not before. This is because Flow's upload handler calls input.click()
 * synchronously, and we need the files to be set at that exact moment.
 */
function armFileInputInterception(
  file: File,
  timeoutMs = 8000,
): { promise: Promise<boolean>; disarm: () => void } {
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolved = false;
  let resolve!: (ok: boolean) => void;
  const armed: HTMLInputElement[] = [];

  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });

  const finish = (ok: boolean) => {
    if (resolved) return;
    resolved = true;
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    // Clean up all overrides on armed inputs that weren't triggered
    for (const inp of armed) {
      try {
        delete (inp as Omit<HTMLInputElement, 'click'> & { click?: () => void }).click;
      } catch {
        /* ok */
      }
    }
    resolve(ok);
  };

  const disarm = () => finish(false);

  const armInput = (input: HTMLInputElement) => {
    if (armed.includes(input)) return;
    armed.push(input);

    input.click = function (this: HTMLInputElement) {
      logger.debug(
        "拦截 file input.click() — 注入文件替代原生对话框",
      );

      const dt = new DataTransfer();
      dt.items.add(file);
      this.files = dt.files;

      // Remove the override first so the change handler sees a clean element
      delete (this as Omit<HTMLInputElement, 'click'> & { click?: () => void }).click;

      this.dispatchEvent(new Event("change", { bubbles: true }));

      // Also fire React's synthetic onChange
      try {
        const rKey = Object.keys(this).find((k) =>
          k.startsWith("__reactProps"),
        );
        if (rKey) {
          const props = (this as HTMLInputElement & Record<string, unknown>)[rKey] as { onChange?: (e: unknown) => void } | undefined;
          if (typeof props?.onChange === "function") {
            props.onChange({ target: this, currentTarget: this });
          }
        }
      } catch {
        /* non-critical */
      }

      finish(true);
    };
  };

  // Arm ALL existing file inputs (don't filter by accept — we don't know
  // which one Flow will use)
  const existing =
    document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const inp of existing) {
    armInput(inp);
  }
  logger.debug(
    `已在 ${existing.length} 个现有 file input 上安装拦截`,
  );

  // Watch for newly created file inputs
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLInputElement && node.type === "file") {
          logger.debug("MutationObserver: 检测到新 file input");
          armInput(node);
          return;
        }
        if (node instanceof Element) {
          const inp =
            node.querySelector<HTMLInputElement>('input[type="file"]');
          if (inp) {
            logger.debug(
              "MutationObserver: 在子树中检测到 file input",
            );
            armInput(inp);
            return;
          }
        }
      }
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  timer = setTimeout(() => {
    logger.warn("等待 file input.click() 调用超时");
    finish(false);
  }, timeoutMs);

  return { promise, disarm };
}

// ---------------------------------------------------------------------------
// Strategy B: Clipboard paste
// ---------------------------------------------------------------------------

async function tryClipboardPaste(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"], textarea',
  );
  if (!promptInput) return false;
  promptInput.focus();
  await randomSleep(200, 400);

  // Collapse selection to end before pasting image — prevents the paste event
  // from overwriting prompt text that might be selected (race condition with
  // React re-render restoring selection state after text injection).
  if (promptInput.isContentEditable) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = document.createRange();
      range.selectNodeContents(promptInput);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  try {
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    promptInput.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }),
    );
    await randomSleep(800, 1500);
    logger.debug("clipboard paste 事件已派发");
    return true;
  } catch (e) {
    logger.warn("clipboard paste 失败:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Strategy C: Drag-and-drop
// ---------------------------------------------------------------------------

async function tryDragDrop(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"], textarea',
  );
  const dropTarget =
    promptInput?.closest("form") ?? promptInput ?? document.body;
  if (!dropTarget) return false;

  const dt = new DataTransfer();
  dt.items.add(file);
  const rect = dropTarget.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const evtOpts: DragEventInit = {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: cx,
    clientY: cy,
  };

  dropTarget.dispatchEvent(new DragEvent("dragenter", evtOpts));
  await sleep(50);
  dropTarget.dispatchEvent(new DragEvent("dragover", evtOpts));
  await sleep(50);
  dropTarget.dispatchEvent(new DragEvent("drop", evtOpts));
  await randomSleep(800, 1500);
  logger.debug("drag-drop 事件已派发");
  return true;
}

// ---------------------------------------------------------------------------
// Upload wait helper
// ---------------------------------------------------------------------------

/**
 * Detect visible progress/loading indicators on the page.
 * Flow shows a 0%→100% progress bar during image upload, similar to generation.
 */
function hasVisibleProgress(): boolean {
  const indicators = document.querySelectorAll(
    '[role="progressbar"], [aria-busy="true"], [class*="progress"], [class*="spinner"], [class*="loading"]',
  );
  for (const el of indicators) {
    if (
      el instanceof HTMLElement &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    ) {
      return true;
    }
  }
  // Look for percentage text (e.g. "48%") in leaf nodes near common containers
  const candidates = document.querySelectorAll("span, div, p");
  for (const el of candidates) {
    if (el.childElementCount > 0) continue;
    const text = (el.textContent || "").trim();
    if (
      /^\d{1,3}\s*%$/.test(text) &&
      el instanceof HTMLElement &&
      el.offsetWidth > 0
    ) {
      return true;
    }
  }
  return false;
}

async function waitForUploadComplete(): Promise<void> {
  // Phase 1: Wait briefly for Flow to recognize the file and START uploading.
  // A progress indicator should appear within a few seconds.
  logger.debug("等待上传开始...");
  let uploadStarted = false;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (hasVisibleProgress()) {
      uploadStarted = true;
      logger.debug("检测到上传进度指示器");
      break;
    }
  }

  if (!uploadStarted) {
    logger.warn("未检测到上传进度指示器，可能已快速完成或未开始");
    await sleep(2000);
    return;
  }

  // Phase 2: Wait for progress indicators to DISAPPEAR (upload complete).
  logger.debug("等待上传完成 (0%→100%)...");
  try {
    await waitFor(() => (hasVisibleProgress() ? null : true), {
      timeoutMs: 60000,
      intervalMs: 1000,
      debugName: "upload-progress-done",
    });
    logger.debug("上传进度已完成");
  } catch {
    logger.warn("等待上传完成超时 (60s)，继续执行");
  }
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// Clear existing attached references (between tasks)
// ---------------------------------------------------------------------------

/**
 * Remove any reference images attached from a previous task.
 * Flow keeps uploaded reference images attached to the prompt area until
 * explicitly removed.  Without this cleanup, the next task would inherit
 * the previous task's references.
 */
export async function clearAttachedReferences(): Promise<void> {
  const submitBtn = document.querySelector<HTMLElement>(
    'button[type="submit"]',
  );
  const form = submitBtn?.closest("form") as HTMLElement | null;
  if (!form) return;

  let cleared = 0;

  // Strategy 1: Click close/remove buttons on reference chips within the form.
  const allBtns = querySelectorAllDeep<HTMLElement>('button, [role="button"]');
  for (const btn of allBtns) {
    if (!isVisible(btn)) continue;
    if (!form.contains(btn)) continue;

    const name = normalizeForMatch(getElementName(btn));

    // Skip known action buttons
    if (btn.getAttribute("type") === "submit") continue;
    if (name.includes("创建") || name.includes("create")) continue;
    if (name.includes("add_2")) continue;
    if (name.includes("arrow_forward")) continue;
    if (name.includes("settings") || name.includes("设置")) continue;
    if (name.includes("更多") || name.includes("more_vert")) continue;

    const isRemoveBtn =
      name.includes("close") ||
      name.includes("cancel") ||
      name.includes("移除") ||
      name.includes("remove") ||
      name.includes("删除") ||
      name.includes("delete") ||
      name.includes("clear") ||
      name.includes("清除");

    if (!isRemoveBtn) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 36 || rect.height > 36) continue;
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text !== "×" && text !== "x" && text !== "close" && text !== "cancel")
        continue;
    }

    logger.debug(
      `清除参考图: 点击 "${getElementName(btn).substring(0, 30)}"`,
    );
    forceClick(btn);
    cleared++;
    await randomSleep(300, 600);
  }

  // Strategy 2: Clear inline images from the contenteditable by selecting all + deleting.
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"]',
  );
  if (promptInput) {
    const imgs = promptInput.querySelectorAll("img");
    if (imgs.length > 0) {
      logger.debug(
        `清除 contenteditable 内 ${imgs.length} 张内联图片`,
      );
      for (const img of imgs) img.remove();
      promptInput.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContent" }),
      );
      cleared += imgs.length;
      await randomSleep(250, 500);
    }
  }

  if (cleared > 0) {
    logger.info(`已清除 ${cleared} 个参考图/内联图片`);
    await randomSleep(400, 800);
  } else {
    logger.debug("未发现需要清除的参考图");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result from an image injection attempt.
 *  - `success`    — whether the image was attached
 *  - `mediaUuid`  — the Flow-assigned UUID for the image (captured after upload),
 *                    used by future tasks to select the image from the resource panel
 *                    instead of re-uploading it.
 */
export interface InjectResult {
  success: boolean;
  mediaUuid?: string;
}

/**
 * After a successful upload, find the new media UUID(s) that appeared in the
 * DOM since the snapshot taken before the upload.  Returns the first new UUID,
 * or `undefined` if we can't detect one.
 */
function captureNewMediaUuid(before: Set<string>): string | undefined {
  const after = collectMediaUuids();
  for (const uuid of after) {
    if (!before.has(uuid)) return uuid;
  }
  return undefined;
}

export async function injectImageToFlow(
  imageBlob: Blob,
  filename: string,
  options?: { mediaUuid?: string },
): Promise<InjectResult> {
  logger.info(
    `注入图片: ${filename} (${imageBlob.size} bytes, ${imageBlob.type})`,
  );

  if (imageBlob.size < 100) {
    throw new Error(
      `图片数据异常：仅 ${imageBlob.size} 字节 (${filename})，可能 IndexedDB 存储/传输损坏`,
    );
  }

  // ── Quick path: select from resource panel by filename ──────────────
  // If the image was previously uploaded (we have a persisted or session
  // UUID), try to find and click it by filename in the resource panel.
  // This is much faster than re-uploading.
  if (options?.mediaUuid) {
    try {
      if (await trySelectFromResourcePanel(filename)) {
        return { success: true, mediaUuid: options.mediaUuid };
      }
    } catch (e: unknown) {
      logger.warn(`资源面板选择异常: ${errorMsg(e)}`);
    }
  }

  // ── Primary: Clipboard paste ───────────────────────────────────────
  const uuidsBefore = collectMediaUuids();
  try {
    logger.debug("剪贴板粘贴上传...");
    if (await tryClipboardPaste(imageBlob, filename)) {
      await waitForUploadComplete();
      const newUuid = captureNewMediaUuid(uuidsBefore);
      if (newUuid) {
        logger.info(`上传成功: ${filename} (UUID=${newUuid})`);
      } else {
        logger.info(`上传成功: ${filename} (未捕获UUID)`);
      }
      return { success: true, mediaUuid: newUuid };
    }
  } catch (e: unknown) {
    logger.warn(`剪贴板粘贴失败: ${errorMsg(e)}`);
  }

  // ── Fallback: Resource panel + file-input interception ─────────────
  const file = new File([imageBlob], filename, {
    type: imageBlob.type || "image/png",
  });
  const uuidsBefore2 = collectMediaUuids();
  try {
    logger.debug("回退: 资源面板上传");
    await openResourcePanel();

    const uploadBtn = await waitFor(findUploadButtonInPanel, {
      timeoutMs: 5000,
      intervalMs: 300,
      debugName: "find-upload-btn-in-panel",
    });

    const { promise: intercepted, disarm } = armFileInputInterception(file);

    logger.debug("点击上传按钮...");
    forceClick(uploadBtn);

    const ok = await intercepted;
    if (ok) {
      logger.debug("文件已通过 click() 拦截注入");
      await waitForUploadComplete();
      await closeResourcePanel();
      const newUuid = captureNewMediaUuid(uuidsBefore2);
      logger.info(
        `上传成功: ${filename}${newUuid ? ` (UUID=${newUuid})` : ""}`,
      );
      await randomSleep(800, 1500);
      return { success: true, mediaUuid: newUuid };
    }
    disarm();
    logger.warn("回退: input.click() 未被触发");
    await closeResourcePanel().catch(() => {});
  } catch (e: unknown) {
    logger.warn(`回退失败: ${errorMsg(e)}`);
    await closeResourcePanel().catch(() => {});
  }

  // ── Last resort: Drag and drop ─────────────────────────────────────
  const uuidsBefore3 = collectMediaUuids();
  try {
    logger.debug("最后手段: 拖放");
    if (await tryDragDrop(imageBlob, filename)) {
      await waitForUploadComplete();
      const newUuid = captureNewMediaUuid(uuidsBefore3);
      logger.info(
        `上传成功: ${filename}${newUuid ? ` (UUID=${newUuid})` : ""}`,
      );
      return { success: true, mediaUuid: newUuid };
    }
  } catch (e: unknown) {
    logger.warn(`拖放失败: ${errorMsg(e)}`);
  }

  throw new Error(`所有图片注入策略均失败 (${filename})`);
}
