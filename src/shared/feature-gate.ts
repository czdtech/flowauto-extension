export type Tier = 'free' | 'pro' | 'pro_plus';

export type Feature =
  | 'download_4k'
  | 'all_modes'
  | 'chain_mode'
  | 'mxn_combos'
  | 'file_import'
  | 'ai_own_key'
  | 'ai_proxy'
  | 'stealth_mode'
  | 'notifications'
  | 'priority_support';

const FEATURE_MATRIX: Record<Feature, Set<Tier>> = {
  download_4k: new Set(['pro', 'pro_plus']),
  all_modes: new Set(['pro', 'pro_plus']),
  chain_mode: new Set(['pro', 'pro_plus']),
  mxn_combos: new Set(['pro', 'pro_plus']),
  file_import: new Set(['pro', 'pro_plus']),
  ai_own_key: new Set(['pro', 'pro_plus']),
  ai_proxy: new Set(['pro_plus']),
  stealth_mode: new Set(['pro_plus']),
  notifications: new Set(['pro_plus']),
  priority_support: new Set(['pro_plus']),
};

export function isFeatureEnabled(feature: Feature, tier: Tier): boolean {
  return FEATURE_MATRIX[feature]?.has(tier) ?? false;
}

export function getDailyLimit(tier: Tier): number {
  if (tier === 'free') return 30;
  return Infinity;
}

export function getProjectLimit(tier: Tier): number {
  if (tier === 'free') return 1;
  if (tier === 'pro') return 3;
  return Infinity;
}

export function getAiProxyQuota(tier: Tier): number {
  if (tier === 'pro_plus') return 500;
  return 0;
}
