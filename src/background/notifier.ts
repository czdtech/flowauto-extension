import type { NotificationSettings } from '../shared/types';
import { logger } from '../shared/logger';

export { DEFAULT_NOTIFICATION_SETTINGS } from '../shared/types';
export type { NotificationSettings, NotificationProvider } from '../shared/types';

export async function sendTelegram(
  token: string,
  chatId: string,
  message: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${text}`);
  }
}

export async function sendDiscord(
  webhookUrl: string,
  message: string,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook error ${res.status}: ${text}`);
  }
}

export async function sendNotification(
  settings: NotificationSettings,
  message: string,
): Promise<void> {
  if (settings.provider === 'none') return;

  if (settings.provider === 'telegram') {
    if (!settings.telegramBotToken || !settings.telegramChatId) return;
    await sendTelegram(settings.telegramBotToken, settings.telegramChatId, message);
  }

  if (settings.provider === 'discord') {
    if (!settings.discordWebhookUrl) return;
    await sendDiscord(settings.discordWebhookUrl, message);
  }
}

/** Best-effort notification: logs warning on failure, never throws. */
export async function trySendNotification(
  settings: NotificationSettings,
  message: string,
): Promise<void> {
  try {
    await sendNotification(settings, message);
  } catch (e) {
    logger.warn('通知发送失败', e);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

export function formatQueueCompleteMessage(
  projectName: string,
  successCount: number,
  errorCount: number,
  elapsedMs: number,
): string {
  const name = projectName || '未命名项目';
  return [
    '\u{1F3AC} FlowAuto 批量任务完成',
    '',
    `项目: ${name}`,
    `\u2705 成功: ${successCount}`,
    `\u274C 失败: ${errorCount}`,
    `\u23F1 耗时: ${formatElapsed(elapsedMs)}`,
  ].join('\n');
}

export function formatTaskErrorMessage(
  prompt: string,
  errorMessage: string,
): string {
  return [
    '\u26A0\uFE0F FlowAuto 任务失败',
    '',
    `任务: ${truncate(prompt, 50)}`,
    `错误: ${truncate(errorMessage, 100)}`,
  ].join('\n');
}
