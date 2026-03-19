import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../__tests__/chrome-mock';
import { getBackingStore } from '../__tests__/chrome-mock';

// We must reset modules between tests to reset the module-level state
let activateLicense: typeof import('../background/license').activateLicense;
let getLicense: typeof import('../background/license').getLicense;
let getCurrentTier: typeof import('../background/license').getCurrentTier;
let clearLicense: typeof import('../background/license').clearLicense;
let extractTierFromResponse: typeof import('../background/license').extractTierFromResponse;

const STORAGE_KEY = 'flowauto.license.v1';

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  const mod = await import('../background/license');
  activateLicense = mod.activateLicense;
  getLicense = mod.getLicense;
  getCurrentTier = mod.getCurrentTier;
  clearLicense = mod.clearLicense;
  extractTierFromResponse = mod.extractTierFromResponse;
});

describe('extractTierFromResponse', () => {
  it('returns pro_plus from meta.custom_data', () => {
    const data = { meta: { custom_data: { tier: 'pro_plus' } } };
    expect(extractTierFromResponse(data)).toBe('pro_plus');
  });

  it('returns pro from meta.custom_data', () => {
    const data = { meta: { custom_data: { tier: 'pro' } } };
    expect(extractTierFromResponse(data)).toBe('pro');
  });

  it('detects pro_plus from variant_name containing "Pro+"', () => {
    const data = { license_key: { variant_name: 'FlowAuto Pro+ Monthly' } };
    expect(extractTierFromResponse(data)).toBe('pro_plus');
  });

  it('detects pro_plus from variant_name containing "plus"', () => {
    const data = { license_key: { variant_name: 'FlowAuto Plus Plan' } };
    expect(extractTierFromResponse(data)).toBe('pro_plus');
  });

  it('detects pro from variant_name containing "pro"', () => {
    const data = { license_key: { variant_name: 'FlowAuto Pro Lifetime' } };
    expect(extractTierFromResponse(data)).toBe('pro');
  });

  it('defaults to free when no tier info found', () => {
    const data = {};
    expect(extractTierFromResponse(data)).toBe('free');
  });

  it('meta.custom_data takes precedence over variant_name', () => {
    const data = {
      meta: { custom_data: { tier: 'pro' } },
      license_key: { variant_name: 'Pro+ Plan' },
    };
    expect(extractTierFromResponse(data)).toBe('pro');
  });
});

describe('activateLicense', () => {
  it('activates a valid license and stores it', async () => {
    const mockResponse = {
      activated: true,
      valid: true,
      meta: { custom_data: { tier: 'pro' } },
      license_key: { expires_at: null },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const license = await activateLicense('TEST-KEY-123');
    expect(license.tier).toBe('pro');
    expect(license.key).toBe('TEST-KEY-123');
    expect(license.activatedAt).toBeGreaterThan(0);
    expect(license.lastValidated).toBeGreaterThan(0);
    expect(license.expiresAt).toBeUndefined();

    // Verify stored in chrome.storage
    const stored = getBackingStore()[STORAGE_KEY] as any;
    expect(stored.tier).toBe('pro');
  });

  it('stores expiresAt for subscription licenses', async () => {
    const expiresDate = '2025-12-31T00:00:00.000Z';
    const mockResponse = {
      activated: true,
      valid: true,
      meta: { custom_data: { tier: 'pro_plus' } },
      license_key: { expires_at: expiresDate },
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const license = await activateLicense('SUB-KEY-456');
    expect(license.tier).toBe('pro_plus');
    expect(license.expiresAt).toBe(new Date(expiresDate).getTime());
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    });

    await expect(activateLicense('BAD-KEY')).rejects.toThrow('License activation failed: 400');
  });

  it('throws on invalid license key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ activated: false, valid: false, error: 'Invalid key' }),
    });

    await expect(activateLicense('INVALID')).rejects.toThrow('Invalid key');
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    await expect(activateLicense('ANY-KEY')).rejects.toThrow('Network error');
  });
});

describe('getLicense', () => {
  it('returns null when no license stored', async () => {
    const result = await getLicense();
    expect(result).toBeNull();
  });

  it('returns stored license', async () => {
    const license = {
      tier: 'pro',
      key: 'STORED-KEY',
      activatedAt: Date.now(),
      lastValidated: Date.now(),
    };
    getBackingStore()[STORAGE_KEY] = license;

    const result = await getLicense();
    expect(result).toEqual(license);
  });
});

describe('getCurrentTier', () => {
  it('returns free when no license', async () => {
    const tier = await getCurrentTier();
    expect(tier).toBe('free');
  });

  it('returns correct tier for valid license within revalidation window', async () => {
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro',
      key: 'MY-KEY',
      activatedAt: Date.now(),
      lastValidated: Date.now(), // just validated
    };

    const tier = await getCurrentTier();
    expect(tier).toBe('pro');
  });

  it('returns correct tier for pro_plus within revalidation window', async () => {
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro_plus',
      key: 'MY-KEY',
      activatedAt: Date.now(),
      lastValidated: Date.now(),
    };

    const tier = await getCurrentTier();
    expect(tier).toBe('pro_plus');
  });

  it('revalidates pro license after 7 days', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro',
      key: 'MY-KEY',
      activatedAt: eightDaysAgo,
      lastValidated: eightDaysAgo,
    };

    // Mock successful revalidation with tier info
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: true, meta: { custom_data: { tier: 'pro' } } }),
    });

    const tier = await getCurrentTier();
    expect(tier).toBe('pro');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Verify lastValidated was updated
    const stored = getBackingStore()[STORAGE_KEY] as any;
    expect(stored.lastValidated).toBeGreaterThan(eightDaysAgo);
  });

  it('downgrades to free if revalidation fails (network)', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro',
      key: 'MY-KEY',
      activatedAt: eightDaysAgo,
      lastValidated: eightDaysAgo,
    };

    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const tier = await getCurrentTier();
    expect(tier).toBe('free');

    // License should be cleared
    expect(getBackingStore()[STORAGE_KEY]).toBeUndefined();
  });

  it('downgrades to free if revalidation returns invalid', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro',
      key: 'MY-KEY',
      activatedAt: eightDaysAgo,
      lastValidated: eightDaysAgo,
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: false }),
    });

    const tier = await getCurrentTier();
    expect(tier).toBe('free');
    expect(getBackingStore()[STORAGE_KEY]).toBeUndefined();
  });

  it('revalidates pro_plus after 30 days (not after 7)', async () => {
    const twentyDaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro_plus',
      key: 'MY-KEY',
      activatedAt: twentyDaysAgo,
      lastValidated: twentyDaysAgo,
    };

    // Should NOT revalidate (20 days < 30 days for pro_plus)
    globalThis.fetch = vi.fn();

    const tier = await getCurrentTier();
    expect(tier).toBe('pro_plus');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('revalidates pro_plus after 30+ days', async () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro_plus',
      key: 'MY-KEY',
      activatedAt: thirtyOneDaysAgo,
      lastValidated: thirtyOneDaysAgo,
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: true, meta: { custom_data: { tier: 'pro_plus' } } }),
    });

    const tier = await getCurrentTier();
    expect(tier).toBe('pro_plus');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('clearLicense', () => {
  it('removes license from storage', async () => {
    getBackingStore()[STORAGE_KEY] = {
      tier: 'pro',
      key: 'TO-CLEAR',
      activatedAt: Date.now(),
      lastValidated: Date.now(),
    };

    await clearLicense();
    expect(getBackingStore()[STORAGE_KEY]).toBeUndefined();
  });
});
