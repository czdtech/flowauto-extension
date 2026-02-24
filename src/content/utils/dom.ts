import { getElementName, matchesName, type NameMatcher } from './aria';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  // Some UI components (e.g. Radix) rely on Pointer Events, not just Mouse Events.
  // Dispatch a realistic sequence once (avoid double-click bugs).
  try {
    el.focus();
  } catch {
    // ignore
  }
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const common = { bubbles: true, cancelable: true, composed: true, clientX, clientY };

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

export function typeReactTextarea(textarea: HTMLTextAreaElement, value: string): void {
  textarea.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
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

