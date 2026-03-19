<script lang="ts">
  import type { UserSettings } from '../../shared/types';
  import type { AiProviderType } from '../../shared/ai-provider';
  import type { NotificationProvider, NotificationSettings } from '../../shared/types';
  import { DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types';
  import { MSG } from '../../shared/constants';
  import type { TestNotificationRequest, TestNotificationResponse } from '../../shared/protocol';
  import { isFeatureEnabled, type Tier } from '../../shared/feature-gate';

  interface Props {
    settings: UserSettings | null;
    tier: Tier;
    s_defaultModel: UserSettings['defaultModel'];
    s_defaultGenerationType: UserSettings['defaultGenerationType'];
    s_defaultAspectRatio: UserSettings['defaultAspectRatio'];
    s_defaultOutputCount: number;
    s_defaultDownloadResolution: UserSettings['defaultDownloadResolution'];
    s_interTaskDelayMs: number;
    s_stealthMode: boolean;
    s_chainMode: boolean;
    s_aiProvider: AiProviderType;
    s_aiApiKey: string;
    s_aiModel: string;
    patchSettings: (patch: Partial<UserSettings>) => void;
  }

  let {
    settings,
    tier,
    s_defaultModel = $bindable(),
    s_defaultGenerationType = $bindable(),
    s_defaultAspectRatio = $bindable(),
    s_defaultOutputCount = $bindable(),
    s_defaultDownloadResolution = $bindable(),
    s_interTaskDelayMs = $bindable(),
    s_stealthMode = $bindable(),
    s_chainMode = $bindable(),
    s_aiProvider = $bindable(),
    s_aiApiKey = $bindable(),
    s_aiModel = $bindable(),
    patchSettings
  }: Props = $props();

  function patchAi(patch: Partial<{ provider: AiProviderType; apiKey: string; model: string }>): void {
    const current = settings?.aiSettings ?? { provider: s_aiProvider, apiKey: s_aiApiKey, model: s_aiModel };
    patchSettings({
      aiSettings: { ...current, ...patch },
    });
  }

  // Notification settings local state
  let nProvider: NotificationProvider = $state('none');
  let nTelegramBotToken = $state('');
  let nTelegramChatId = $state('');
  let nDiscordWebhookUrl = $state('');
  let nNotifyOnComplete = $state(true);
  let nNotifyOnError = $state(true);
  let testStatus: '' | 'sending' | 'ok' | 'error' = $state('');
  let testError = $state('');

  $effect(() => {
    if (!settings) return;
    const ns = settings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
    nProvider = ns.provider;
    nTelegramBotToken = ns.telegramBotToken ?? '';
    nTelegramChatId = ns.telegramChatId ?? '';
    nDiscordWebhookUrl = ns.discordWebhookUrl ?? '';
    nNotifyOnComplete = ns.notifyOnComplete;
    nNotifyOnError = ns.notifyOnError;
  });

  function buildNotificationSettings(): NotificationSettings {
    return {
      provider: nProvider,
      telegramBotToken: nTelegramBotToken || undefined,
      telegramChatId: nTelegramChatId || undefined,
      discordWebhookUrl: nDiscordWebhookUrl || undefined,
      notifyOnComplete: nNotifyOnComplete,
      notifyOnError: nNotifyOnError,
    };
  }

  function saveNotificationSettings(): void {
    patchSettings({ notificationSettings: buildNotificationSettings() });
  }

  async function testNotification(): Promise<void> {
    testStatus = 'sending';
    testError = '';
    try {
      const res = await new Promise<TestNotificationResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: MSG.TEST_NOTIFICATION, settings: buildNotificationSettings() } satisfies TestNotificationRequest,
          (response: TestNotificationResponse) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          },
        );
      });
      if (res.ok) {
        testStatus = 'ok';
      } else {
        testStatus = 'error';
        testError = res.error ?? '未知错误';
      }
    } catch (e) {
      testStatus = 'error';
      testError = e instanceof Error ? e.message : String(e);
    }
  }
</script>

{#if settings}
  <details class="settings" open>
    <summary>默认设置</summary>
    <div class="grid">
      <label>
        <div class="lab">生成方式</div>
        <select
          class="sel"
          bind:value={s_defaultGenerationType}
          onchange={(e) => patchSettings({ defaultGenerationType: (e.target as HTMLSelectElement).value as UserSettings['defaultGenerationType'] })}
        >
          <option value="text-to-image">文生图</option>
          <option value="image-to-image">图生图</option>
          <option value="text-to-video">文生视频</option>
          <option value="image-to-video">图生视频</option>
        </select>
      </label>

      <label>
        <div class="lab">画幅</div>
        <select
          class="sel"
          bind:value={s_defaultAspectRatio}
          onchange={(e) => patchSettings({ defaultAspectRatio: (e.target as HTMLSelectElement).value as UserSettings['defaultAspectRatio'] })}
        >
          <option value="9:16">9:16</option>
          <option value="16:9">16:9</option>
        </select>
      </label>

      <label>
        <div class="lab">outputs</div>
        <select
          class="sel"
          bind:value={s_defaultOutputCount}
          onchange={(e) => patchSettings({ defaultOutputCount: Number((e.target as HTMLSelectElement).value) })}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>

      <label>
        <div class="lab">模型</div>
        <select
          class="sel"
          bind:value={s_defaultModel}
          onchange={(e) => patchSettings({ defaultModel: (e.target as HTMLSelectElement).value as UserSettings['defaultModel'] })}
        >
          <optgroup label="图像生成">
            <option value="nano-banana-pro">Nano Banana Pro</option>
            <option value="nano-banana-2">Nano Banana 2</option>
            <option value="imagen4">Imagen 4</option>
          </optgroup>
          <optgroup label="视频与动画">
            <option value="veo3.1-quality">Veo 3.1 - Quality</option>
            <option value="veo3.1-fast">Veo 3.1 - Fast</option>
          </optgroup>
        </select>
      </label>

      <label>
        <div class="lab">下载画质</div>
        <select
          class="sel"
          bind:value={s_defaultDownloadResolution}
          onchange={(e) => patchSettings({ defaultDownloadResolution: (e.target as HTMLSelectElement).value as UserSettings['defaultDownloadResolution'] })}
        >
          <option value="1K/720p">1K / 720p</option>
          <option value="2K/1080p">2K / 1080p</option>
          <option value="4K">4K (需升级)</option>
        </select>
      </label>

      <label>
        <div class="lab">间隔(ms)</div>
        <input
          class="inp"
          type="number"
          min="0"
          step="500"
          bind:value={s_interTaskDelayMs}
          onchange={(e) => patchSettings({ interTaskDelayMs: Number((e.target as HTMLInputElement).value) })}
        />
      </label>

      <label class="toggle-row">
        <div class="lab">
          隐身模式
          {#if !isFeatureEnabled('stealth_mode', tier)}<span class="lock" title="Pro+ 专属">🔒</span>{/if}
        </div>
        <input
          type="checkbox"
          bind:checked={s_stealthMode}
          onchange={() => patchSettings({ stealthMode: s_stealthMode })}
          disabled={!isFeatureEnabled('stealth_mode', tier)}
        />
      </label>

      <label class="toggle-row">
        <div class="lab">
          链式模式
          {#if !isFeatureEnabled('chain_mode', tier)}<span class="lock" title="Pro 专属">🔒</span>{/if}
        </div>
        <input
          type="checkbox"
          bind:checked={s_chainMode}
          onchange={() => patchSettings({ chainMode: s_chainMode })}
          disabled={!isFeatureEnabled('chain_mode', tier)}
        />
      </label>
    </div>
  </details>

  {#if isFeatureEnabled('ai_own_key', tier)}
  <details class="settings">
    <summary>AI 设置</summary>
    <div class="grid">
      <label>
        <div class="lab">AI 服务商</div>
        <select
          class="sel"
          bind:value={s_aiProvider}
          onchange={(e) => patchAi({ provider: (e.target as HTMLSelectElement).value as AiProviderType })}
        >
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
          {#if isFeatureEnabled('ai_proxy', tier)}
            <option value="proxy">代理 (Pro+)</option>
          {/if}
        </select>
      </label>

      {#if s_aiProvider !== 'proxy'}
      <label>
        <div class="lab">模型</div>
        <select
          class="sel"
          bind:value={s_aiModel}
          onchange={(e) => patchAi({ model: (e.target as HTMLSelectElement).value })}
        >
          {#if s_aiProvider === 'openai'}
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
          {:else}
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            <option value="gemini-2.5-pro-preview-05-06">gemini-2.5-pro</option>
          {/if}
        </select>
      </label>

      <label class="full-width">
        <div class="lab">API Key</div>
        <input
          class="inp"
          type="password"
          placeholder="输入 API Key"
          bind:value={s_aiApiKey}
          onchange={(e) => patchAi({ apiKey: (e.target as HTMLInputElement).value })}
        />
      </label>
      {:else}
      <p class="proxy-hint full-width">使用 FlowAuto 代理，无需 API Key</p>
      {/if}
    </div>
  </details>
  {/if}

  {#if isFeatureEnabled('notifications', tier)}
  <details class="settings">
    <summary>通知设置</summary>
    <div class="grid">
      <label>
        <div class="lab">通知方式</div>
        <select
          class="sel"
          bind:value={nProvider}
          onchange={() => saveNotificationSettings()}
        >
          <option value="none">无</option>
          <option value="telegram">Telegram</option>
          <option value="discord">Discord</option>
        </select>
      </label>

      {#if nProvider === 'telegram'}
        <label class="full-width">
          <div class="lab">Bot Token</div>
          <input class="inp" type="password" placeholder="输入 Bot Token"
            bind:value={nTelegramBotToken}
            onchange={() => saveNotificationSettings()} />
        </label>
        <label class="full-width">
          <div class="lab">Chat ID</div>
          <input class="inp" type="text" placeholder="输入 Chat ID"
            bind:value={nTelegramChatId}
            onchange={() => saveNotificationSettings()} />
        </label>
      {/if}

      {#if nProvider === 'discord'}
        <label class="full-width">
          <div class="lab">Webhook URL</div>
          <input class="inp" type="password" placeholder="输入 Discord Webhook URL"
            bind:value={nDiscordWebhookUrl}
            onchange={() => saveNotificationSettings()} />
        </label>
      {/if}

      {#if nProvider !== 'none'}
        <label class="toggle-row">
          <div class="lab">队列完成时通知</div>
          <input type="checkbox" bind:checked={nNotifyOnComplete}
            onchange={() => saveNotificationSettings()} />
        </label>
        <label class="toggle-row">
          <div class="lab">任务失败时通知</div>
          <input type="checkbox" bind:checked={nNotifyOnError}
            onchange={() => saveNotificationSettings()} />
        </label>
        <button class="test-btn" onclick={testNotification} disabled={testStatus === 'sending'}>
          {testStatus === 'sending' ? '发送中...' : '测试通知'}
        </button>
        {#if testStatus === 'ok'}
          <span class="test-ok">发送成功</span>
        {/if}
        {#if testStatus === 'error'}
          <span class="test-err">{testError}</span>
        {/if}
      {/if}
    </div>
  </details>
  {/if}
{/if}

<style>
  .settings summary {
    cursor: pointer;
    opacity: 0.9;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 10px;
    margin-bottom: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .toggle-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .toggle-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: rgba(126, 231, 135, 0.8);
    cursor: pointer;
  }
  .lab {
    opacity: 0.7;
    font-size: 12px;
  }
  .sel,
  .inp {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 10px;
    padding: 6px 8px;
    outline: none;
    font-size: 12px;
  }
  .sel option,
  .sel optgroup {
    background: #1e1e1e;
    color: #fff;
  }
  .sel:focus,
  .inp:focus {
    border-color: rgba(126, 231, 135, 0.45);
  }
  .full-width {
    grid-column: 1 / -1;
  }
  .test-btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .test-btn:disabled { opacity: 0.5; cursor: default; }
  .test-ok { color: rgba(126, 231, 135, 0.9); font-size: 11px; }
  .test-err { color: rgba(255, 100, 100, 0.9); font-size: 11px; }
  .lock { font-size: 10px; margin-left: 4px; opacity: 0.6; }
  .proxy-hint { font-size: 11px; opacity: 0.6; margin: 0; }
</style>