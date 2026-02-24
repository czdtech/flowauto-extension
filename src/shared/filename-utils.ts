import type { TaskItem } from './types';

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

export function sanitizePathSegment(input: string, fallback = 'untitled'): string {
  const trimmed = (input ?? '').trim();
  const cleaned = trimmed.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;

  // Avoid Windows reserved device names.
  const upper = cleaned.toUpperCase();
  const reserved = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ]);
  if (reserved.has(upper)) return `${cleaned}_`;

  // Conservative length limit (path length is still a factor).
  return cleaned.slice(0, 80);
}

export function shortPrompt(prompt: string, maxLen = 40): string {
  const oneLine = (prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'prompt';
  return oneLine.slice(0, maxLen);
}

export function buildProjectDir(projectName: string): string {
  return `FlowAuto/${sanitizePathSegment(projectName, 'Flow')}`;
}

export function buildTaskBaseName(task: Pick<TaskItem, 'filename' | 'prompt'>, outputIndex: number): string {
  const base = task.filename ? sanitizePathSegment(task.filename) : sanitizePathSegment(shortPrompt(task.prompt));
  const out = String(outputIndex).padStart(2, '0');
  return `${base}__o${out}`;
}

