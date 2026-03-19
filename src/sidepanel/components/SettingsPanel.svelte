<script lang="ts">
  import type { UserSettings } from '../../shared/types';
  import type { NotificationProvider, NotificationSettings } from '../../shared/types';
  import { DEFAULT_NOTIFICATION_SETTINGS } from '../../shared/types';
  import { MSG } from '../../shared/constants';
  import type { TestNotificationRequest, TestNotificationResponse } from '../../shared/protocol';

  interface Props {
    settings: UserSettings | null;
    s_defaultModel: UserSettings['defaultModel'];
    s_defaultGenerationType: UserSettings['defaultGenerationType'];
    s_defaultAspectRatio: UserSettings['defaultAspectRatio'];
    s_defaultOutputCount: number;
    s_defaultDownloadResolution: UserSettings['defaultDownloadResolution'];
    s_interTaskDelayMs: number;
    patchSettings: (patch: Partial<UserSettings>) => void;
  }

  let {
    settings,
    s_defaultModel = $bindable(),
    s_defaultGenerationType = $bindable(),
    s_defaultAspectRatio = $bindable(),
    s_defaultOutputCount = $bindable(),
    s_defaultDownloadResolution = $bindable(),
    s_interTaskDelayMs = $bindable(),
    patchSettings
  }: Props = $props();

  // Notification settings local state
  let nProvider: NotificationProvider = $state('none');
  let nTelegramBotToken = $state('');
  let nTelegramChatId = $state('');
  let nDiscordWebhookUrl = $state('');
  let nNotifyOnComplete = $state(true);
  let nNotifyOnError = $state(true);
  let testStatus: '' | 'sending' | 'ok' | 'error' = $state('');
  let testError = $state('');

  // Sync notification settings from parent settings
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
    </div>
  </details>

  <details class="settings">
    <summary>通知设置</summary>
    <div class="grid">
      <label>
        <div class="lab">通知渠道</div>
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
    </div>

    {#if nProvider === 'telegram'}
      <div class="grid">
        <label>
          <div class="lab">Bot Token</div>
          <input
            class="inp"
            type="password"
            placeholder="123456:ABC-DEF..."
            bind:value={nTelegramBotToken}
            onchange={() => saveNotificationSettings()}
          />
        </label>
        <label>
          <div class="lab">Chat ID</div>
          <input
            class="inp"
            type="text"
            placeholder="-100123456789"
            bind:value={nTelegramChatId}
            onchange={() => saveNotificationSettings()}
          />
        </label>
      </div>
    {/if}

    {#if nProvider === 'discord'}
      <div class="grid single">
        <label>
          <div class="lab">Webhook URL</div>
          <input
            class="inp"
            type="password"
            placeholder="https://discord.com/api/webhooks/..."
            bind:value={nDiscordWebhookUrl}
            onchange={() => saveNotificationSettings()}
          />
        </label>
      </div>
    {/if}

    <div class="triggers">
      <label class="ck">
        <input
          type="checkbox"
          bind:checked={nNotifyOnComplete}
          onchange={() => saveNotificationSettings()}
        />
        队列完成时通知
      </label>
      <label class="ck">
        <input
          type="checkbox"
          bind:checked={nNotifyOnError}
          onchange={() => saveNotificationSettings()}
        />
        任务失败时通知
      </label>
    </div>

    {#if nProvider !== 'none'}
      <button
        class="test-btn"
        disabled={testStatus === 'sending'}
        onclick={testNotification}
      >
        {testStatus === 'sending' ? '发送中...' : '测试通知'}
      </button>
      {#if testStatus === 'ok'}
        <span class="test-ok">发送成功</span>
      {/if}
      {#if testStatus === 'error'}
        <span class="test-err">{testError}</span>
      {/if}
    {/if}
  </details>
{/if}

<style>
  .settings summary {
    cursor: pointer;
    opacity: 0.9;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .settings {
    margin-bottom: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 10px;
    margin-bottom: 10px;
  }
  .grid.single {
    grid-template-columns: 1fr;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .triggers {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
  }
  .ck {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    opacity: 0.85;
    cursor: pointer;
  }
  .ck input[type="checkbox"] {
    accent-color: rgba(126, 231, 135, 0.8);
  }
  .test-btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 4px;
  }
  .test-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .test-ok {
    font-size: 11px;
    color: rgba(126, 231, 135, 0.9);
    margin-left: 8px;
  }
  .test-err {
    font-size: 11px;
    color: rgba(255, 100, 100, 0.9);
    margin-left: 8px;
  }
</style>
