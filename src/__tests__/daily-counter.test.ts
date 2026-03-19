import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../__tests__/chrome-mock';
import { getBackingStore } from '../__tests__/chrome-mock';

let getDailyCount: typeof import('../background/daily-counter').getDailyCount;
let incrementDailyCount: typeof import('../background/daily-counter').incrementDailyCount;
let checkDailyLimit: typeof import('../background/daily-counter').checkDailyLimit;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  const mod = await import('../background/daily-counter');
  getDailyCount = mod.getDailyCount;
  incrementDailyCount = mod.incrementDailyCount;
  checkDailyLimit = mod.checkDailyLimit;
});

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `dailyCount:${yyyy}-${mm}-${dd}`;
}

describe('getDailyCount', () => {
  it('returns 0 when no count stored', async () => {
    expect(await getDailyCount()).toBe(0);
  });

  it('returns stored count', async () => {
    getBackingStore()[todayKey()] = 15;
    expect(await getDailyCount()).toBe(15);
  });
});

describe('incrementDailyCount', () => {
  it('increments from 0 to 1', async () => {
    const count = await incrementDailyCount();
    expect(count).toBe(1);
    expect(getBackingStore()[todayKey()]).toBe(1);
  });

  it('increments existing count', async () => {
    getBackingStore()[todayKey()] = 10;
    const count = await incrementDailyCount();
    expect(count).toBe(11);
    expect(getBackingStore()[todayKey()]).toBe(11);
  });
});

describe('checkDailyLimit', () => {
  it('returns ok for free tier under limit', async () => {
    getBackingStore()[todayKey()] = 5;
    const result = await checkDailyLimit('free');
    expect(result.allowed).toBe(true);
  });

  it('returns blocked for free tier at limit', async () => {
    getBackingStore()[todayKey()] = 30;
    const result = await checkDailyLimit('free');
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('已达每日免费额度上限');
  });

  it('returns blocked for free tier over limit', async () => {
    getBackingStore()[todayKey()] = 50;
    const result = await checkDailyLimit('free');
    expect(result.allowed).toBe(false);
  });

  it('returns ok for pro tier regardless of count', async () => {
    getBackingStore()[todayKey()] = 999;
    const result = await checkDailyLimit('pro');
    expect(result.allowed).toBe(true);
  });

  it('returns ok for pro_plus tier regardless of count', async () => {
    getBackingStore()[todayKey()] = 999;
    const result = await checkDailyLimit('pro_plus');
    expect(result.allowed).toBe(true);
  });
});
