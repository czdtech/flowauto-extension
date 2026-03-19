import type { Tier } from '../shared/feature-gate';

export interface LicenseData {
  tier: Tier;
  key: string;
  activatedAt: number;
  lastValidated: number;
  expiresAt?: number;
}

const STORAGE_KEY = 'flowauto.license.v1';
const REVALIDATION_DAYS_PRO = 7;
const REVALIDATION_DAYS_PRO_PLUS = 30;

export async function activateLicense(key: string): Promise<LicenseData> {
  const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: key,
      instance_name: 'flowauto-extension',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`License activation failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.activated && !data.valid) {
    throw new Error(data.error ?? 'Invalid license key');
  }

  const tier: Tier = extractTierFromResponse(data);

  const license: LicenseData = {
    tier,
    key,
    activatedAt: Date.now(),
    lastValidated: Date.now(),
    expiresAt: data.license_key?.expires_at
      ? new Date(data.license_key.expires_at).getTime()
      : undefined,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: license });
  return license;
}

export async function getLicense(): Promise<LicenseData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as LicenseData) ?? null;
}

export async function getCurrentTier(): Promise<Tier> {
  const license = await getLicense();
  if (!license) return 'free';

  const daysSinceValidation =
    (Date.now() - license.lastValidated) / (1000 * 60 * 60 * 24);
  const revalidationDays =
    license.tier === 'pro_plus'
      ? REVALIDATION_DAYS_PRO_PLUS
      : REVALIDATION_DAYS_PRO;

  if (daysSinceValidation > revalidationDays) {
    try {
      await revalidateLicense(license);
    } catch {
      await clearLicense();
      return 'free';
    }
  }

  return license.tier;
}

export async function clearLicense(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export function extractTierFromResponse(data: any): Tier {
  const meta = data.meta?.custom_data;
  if (meta?.tier === 'pro_plus') return 'pro_plus';
  if (meta?.tier === 'pro') return 'pro';

  const variant = data.license_key?.variant_name ?? '';
  if (
    variant.toLowerCase().includes('pro+') ||
    variant.toLowerCase().includes('plus')
  )
    return 'pro_plus';
  if (variant.toLowerCase().includes('pro')) return 'pro';

  return 'pro';
}

async function revalidateLicense(license: LicenseData): Promise<void> {
  const res = await fetch(
    'https://api.lemonsqueezy.com/v1/licenses/validate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: license.key }),
    },
  );

  if (!res.ok) throw new Error('Revalidation failed');

  const data = await res.json();
  if (!data.valid) throw new Error('License no longer valid');

  license.lastValidated = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: license });
}
