<script lang="ts">
  import { MSG } from '../../shared/constants';
  import type {
    LicenseActivateRequest,
    LicenseActivateResponse,
    LicenseClearRequest,
    LicenseClearResponse,
  } from '../../shared/protocol';
  import type { Tier } from '../../shared/feature-gate';

  interface Props {
    tier: Tier;
    dailyCount: number;
    dailyLimit: number;
    onTierChanged: () => void;
  }

  let { tier, dailyCount, dailyLimit, onTierChanged }: Props = $props();

  let keyInput = $state('');
  let activating = $state(false);
  let error = $state('');
  let success = $state('');

  function tierLabel(t: Tier): string {
    if (t === 'pro_plus') return 'Pro+';
    if (t === 'pro') return 'Pro';
    return 'Free';
  }

  function tierClass(t: Tier): string {
    if (t === 'pro_plus') return 'badge-pro-plus';
    if (t === 'pro') return 'badge-pro';
    return 'badge-free';
  }

  function dailyDisplay(): string {
    if (dailyLimit === Infinity) return `${dailyCount} / ∞`;
    return `${dailyCount} / ${dailyLimit}`;
  }

  function sendMessage<TReq, TRes>(message: TReq): Promise<TRes> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: TRes) => {
        const err = chrome.runtime.lastError;
        if (err) { reject(err); return; }
        resolve(response);
      });
    });
  }

  async function activate(): Promise<void> {
    const key = keyInput.trim();
    if (!key || activating) return;
    activating = true;
    error = '';
    success = '';
    try {
      const res = await sendMessage<LicenseActivateRequest, LicenseActivateResponse>({
        type: MSG.LICENSE_ACTIVATE,
        key,
      });
      if (res.ok && res.tier) {
        success = `激活成功！当前等级：${tierLabel(res.tier)}`;
        keyInput = '';
        onTierChanged();
      } else {
        error = res.error ?? '激活失败';
      }
    } catch {
      error = '激活请求失败';
    } finally {
      activating = false;
    }
  }

  async function clearLicense(): Promise<void> {
    error = '';
    success = '';
    try {
      await sendMessage<LicenseClearRequest, LicenseClearResponse>({
        type: MSG.LICENSE_CLEAR,
      });
      success = '许可证已清除';
      onTierChanged();
    } catch {
      error = '清除失败';
    }
  }
</script>

<details class="license-panel">
  <summary>
    许可证
    <span class="tier-badge {tierClass(tier)}">{tierLabel(tier)}</span>
  </summary>

  <div class="license-body">
    <div class="usage-row">
      <span class="usage-label">今日用量</span>
      <span class="usage-value">{dailyDisplay()}</span>
    </div>

    {#if tier === 'free'}
      <div class="activate-section">
        <input
          class="inp"
          type="text"
          placeholder="输入许可证密钥"
          bind:value={keyInput}
          onkeydown={(e) => { if (e.key === 'Enter') activate(); }}
        />
        <button class="btn primary" onclick={activate} disabled={activating || !keyInput.trim()}>
          {activating ? '激活中...' : '激活'}
        </button>
      </div>
    {:else}
      <button class="btn btn-clear" onclick={clearLicense}>
        清除许可证
      </button>
    {/if}

    {#if error}
      <div class="msg-error">{error}</div>
    {/if}
    {#if success}
      <div class="msg-success">{success}</div>
    {/if}
  </div>
</details>

<style>
  .license-panel summary {
    cursor: pointer;
    opacity: 0.9;
    font-size: 12px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tier-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 8px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .badge-free {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.7);
  }
  .badge-pro {
    background: rgba(126, 231, 135, 0.12);
    border: 1px solid rgba(126, 231, 135, 0.35);
    color: rgba(126, 231, 135, 0.9);
  }
  .badge-pro-plus {
    background: rgba(168, 130, 255, 0.12);
    border: 1px solid rgba(168, 130, 255, 0.35);
    color: rgba(168, 130, 255, 0.9);
  }
  .license-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 10px;
  }
  .usage-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  .usage-label { opacity: 0.7; }
  .usage-value { font-variant-numeric: tabular-nums; }
  .activate-section {
    display: flex;
    gap: 6px;
  }
  .inp {
    flex: 1;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 10px;
    padding: 6px 8px;
    outline: none;
    font-size: 12px;
  }
  .inp:focus {
    border-color: rgba(126, 231, 135, 0.45);
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary {
    background: rgba(126, 231, 135, 0.16);
    border-color: rgba(126, 231, 135, 0.35);
  }
  .btn-clear {
    font-size: 11px;
    opacity: 0.6;
    padding: 4px 8px;
  }
  .btn-clear:hover { opacity: 0.9; }
  .msg-error { color: #ff7b72; font-size: 11px; }
  .msg-success { color: rgba(126, 231, 135, 0.9); font-size: 11px; }
</style>
