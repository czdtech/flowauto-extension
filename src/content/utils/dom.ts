import { getElementName, matchesName, type NameMatcher } from './aria';
import { logger } from '../../shared/logger';
import { STEALTH } from '../../shared/config';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomSleep(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.round(minMs + Math.random() * (maxMs - minMs));
  return sleep(ms);
}

export function calcStealthDelay(minMs: number, maxMs: number, stealth: boolean): [number, number] {
  if (!stealth) return [minMs, maxMs];
  const stealthMin = minMs * STEALTH.MULTIPLIER_MIN;
  const stealthMax = Math.min(
    maxMs * STEALTH.MULTIPLIER_MAX,
    maxMs * STEALTH.MAX_SLOWDOWN_FACTOR,
  );
  return [stealthMin, stealthMax];
}

export function stealthRandomSleep(minMs: number, maxMs: number, stealth: boolean): Promise<void> {
  const [adjMin, adjMax] = calcStealthDelay(minMs, maxMs, stealth);
  return randomSleep(adjMin, adjMax);
}

export function isVisible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function scrollIntoView(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'center', inline: 'center' });
}

export function forceClick(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  try {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch { /* ignore */ }
  try {
    el.focus();
  } catch {
    // ignore
  }
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const common = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

  // Touch events first (some mobile-first / Material frameworks rely on these)
  try {
    const touch = new Touch({
      identifier: 1,
      target: el,
      clientX,
      clientY,
      pageX: clientX + window.scrollX,
      pageY: clientY + window.scrollY,
    });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, composed: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, composed: true, touches: [], targetTouches: [], changedTouches: [touch] }));
  } catch {
    // Touch API not available or failed — skip
  }

  const dispatchPointerLike = (type: string, buttons: number): void => {
    // Prefer real PointerEvent when available; otherwise fall back to dispatching a MouseEvent
    // with pointer event type (still triggers listeners by event type).
    try {
      el.dispatchEvent(
        new PointerEvent(type, {
          ...common,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons,
        })
      );
    } catch {
      el.dispatchEvent(new MouseEvent(type, { ...common, button: 0, buttons }));
    }
  };

  dispatchPointerLike('pointerdown', 1);
  dispatchPointerLike('pointerup', 0);

  el.dispatchEvent(new MouseEvent('mousedown', { ...common, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...common, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', { ...common, button: 0 }));
}

// ---------------------------------------------------------------------------
// Text Injection – Multi-strategy pipeline
// ---------------------------------------------------------------------------

/** React native setter for <textarea>/<input>. */
function tryReactNativeSetter(el: HTMLElement, value: string): boolean {
  const tag = el.tagName.toLowerCase();
  const proto =
    tag === 'textarea' ? HTMLTextAreaElement.prototype :
    tag === 'input' ? HTMLInputElement.prototype : null;
  if (!proto) return false;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!descriptor?.set) return false;

  descriptor.set.call(el, value);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: false, inputType: 'insertText', data: value,
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // React internal: _valueTracker is injected by React on controlled inputs
  const tracker = (el as HTMLInputElement & { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue('');
  }
  return true;
}

// ---------------------------------------------------------------------------
// ContentEditable strategies (ordered by reliability for Google Flow)
// ---------------------------------------------------------------------------

function selectAllContent(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function collapseSelectionToEnd(el: HTMLElement): void {
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // false means collapse to end
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Primary strategy: InputEvent with insertFromPaste.
 * Google Flow's Next.js editor handles beforeinput with 'insertFromPaste'
 * and updates its internal state correctly.
 */
async function tryInsertFromPaste(el: HTMLElement, value: string): Promise<boolean> {
  if (!el.isContentEditable) return false;
  selectAllContent(el);
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt,
    }));
    await sleep(100);
    // Follow-up input event to finalize editor state
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertFromPaste',
    }));
    collapseSelectionToEnd(el);
    return true;
  } catch {
    return false;
  }
}

/** Fallback: ClipboardEvent paste simulation. */
async function tryClipboardPaste(el: HTMLElement, value: string): Promise<boolean> {
  if (!el.isContentEditable) return false;
  selectAllContent(el);
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    }));
    await sleep(100);
    // Follow-up input event for editors that handle paste separately
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertFromPaste',
    }));
    collapseSelectionToEnd(el);
    return true;
  } catch {
    return false;
  }
}

/** Last resort: execCommand insertText (trusted events, but editor may ignore). */
function tryExecCommand(el: HTMLElement, value: string): boolean {
  if (!el.isContentEditable) return false;
  selectAllContent(el);
  const ok = document.execCommand('insertText', false, value);
  // Dispatch compositionend for IME-aware editors
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
  collapseSelectionToEnd(el);
  return ok && !!el.textContent?.includes(value.substring(0, 10));
}

/** Per-character keyboard simulation for <textarea>/<input>. */
function tryPerCharacterSimulation(el: HTMLElement, value: string): boolean {
  if (!('value' in el)) return false;
  el.focus();
  (el as HTMLInputElement).value = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const keyOpts: KeyboardEventInit = {
      key: char, code: '', bubbles: true, cancelable: true, composed: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    (el as HTMLInputElement).value += char;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertText', data: char,
    }));
    el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function verifyInjection(el: HTMLElement, value: string): boolean {
  const actual =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? String(el.value)
      : el.isContentEditable ? (el.textContent || '') : '';
  const snippet = value.substring(0, 20);
  if (!actual.includes(snippet)) return false;

  if (el.isContentEditable) {
    const placeholder = el.getAttribute('aria-label') || '';
    if (placeholder && actual.includes(placeholder)) return false;
  }
  return true;
}

/**
 * Main entry point: try strategies in order until one succeeds.
 */
export async function typeInputElement(el: HTMLElement, value: string): Promise<void> {
  el.focus();

  // <textarea> / <input>: React native setter → per-char fallback
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    if (tryReactNativeSetter(el, value) && verifyInjection(el, value)) return;
    if (tryPerCharacterSimulation(el, value)) return;
    return;
  }

  // contentEditable: insertFromPaste → clipboard paste → execCommand
  if (el.isContentEditable) {
    await tryInsertFromPaste(el, value);
    if (verifyInjection(el, value)) return;

    await tryClipboardPaste(el, value);
    if (verifyInjection(el, value)) return;

    tryExecCommand(el, value);
    if (verifyInjection(el, value)) return;

    logger.error(`所有 contentEditable 策略均失败`);
    return;
  }

  // Unknown element type
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** @deprecated Use typeInputElement. */
export async function typeReactTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await typeInputElement(textarea, value);
}

export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  options?: { timeoutMs?: number; intervalMs?: number; debugName?: string }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const intervalMs = options?.intervalMs ?? 200;
  const start = Date.now();

  let lastError: unknown;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const value = fn();
      if (value) return value as T;
    } catch (e) {
      lastError = e;
    }

    if (Date.now() - start > timeoutMs) {
      const name = options?.debugName ? ` (${options.debugName})` : '';
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`waitFor timeout${name}${lastError ? ` - Last error: ${errMsg}` : ''}`);
    }
    await sleep(intervalMs);
  }
}

export function findAllByRole(role: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[role="${role}"]`));
}

export function findByRole(role: string, name: NameMatcher, root: ParentNode = document): HTMLElement {
  const candidates = findAllByRole(role, root).filter(isVisible);
  for (const el of candidates) {
    const elName = getElementName(el);
    if (matchesName(elName, name)) return el;
  }
  throw new Error(`Element not found: role=${role}, name=${String(name)}`);
}

