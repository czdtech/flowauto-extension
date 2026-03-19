<script lang="ts">
  import type { GenerationType } from '../../shared/types';
  
  interface ImportSummary {
    txtCount: number;
    imgCount: number;
    matchedCount: number;
    promptCount: number;
    matchedFiles: string[];
    warnings?: string[];
  }
  
  interface Props {
    promptText: string;
    folderImportStatus: string;
    importSummary: ImportSummary | null;
    s_defaultGenerationType: GenerationType;
    handleFileImport: (e: Event) => void;
    handleMultiFileImport: (e: Event) => Promise<void>;
    startQueue: () => void;
    stopQueue: () => void;
    retryAllErrors: () => void;
    clearHistory: () => void;
    dismissImportSummary: () => void;
    isRunning: boolean;
    hasError: boolean;
    canClearHistory: boolean;
    hasQueue: boolean;
    onUpdatePrompt: (text: string) => void;
    onAiEnhance: () => void;
    onAiVariants: () => void;
    aiLoading: boolean;
    hasAiSettings: boolean;
  }
  
  let {
    promptText = $bindable(),
    folderImportStatus = $bindable(),
    importSummary,
    s_defaultGenerationType,
    handleFileImport,
    handleMultiFileImport,
    startQueue,
    stopQueue,
    retryAllErrors,
    clearHistory,
    dismissImportSummary,
    isRunning,
    hasError,
    canClearHistory,
    hasQueue,
    onUpdatePrompt,
    onAiEnhance,
    onAiVariants,
    aiLoading,
    hasAiSettings
  }: Props = $props();
  
  let fileInput: HTMLInputElement | undefined = $state(undefined);
  let multiFileInput: HTMLInputElement | undefined = $state(undefined);
</script>

<div class="textarea-wrap">
  <textarea
    class="textarea"
    rows="7"
    value={promptText}
    oninput={(e) => onUpdatePrompt((e.target as HTMLTextAreaElement).value)}
    placeholder={"每行一个 prompt；或用空行分隔多行 prompt。\n在提示词中写 @文件名.png 可绑定参考图（支持多张）"}
  ></textarea>
  <input type="file" accept=".txt" class="hidden-file" bind:this={fileInput}
    onchange={handleFileImport} />
  <input type="file" class="hidden-file" bind:this={multiFileInput}
    accept=".txt,.png,.jpg,.jpeg,.webp,.gif,.bmp" onchange={handleMultiFileImport} multiple />
  <button class="btn-import" onclick={() => fileInput?.click()} title="从 .txt 文件导入提示词">
    导入
  </button>
</div>

{#if hasAiSettings}
  <div class="ai-row">
    <button class="btn btn-ai" onclick={onAiEnhance} disabled={aiLoading || !promptText.trim()}>
      {aiLoading ? '处理中...' : 'AI 增强'}
    </button>
    <button class="btn btn-ai" onclick={onAiVariants} disabled={aiLoading || !promptText.trim()}>
      {aiLoading ? '处理中...' : '生成变体'}
    </button>
  </div>
{/if}

{#if s_defaultGenerationType === 'image-to-image' || s_defaultGenerationType === 'image-to-video'}
  <div class="import-row">
    <button class="btn btn-folder" onclick={() => multiFileInput?.click()} title="Ctrl多选 .txt + 图片文件 → 自动匹配">
      📎 导入 txt + 图片
    </button>
  </div>
  <div class="import-hint">
    Ctrl+点击 同时选中 .txt 和图片文件。在提示词中用 `@文件名.png` 显式引用参考图（支持多张）；未检测到 @引用时将启用 1图N词、N图1词、顺序匹配、M×N 自动匹配。
  </div>
{/if}

{#if folderImportStatus}
  <div class="import-status">{folderImportStatus}</div>
{/if}

{#if importSummary}
  <div class="import-summary">
    <div class="summary-row">
      <span>📄 txt 文件: {importSummary.txtCount}</span>
      <span>🖼️ 图片: {importSummary.imgCount}</span>
      <span>✅ 匹配: {importSummary.matchedCount}/{importSummary.promptCount}</span>
    </div>
    {#if importSummary.warnings && importSummary.warnings.length > 0}
      <div class="warn-list">
        {#each importSummary.warnings as w}
          <div class="warn-item">⚠️ {w}</div>
        {/each}
      </div>
    {/if}
    {#if importSummary.matchedFiles.length > 0}
      <div class="matched-list">
        {#each importSummary.matchedFiles as f}
          <span class="matched-tag">{f}</span>
        {/each}
      </div>
    {/if}
    <button class="btn-dismiss" onclick={dismissImportSummary}>关闭</button>
  </div>
{/if}

<div class="row row-nowrap">
  <button class="btn primary btn-flex" onclick={startQueue} disabled={isRunning && promptText.length > 0}>
    开始生成
  </button>
  <button class="btn danger-btn btn-flex" onclick={stopQueue} disabled={!isRunning}>
    停止生成
  </button>
  <button class="btn btn-flex" onclick={retryAllErrors} disabled={!hasError}>
    重试失败
  </button>
  <button class="btn btn-flex" onclick={clearHistory} disabled={!canClearHistory}>
    清空历史
  </button>
</div>

<style>
  .textarea-wrap {
    position: relative;
  }
  .hidden-file {
    display: none;
  }
  .btn-import {
    position: absolute;
    top: 6px;
    right: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border-radius: 8px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.7;
  }
  .btn-import:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.14);
  }
  .import-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .btn-folder {
    font-size: 12px;
    padding: 5px 10px;
    background: rgba(126, 200, 255, 0.10);
    border-color: rgba(126, 200, 255, 0.30);
    flex: 1;
    text-align: center;
  }
  .btn-folder:hover {
    background: rgba(126, 200, 255, 0.18);
  }
  .import-status {
    margin-top: 6px;
    font-size: 11px;
    opacity: 0.8;
    padding: 4px 8px;
    border-radius: 8px;
    background: rgba(126, 200, 255, 0.06);
    border: 1px solid rgba(126, 200, 255, 0.15);
  }
  .import-summary {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(126, 231, 135, 0.06);
    border: 1px solid rgba(126, 231, 135, 0.20);
    font-size: 12px;
  }
  .warn-list {
    margin-top: 6px;
    margin-bottom: 6px;
    padding: 6px 8px;
    border-radius: 10px;
    background: rgba(246, 211, 101, 0.06);
    border: 1px solid rgba(246, 211, 101, 0.20);
  }
  .warn-item {
    font-size: 11px;
    line-height: 1.35;
    opacity: 0.9;
    word-break: break-word;
  }
  .summary-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .matched-list {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .matched-tag {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgba(126, 231, 135, 0.12);
    border: 1px solid rgba(126, 231, 135, 0.25);
    white-space: nowrap;
  }
  .import-hint {
    font-size: 10px;
    opacity: 0.5;
    line-height: 1.4;
    margin-top: 4px;
    padding: 0 2px;
  }
  .btn-dismiss {
    border: none;
    background: none;
    color: inherit;
    opacity: 0.5;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
  }
  .btn-dismiss:hover {
    opacity: 0.9;
  }
  .textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 12px;
    padding: 10px;
    resize: vertical;
    outline: none;
    line-height: 1.35;
  }
  .textarea:focus {
    border-color: rgba(126, 231, 135, 0.45);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .row-nowrap {
    flex-wrap: nowrap;
    gap: 6px;
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: rgba(126, 231, 135, 0.16);
    border-color: rgba(126, 231, 135, 0.35);
  }
  .btn.danger-btn {
    background: rgba(255, 123, 114, 0.14);
    border-color: rgba(255, 123, 114, 0.40);
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .btn.primary:hover {
    background: rgba(126, 231, 135, 0.22);
  }
  .btn.danger-btn:hover {
    background: rgba(255, 123, 114, 0.22);
  }
  .btn-flex {
    white-space: nowrap;
    padding-left: 8px;
    padding-right: 8px;
    font-size: 12px;
  }
  .ai-row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .btn-ai {
    flex: 1;
    font-size: 11px;
    padding: 4px 8px;
    background: rgba(168, 130, 255, 0.10);
    border-color: rgba(168, 130, 255, 0.30);
  }
  .btn-ai:hover {
    background: rgba(168, 130, 255, 0.18);
  }
</style>