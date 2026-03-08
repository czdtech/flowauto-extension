import { findAllByRole } from './utils/dom';

export function isLabsHost(): boolean {
  return location.hostname === 'labs.google';
}

export function isFlowProjectUrl(url: string = location.href): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'labs.google' && u.pathname.includes('/tools/flow/project/');
  } catch {
    return false;
  }
}

export function getProjectName(): string | null {
  // Method 1: editable project-name textbox (new UI)
  try {
    const textboxes = findAllByRole('textbox');
    for (const tb of textboxes) {
      const label = (tb.getAttribute('aria-label') || '').trim();
      if (label.includes('可编辑文本') || label.includes('editable text')) {
        const val = (tb as HTMLInputElement).value || tb.textContent || '';
        if (val.trim()) return val.trim();
      }
    }
  } catch { /* ignore */ }

  // Method 2: breadcrumb listitem (legacy fallback)
  try {
    const listitems = findAllByRole('listitem');
    if (listitems.length >= 2) {
      const second = listitems[1];
      const btn = second.querySelector('button');
      const text = btn?.textContent?.trim();
      if (text) {
        return text.replace(/\s*edit.*$/i, '').trim();
      }
    }
  } catch { /* ignore */ }

  // Method 3: document.title (e.g. "Flow - Mar 06 - 17:34")
  const title = document.title || '';
  const m = title.match(/^Flow\s*-\s*(.+)$/i);
  if (m && m[1]) return m[1].trim();
  return null;
}
