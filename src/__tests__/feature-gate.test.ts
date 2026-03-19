import { describe, it, expect } from 'vitest';
import {
  isFeatureEnabled,
  getDailyLimit,
  getProjectLimit,
  getAiProxyQuota,
  type Tier,
  type Feature,
} from '../shared/feature-gate';

const ALL_FEATURES: Feature[] = [
  'download_4k',
  'all_modes',
  'chain_mode',
  'mxn_combos',
  'file_import',
  'ai_own_key',
  'ai_proxy',
  'stealth_mode',
  'notifications',
  'priority_support',
];

const PRO_PLUS_ONLY: Feature[] = [
  'ai_proxy',
  'stealth_mode',
  'notifications',
  'priority_support',
];

const PRO_AND_ABOVE: Feature[] = [
  'download_4k',
  'all_modes',
  'chain_mode',
  'mxn_combos',
  'file_import',
  'ai_own_key',
];

describe('isFeatureEnabled', () => {
  it('free tier has no features enabled', () => {
    for (const feature of ALL_FEATURES) {
      expect(isFeatureEnabled(feature, 'free')).toBe(false);
    }
  });

  it('pro tier enables pro-level features', () => {
    for (const feature of PRO_AND_ABOVE) {
      expect(isFeatureEnabled(feature, 'pro')).toBe(true);
    }
  });

  it('pro tier does NOT enable pro_plus-only features', () => {
    for (const feature of PRO_PLUS_ONLY) {
      expect(isFeatureEnabled(feature, 'pro')).toBe(false);
    }
  });

  it('pro_plus tier enables ALL features', () => {
    for (const feature of ALL_FEATURES) {
      expect(isFeatureEnabled(feature, 'pro_plus')).toBe(true);
    }
  });

  it('returns false for unknown feature', () => {
    expect(isFeatureEnabled('nonexistent' as Feature, 'pro_plus')).toBe(false);
  });
});

describe('getDailyLimit', () => {
  it('free tier has 30 daily limit', () => {
    expect(getDailyLimit('free')).toBe(30);
  });

  it('pro tier has unlimited daily limit', () => {
    expect(getDailyLimit('pro')).toBe(Infinity);
  });

  it('pro_plus tier has unlimited daily limit', () => {
    expect(getDailyLimit('pro_plus')).toBe(Infinity);
  });
});

describe('getProjectLimit', () => {
  it('free tier limited to 1 project', () => {
    expect(getProjectLimit('free')).toBe(1);
  });

  it('pro tier limited to 3 projects', () => {
    expect(getProjectLimit('pro')).toBe(3);
  });

  it('pro_plus tier has unlimited projects', () => {
    expect(getProjectLimit('pro_plus')).toBe(Infinity);
  });
});

describe('getAiProxyQuota', () => {
  it('free tier has 0 proxy quota', () => {
    expect(getAiProxyQuota('free')).toBe(0);
  });

  it('pro tier has 0 proxy quota', () => {
    expect(getAiProxyQuota('pro')).toBe(0);
  });

  it('pro_plus tier has 500 proxy quota', () => {
    expect(getAiProxyQuota('pro_plus')).toBe(500);
  });
});
