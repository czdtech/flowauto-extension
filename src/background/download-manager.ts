import { sanitizePathSegment } from '../shared/filename-utils';

export interface ExpectedDownload {
  createdAt: number;
  dir: string;
  baseName: string;
  taskId: string;
  outputIndex: number;
}

const EXPECT_WINDOW_MS = 20_000;
const pending: ExpectedDownload[] = [];

function now(): number {
  return Date.now();
}

function normalizeDir(dir: string): string {
  const parts = (dir || '')
    .split(/[\\/]+/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => sanitizePathSegment(p));
  return parts.join('/');
}

function extractExt(filename: string): string {
  const base = (filename || '').trim();
  const idx = base.lastIndexOf('.');
  if (idx === -1) return '';
  const ext = base.slice(idx);
  // Basic sanity: extension like ".mp4" ".png" etc.
  if (!/^\.[a-z0-9]{1,8}$/i.test(ext)) return '';
  return ext.toLowerCase();
}

function pruneExpired(): void {
  const cutoff = now() - EXPECT_WINDOW_MS;
  while (pending.length && pending[0]!.createdAt < cutoff) pending.shift();
}

export function expectDownload(exp: Omit<ExpectedDownload, 'createdAt'>): void {
  pruneExpired();
  pending.push({ ...exp, createdAt: now() });
}

let initialized = false;
export function initDownloadManager(): void {
  if (initialized) return;
  initialized = true;

  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    pruneExpired();
    const exp = pending.shift();
    if (!exp) return;

    const dir = normalizeDir(exp.dir);
    const baseName = sanitizePathSegment(exp.baseName, 'download');
    const ext = extractExt(downloadItem.filename) || '';
    const filename = `${dir}/${baseName}${ext}`;

    suggest({ filename, conflictAction: 'uniquify' });
  });
}

