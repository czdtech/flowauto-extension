rc/sidepanel/components/SettingsPanel.svelte</path>
<content lang="svelte"><script lang="ts">
  import type { UserSettings } from '../../shared/types';
  
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
</style>