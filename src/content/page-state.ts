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
  // Prefer breadcrumb "project name" button if present.
  try {
    const listitems = findAllByRole('listitem');
    // Expected: [Flow] [ProjectName edit] [Scenebuilder]
    if (listitems.length >= 2) {
      const second = listitems[1];
      const btn = second.querySelector('button');
      const text = btn?.textContent?.trim();
      if (text) {
        // Often contains "edit 修改项目" tail — strip after "edit".
        return text.replace(/\s*edit.*$/i, '').trim();
      }
    }
  } catch {
    // ignore
  }

  // Fallback: document.title like "Flow - Feb 22 - 01:46"
  const title = document.title || '';
  const m = title.match(/^Flow\s*-\s*(.+)$/i);
  if (m && m[1]) return m[1].trim();
  return null;
}

