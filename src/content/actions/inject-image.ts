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

import { querySelectorAllDeep } from '../finders';
import { getElementName, normalizeForMatch } from '../utils/aria';
import { forceClick, isVisible, sleep, waitFor } from '../utils/dom';

// ---------------------------------------------------------------------------
// DOM finders
// ---------------------------------------------------------------------------

function findPromptAddButton(): HTMLButtonElement | null {
  const buttons = querySelectorAllDeep<HTMLButtonElement>('button');
  for (const btn of buttons) {
    if (!isVisible(btn)) continue;
    const name = normalizeForMatch(getElementName(btn));
    if (name.includes('add_2') && name.includes('创建')) return btn;
  }
  for (const btn of buttons) {
    if (!isVisible(btn)) continue;
    const name = normalizeForMatch(getElementName(btn));
    if (name.includes('add_2')) return btn;
  }
  return null;
}

function isResourcePanelOpen(): boolean {
  const btn = findPromptAddButton();
  return btn?.getAttribute('aria-expanded') === 'true';
}

function findUploadButtonInPanel(): HTMLButtonElement | null {
  const all = querySelectorAllDeep<HTMLElement>('button, [role="menuitem"], [role="button"]');
  for (const el of all) {
    if (!isVisible(el)) continue;
    const name = normalizeForMatch(getElementName(el));
    if (
      (name.includes('上传') || name.includes('upload')) &&
      !name.includes('添加媒体')
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
    debugName: 'open-resource-panel',
  });
  await sleep(300);
}

async function closeResourcePanel(): Promise<void> {
  if (!isResourcePanelOpen()) return;
  const btn = findPromptAddButton();
  if (btn) forceClick(btn);
  await sleep(400);
  if (isResourcePanelOpen()) {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await sleep(400);
  }
}

// ---------------------------------------------------------------------------
// Media UUID helpers
// ---------------------------------------------------------------------------

const MEDIA_UUID_RE = /media(?:\.getMediaUrlRedirect|\/).*?[?&/]name[=/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function collectMediaUuids(): Set<string> {
  const uuids = new Set<string>();
  const imgs = document.querySelectorAll<HTMLImageElement>('img');
  for (const img of imgs) {
    const src = img.src || img.getAttribute('src') || '';
    const match = src.match(MEDIA_UUID_RE);
    if (match) uuids.add(match[1]);
    const dataSrc = img.getAttribute('data-src') || '';
    const match2 = dataSrc.match(MEDIA_UUID_RE);
    if (match2) uuids.add(match2[1]);
  }
  return uuids;
}

// ---------------------------------------------------------------------------
// Quick-select: pick an already-uploaded image from the resource panel by UUID
// ---------------------------------------------------------------------------

/**
 * Try to attach an image by selecting it from Flow's resource panel using
 * the media UUID captured during a previous upload.  Each image in Flow has
 * a unique UUID (e.g. "0d3594ba-5a07-4c93-a9d6-9c692bf7ba2d") which appears
 * in thumbnail src URLs as `media.getMediaUrlRedirect?name=UUID`.
 *
 * We open the panel, find an `<img>` whose src contains the UUID, and click
 * its parent container to select it.
 */
async function trySelectFromResourcePanel(mediaUuid: string, filename: string): Promise<boolean> {
  try {
    await openResourcePanel();
    await sleep(800);

    const imgs = document.querySelectorAll<HTMLImageElement>('img');
    let match: HTMLImageElement | null = null;

    for (const img of imgs) {
      if (!isVisible(img)) continue;
      const src = (img.src || '') + (img.getAttribute('data-src') || '');
      if (src.includes(mediaUuid)) {
        match = img;
        break;
      }
    }

    if (!match) {
      console.log(`[FlowAuto] 资源面板未找到 UUID=${mediaUuid} (${filename})，回退到上传`);
      await closeResourcePanel().catch(() => {});
      return false;
    }

    // Walk up to find the clickable container wrapping the thumbnail.
    let clickTarget: HTMLElement = match;
    for (let p: HTMLElement | null = match.parentElement; p; p = p.parentElement) {
      const tag = p.tagName;
      if (tag === 'BODY' || tag === 'HTML') break;
      const role = p.getAttribute('role');
      if (tag === 'LI' || tag === 'A' || tag === 'BUTTON' ||
          role === 'option' || role === 'button' || role === 'listitem' ||
          p.getAttribute('tabindex') !== null) {
        clickTarget = p;
        break;
      }
    }

    console.log(`[FlowAuto] 资源面板: 找到 "${filename}" (UUID=${mediaUuid.substring(0, 8)}…)，点击选择`);
    forceClick(clickTarget);
    await sleep(800);

    await closeResourcePanel().catch(() => {});
    console.log(`[FlowAuto] ✅ 从资源面板选择成功: ${filename}`);
    return true;
  } catch (e: any) {
    console.warn(`[FlowAuto] 资源面板选择失败: ${e?.message ?? e}`);
    await closeResourcePanel().catch(() => {});
    return false;
  }
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
      try { delete (inp as any).click; } catch { /* ok */ }
    }
    resolve(ok);
  };

  const disarm = () => finish(false);

  const armInput = (input: HTMLInputElement) => {
    if (armed.includes(input)) return;
    armed.push(input);

    input.click = function (this: HTMLInputElement) {
      console.log('[FlowAuto] 拦截 file input.click() — 注入文件替代原生对话框');

      const dt = new DataTransfer();
      dt.items.add(file);
      this.files = dt.files;

      // Remove the override first so the change handler sees a clean element
      delete (this as any).click;

      this.dispatchEvent(new Event('change', { bubbles: true }));

      // Also fire React's synthetic onChange
      try {
        const rKey = Object.keys(this).find((k) => k.startsWith('__reactProps'));
        if (rKey) {
          const props = (this as any)[rKey];
          if (typeof props?.onChange === 'function') {
            props.onChange({ target: this, currentTarget: this });
          }
        }
      } catch { /* non-critical */ }

      finish(true);
    };
  };

  // Arm ALL existing file inputs (don't filter by accept — we don't know
  // which one Flow will use)
  const existing = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const inp of existing) {
    armInput(inp);
  }
  console.log(`[FlowAuto] 已在 ${existing.length} 个现有 file input 上安装拦截`);

  // Watch for newly created file inputs
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLInputElement && node.type === 'file') {
          console.log('[FlowAuto] MutationObserver: 检测到新 file input');
          armInput(node);
          return;
        }
        if (node instanceof Element) {
          const inp = node.querySelector<HTMLInputElement>('input[type="file"]');
          if (inp) {
            console.log('[FlowAuto] MutationObserver: 在子树中检测到 file input');
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
    console.warn('[FlowAuto] 等待 file input.click() 调用超时');
    finish(false);
  }, timeoutMs);

  return { promise, disarm };
}

// ---------------------------------------------------------------------------
// Strategy B: Clipboard paste
// ---------------------------------------------------------------------------

async function tryClipboardPaste(blob: Blob, filename: string): Promise<boolean> {
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"], textarea',
  );
  if (!promptInput) return false;
  promptInput.focus();
  await sleep(200);

  try {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    promptInput.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }),
    );
    await sleep(1000);
    console.log('[FlowAuto] clipboard paste 事件已派发');
    return true;
  } catch (e) {
    console.warn('[FlowAuto] clipboard paste 失败:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Strategy C: Drag-and-drop
// ---------------------------------------------------------------------------

async function tryDragDrop(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"], textarea',
  );
  const dropTarget = promptInput?.closest('form') ?? promptInput ?? document.body;
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

  dropTarget.dispatchEvent(new DragEvent('dragenter', evtOpts));
  await sleep(50);
  dropTarget.dispatchEvent(new DragEvent('dragover', evtOpts));
  await sleep(50);
  dropTarget.dispatchEvent(new DragEvent('drop', evtOpts));
  await sleep(1000);
  console.log('[FlowAuto] drag-drop 事件已派发');
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
    if (el instanceof HTMLElement && el.offsetWidth > 0 && el.offsetHeight > 0) {
      return true;
    }
  }
  // Look for percentage text (e.g. "48%") in leaf nodes near common containers
  const candidates = document.querySelectorAll('span, div, p');
  for (const el of candidates) {
    if (el.childElementCount > 0) continue;
    const text = (el.textContent || '').trim();
    if (/^\d{1,3}\s*%$/.test(text) && el instanceof HTMLElement && el.offsetWidth > 0) {
      return true;
    }
  }
  return false;
}

async function waitForUploadComplete(): Promise<void> {
  // Phase 1: Wait briefly for Flow to recognize the file and START uploading.
  // A progress indicator should appear within a few seconds.
  console.log('[FlowAuto] 等待上传开始...');
  let uploadStarted = false;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (hasVisibleProgress()) {
      uploadStarted = true;
      console.log('[FlowAuto] 检测到上传进度指示器');
      break;
    }
  }

  if (!uploadStarted) {
    console.warn('[FlowAuto] 未检测到上传进度指示器，可能已快速完成或未开始');
    await sleep(2000);
    return;
  }

  // Phase 2: Wait for progress indicators to DISAPPEAR (upload complete).
  console.log('[FlowAuto] 等待上传完成 (0%→100%)...');
  try {
    await waitFor(
      () => hasVisibleProgress() ? null : true,
      { timeoutMs: 60000, intervalMs: 1000, debugName: 'upload-progress-done' },
    );
    console.log('[FlowAuto] 上传进度已完成');
  } catch {
    console.warn('[FlowAuto] 等待上传完成超时 (60s)，继续执行');
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
  const submitBtn = document.querySelector<HTMLElement>('button[type="submit"]');
  const form = submitBtn?.closest('form') as HTMLElement | null;
  if (!form) return;

  let cleared = 0;

  // Strategy 1: Click close/remove buttons on reference chips within the form.
  const allBtns = querySelectorAllDeep<HTMLElement>('button, [role="button"]');
  for (const btn of allBtns) {
    if (!isVisible(btn)) continue;
    if (!form.contains(btn)) continue;

    const name = normalizeForMatch(getElementName(btn));

    // Skip known action buttons
    if (btn.getAttribute('type') === 'submit') continue;
    if (name.includes('创建') || name.includes('create')) continue;
    if (name.includes('add_2')) continue;
    if (name.includes('arrow_forward')) continue;
    if (name.includes('settings') || name.includes('设置')) continue;
    if (name.includes('更多') || name.includes('more_vert')) continue;

    const isRemoveBtn =
      name.includes('close') || name.includes('cancel') ||
      name.includes('移除') || name.includes('remove') ||
      name.includes('删除') || name.includes('delete') ||
      name.includes('clear') || name.includes('清除');

    if (!isRemoveBtn) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 36 || rect.height > 36) continue;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text !== '×' && text !== 'x' && text !== 'close' && text !== 'cancel') continue;
    }

    console.log(`[FlowAuto] 清除参考图: 点击 "${getElementName(btn).substring(0, 30)}"`);
    forceClick(btn);
    cleared++;
    await sleep(400);
  }

  // Strategy 2: Clear inline images from the contenteditable by selecting all + deleting.
  const promptInput = document.querySelector<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"]',
  );
  if (promptInput) {
    const imgs = promptInput.querySelectorAll('img');
    if (imgs.length > 0) {
      console.log(`[FlowAuto] 清除 contenteditable 内 ${imgs.length} 张内联图片`);
      for (const img of imgs) img.remove();
      promptInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
      cleared += imgs.length;
      await sleep(300);
    }
  }

  if (cleared > 0) {
    console.log(`[FlowAuto] ✅ 已清除 ${cleared} 个参考图/内联图片`);
    await sleep(500);
  } else {
    console.log('[FlowAuto] 未发现需要清除的参考图');
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
  console.log(
    `[FlowAuto] 注入图片: ${filename} (${imageBlob.size} bytes, ${imageBlob.type})`,
  );

  if (imageBlob.size < 100) {
    throw new Error(
      `图片数据异常：仅 ${imageBlob.size} 字节 (${filename})，可能 IndexedDB 存储/传输损坏`,
    );
  }

  // ── Quick path: select from resource panel by UUID ─────────────────
  if (options?.mediaUuid) {
    try {
      if (await trySelectFromResourcePanel(options.mediaUuid, filename)) {
        return { success: true, mediaUuid: options.mediaUuid };
      }
    } catch (e: any) {
      console.warn(`[FlowAuto] 资源面板选择异常: ${e?.message ?? e}`);
    }
  }

  // ── Primary: Clipboard paste ───────────────────────────────────────
  const uuidsBefore = collectMediaUuids();
  try {
    console.log('[FlowAuto] 剪贴板粘贴上传...');
    if (await tryClipboardPaste(imageBlob, filename)) {
      await waitForUploadComplete();
      const newUuid = captureNewMediaUuid(uuidsBefore);
      if (newUuid) {
        console.log(`[FlowAuto] ✅ 上传成功: ${filename} (UUID=${newUuid})`);
      } else {
        console.log(`[FlowAuto] ✅ 上传成功: ${filename} (未捕获UUID)`);
      }
      return { success: true, mediaUuid: newUuid };
    }
  } catch (e: any) {
    console.warn(`[FlowAuto] 剪贴板粘贴失败: ${e?.message ?? e}`);
  }

  // ── Fallback: Resource panel + file-input interception ─────────────
  const file = new File([imageBlob], filename, {
    type: imageBlob.type || 'image/png',
  });
  const uuidsBefore2 = collectMediaUuids();
  try {
    console.log('[FlowAuto] 回退: 资源面板上传');
    await openResourcePanel();

    const uploadBtn = await waitFor(findUploadButtonInPanel, {
      timeoutMs: 5000,
      intervalMs: 300,
      debugName: 'find-upload-btn-in-panel',
    });

    const { promise: intercepted, disarm } = armFileInputInterception(file);

    console.log('[FlowAuto] 点击上传按钮...');
    forceClick(uploadBtn);

    const ok = await intercepted;
    if (ok) {
      console.log('[FlowAuto] 文件已通过 click() 拦截注入');
      await waitForUploadComplete();
      await closeResourcePanel();
      const newUuid = captureNewMediaUuid(uuidsBefore2);
      console.log(`[FlowAuto] ✅ 上传成功: ${filename}${newUuid ? ` (UUID=${newUuid})` : ''}`);
      await sleep(1000);
      return { success: true, mediaUuid: newUuid };
    }
    disarm();
    console.warn('[FlowAuto] 回退: input.click() 未被触发');
    await closeResourcePanel().catch(() => {});
  } catch (e: any) {
    console.warn(`[FlowAuto] 回退失败: ${e?.message ?? e}`);
    await closeResourcePanel().catch(() => {});
  }

  // ── Last resort: Drag and drop ─────────────────────────────────────
  const uuidsBefore3 = collectMediaUuids();
  try {
    console.log('[FlowAuto] 最后手段: 拖放');
    if (await tryDragDrop(imageBlob, filename)) {
      await waitForUploadComplete();
      const newUuid = captureNewMediaUuid(uuidsBefore3);
      console.log(`[FlowAuto] ✅ 上传成功: ${filename}${newUuid ? ` (UUID=${newUuid})` : ''}`);
      return { success: true, mediaUuid: newUuid };
    }
  } catch (e: any) {
    console.warn(`[FlowAuto] 拖放失败: ${e?.message ?? e}`);
  }

  throw new Error(`所有图片注入策略均失败 (${filename})`);
}
