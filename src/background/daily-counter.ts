import type { Tier } from '../shared/feature-gate';
import { getDailyLimit } from '../shared/feature-gate';

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `dailyCount:${yyyy}-${mm}-${dd}`;
}

export async function getDailyCount(): Promise<number> {
  const key = todayKey();
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as number) ?? 0);
    });
  });
}

export async function incrementDailyCount(): Promise<number> {
  const count = (await getDailyCount()) + 1;
  const key = todayKey();
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [key]: count }, () => resolve());
  });
  return count;
}

export async function checkDailyLimit(
  tier: Tier,
): Promise<{ allowed: boolean; message?: string }> {
  const limit = getDailyLimit(tier);
  if (limit === Infinity) return { allowed: true };

  const count = await getDailyCount();
  if (count >= limit) {
    return {
      allowed: false,
      message: '已达每日免费额度上限，请升级至 Pro',
    };
  }
  return { allowed: true };
}
