<script lang="ts">
  import { onMount } from 'svelte';
  import { MSG } from '../shared/constants';
  import { parsePromptText } from '../shared/prompt-parser';
  import type {
    GetPageStateRequest,
    PageStateResponse,
    PingRequest,
    PongResponse,
    QueueAddTasksRequest,
    QueueClearHistoryRequest,
    QueueClearRequest,
    QueueGetStateRequest,
    QueuePauseRequest,
    QueueRemoveTaskRequest,
    QueueRetryErrorsRequest,
    QueueSkipTaskRequest,
    QueueStartRequest,
    QueueStateResponse,
    SettingsUpdateRequest,
  } from '../shared/protocol';
  import type { GenerationMode, QueueState, TaskItem, TaskStatus, UserSettings } from '../shared/types';

  type Status = 'checking' | 'connected' | 'disconnected';

  let status: Status = 'checking';
  let reason = '';
  let url = '';
  let title = '';
  let lastCheckedAt = 0;
  type ActiveTopTab = 'video' | 'image' | 'unknown';
  let activeTopTab: ActiveTopTab = 'unknown';

  let promptText = '';
  let fileInput: HTMLInputElement | undefined;
  let queue: QueueState | null = null;
  let settings: UserSettings | null = null;
  let queueError = '';
  let filter: 'all' | TaskStatus = 'all';
  let collapsedTasks = new Set<string>();

  function isExpanded(t: TaskItem): boolean {
    return hasLogs(t) && !collapsedTasks.has(t.id);
  }

  function toggleExpand(taskId: string): void {
    if (collapsedTasks.has(taskId)) {
      collapsedTasks.delete(taskId);
    } else {
      collapsedTasks.add(taskId);
    }
    collapsedTasks = collapsedTasks;
  }

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function hasLogs(t: TaskItem): boolean {
    return !!t.logs && t.logs.length > 0;
  }

  let s_defaultMode: GenerationMode = 'text-to-video';
  let s_defaultAspectRatio: '16:9' | '9:16' = '9:16';
  let s_defaultOutputCount = 1;
  let s_defaultVeoModel: UserSettings['defaultVeoModel'] = 'veo3.1-quality';
  let s_defaultImageModel: UserSettings['defaultImageModel'] = 'nano-banana-pro';
  let s_interTaskDelayMs = 5000;

  function sendMessage<TReq, TRes>(message: TReq): Promise<TRes> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: TRes) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  function handleFileImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      if (!lines.length) return;
      promptText = promptText ? promptText + '\n' + lines.join('\n') : lines.join('\n');
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }

  function topTabText(tab: ActiveTopTab): string {
    if (tab === 'image') return '图片';
    if (tab === 'video') return '视频';
    return '未知';
  }

  $: showImageControls =
    activeTopTab === 'image' ||
    (activeTopTab === 'unknown' && s_defaultMode === 'create-image');

  $: effectiveModeForAdd = ((): GenerationMode => {
    if (activeTopTab === 'image') return 'create-image';
    if (activeTopTab === 'video')
      return s_defaultMode === 'create-image' ? 'text-to-video' : s_defaultMode;
    return s_defaultMode;
  })();

  async function refreshPageState(): Promise<void> {
    try {
      const res = await sendMessage<GetPageStateRequest, PageStateResponse>({
        type: MSG.GET_PAGE_STATE,
      });

      if (res.isFlowProject && (res.activeTopTab === 'image' || res.activeTopTab === 'video')) {
        // Only update when the value actually changes to avoid triggering re-renders.
        if (activeTopTab !== res.activeTopTab) {
          activeTopTab = res.activeTopTab;
        }
      }
      // On error / non-flow page: keep the last known value — don't reset to 'unknown'
      // to avoid the model selector flipping back and forth each poll cycle.
    } catch {
      // Silently keep last known state.
    }
  }

  async function ping(): Promise<void> {
    // Don't reset status to 'checking' on every poll — it causes the status card
    // to flash "检测中…" then back to "已连接" every 2.5 s.
    // Only set 'checking' on the very first call (when status is still the default).
    const wasUnknown = status === 'checking';
    try {
      const res = await sendMessage<PingRequest, PongResponse>({ type: MSG.PING });
      lastCheckedAt = Date.now();
      url = res.url ?? '';
      title = res.title ?? '';

      if (res.connected) {
        status = 'connected';
        reason = '';
      } else {
        status = 'disconnected';
        reason = res.reason ?? '';
      }
    } catch {
      if (wasUnknown || status === 'connected') {
        status = 'disconnected';
        reason = 'unknown';
      }
    }
  }

  async function refreshQueue(): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueGetStateRequest, QueueStateResponse>({
        type: MSG.QUEUE_GET_STATE,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '队列状态获取失败';
    }
  }

  function syncSettingsDraft(next: UserSettings | null): void {
    if (!next) return;
    s_defaultMode = next.defaultMode;
    s_defaultAspectRatio = next.defaultAspectRatio;
    s_defaultOutputCount = next.defaultOutputCount;
    s_defaultVeoModel = next.defaultVeoModel;
    s_defaultImageModel = next.defaultImageModel;
    s_interTaskDelayMs = next.interTaskDelayMs;
  }

  async function patchSettings(patch: Partial<UserSettings>): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<SettingsUpdateRequest, QueueStateResponse>({
        type: MSG.SETTINGS_UPDATE,
        patch,
      });
      queue = res.queue;
      settings = res.settings;
      syncSettingsDraft(settings);
    } catch {
      queueError = '更新设置失败';
    }
  }

  /** Add prompts to queue (if textarea has content) then start running. */
  async function startQueue(): Promise<void> {
    queueError = '';
    const prompts = parsePromptText(promptText);

    // Add new prompts first if any.
    if (prompts.length) {
      try {
        const res = await sendMessage<QueueAddTasksRequest, QueueStateResponse>({
          type: MSG.QUEUE_ADD_TASKS,
          prompts,
          modeOverride: effectiveModeForAdd,
        });
        queue = res.queue;
        settings = res.settings;
        promptText = '';
      } catch {
        queueError = '加入队列失败';
        return;
      }
    }

    // Then start the runner.
    try {
      const res = await sendMessage<QueueStartRequest, QueueStateResponse>({
        type: MSG.QUEUE_START,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '开始失败';
    }
  }

  async function stopQueue(): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueuePauseRequest, QueueStateResponse>({
        type: MSG.QUEUE_PAUSE,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '停止失败';
    }
  }

  async function clearHistory(): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueClearHistoryRequest, QueueStateResponse>({
        type: MSG.QUEUE_CLEAR_HISTORY,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '清空历史失败';
    }
  }

  async function clearAll(): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueClearRequest, QueueStateResponse>({
        type: MSG.QUEUE_CLEAR,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '清空全部失败';
    }
  }

  async function retryAllErrors(): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueRetryErrorsRequest, QueueStateResponse>({
        type: MSG.QUEUE_RETRY_ERRORS,
      });
      queue = res.queue;
      settings = res.settings;
      syncSettingsDraft(settings);
    } catch {
      queueError = '重试失败';
    }
  }


  async function removeOne(taskId: string): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueRemoveTaskRequest, QueueStateResponse>({
        type: MSG.QUEUE_REMOVE_TASK,
        taskId,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '删除任务失败';
    }
  }

  async function skipOne(taskId: string): Promise<void> {
    queueError = '';
    try {
      const res = await sendMessage<QueueSkipTaskRequest, QueueStateResponse>({
        type: MSG.QUEUE_SKIP_TASK,
        taskId,
      });
      queue = res.queue;
      settings = res.settings;
    } catch {
      queueError = '跳过任务失败';
    }
  }

  function reasonText(r: string): string {
    switch (r) {
      case 'no_active_tab':
        return '未找到当前活动标签页';
      case 'not_labs':
        return '当前标签页不是 labs.google';
      case 'not_flow_project':
        return '当前 labs 页面不是 Flow 项目页';
      case 'no_content_script':
        return '未检测到内容脚本（可先刷新 Flow 页面；或到扩展详情里允许访问 labs.google）';
      case 'timeout':
        return '页面响应超时';
      default:
        return '未知错误';
    }
  }

  let timer: number | undefined;
  onMount(() => {
    const tick = async () => {
      // Keep M0 connection check + M1 queue state in sync.
      await Promise.all([ping(), refreshQueue(), refreshPageState()]);
    };

    tick();
    timer = window.setInterval(tick, 2500);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  });

  $: if (settings) syncSettingsDraft(settings);

  function isImageMode(mode: GenerationMode): boolean {
    return mode === 'create-image';
  }

  function taskMatchesTab(t: { mode: GenerationMode }): boolean {
    if (activeTopTab === 'image') return isImageMode(t.mode);
    if (activeTopTab === 'video') return !isImageMode(t.mode);
    return true; // unknown tab: show all
  }

  function counts(q: QueueState): Record<string, number> {
    const visible = q.tasks.filter(taskMatchesTab);
    const c: Record<string, number> = {
      all: visible.length,
      waiting: 0,
      running: 0,
      downloading: 0,
      success: 0,
      error: 0,
      skipped: 0,
    };
    for (const t of visible) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }
</script>

<main>
  <header>
    <div class="title">FlowAuto</div>
    <button class="btn" onclick={ping}>刷新连接</button>
  </header>

  <section class="card">
    {#if status === 'connected'}
      <div class="status ok">已连接：Flow 项目页</div>
    {:else if status === 'checking'}
      <div class="status warn">检测中…</div>
    {:else}
      <div class="status bad">未连接</div>
      <div class="reason">{reasonText(reason)}</div>
    {/if}

    {#if url}
      <div class="meta">
        <div class="k">URL</div>
        <div class="v">{url}</div>
      </div>
    {/if}
    {#if title}
      <div class="meta">
        <div class="k">Title</div>
        <div class="v">{title}</div>
      </div>
    {/if}
    {#if lastCheckedAt}
      <div class="meta">
        <div class="k">Last</div>
        <div class="v">{new Date(lastCheckedAt).toLocaleTimeString()}</div>
      </div>
    {/if}
    {#if status === 'connected' && activeTopTab !== 'unknown'}
      <div class="meta">
        <div class="k">Tab</div>
        <div class="v">{topTabText(activeTopTab)}</div>
      </div>
    {/if}
  </section>

  <section class="card card-gap">
    {#if settings}
      <details class="settings" open>
        <summary>默认设置</summary>
        <div class="grid">
          <label>
            <div class="lab">画幅</div>
            <select
              class="sel"
              bind:value={s_defaultAspectRatio}
              onchange={() => patchSettings({ defaultAspectRatio: s_defaultAspectRatio })}
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
              onchange={() => patchSettings({ defaultOutputCount: Number(s_defaultOutputCount) })}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>

          {#if showImageControls}
            <label>
              <div class="lab">图片模型</div>
              <select
                class="sel"
                bind:value={s_defaultImageModel}
                onchange={() => patchSettings({ defaultImageModel: s_defaultImageModel })}
              >
                <option value="nano-banana-pro">Nano Banana Pro</option>
                <option value="nano-banana">Nano Banana</option>
                <option value="imagen4">Imagen 4</option>
              </select>
            </label>
          {:else}
            <label>
              <div class="lab">视频模型</div>
              <select
                class="sel"
                bind:value={s_defaultVeoModel}
                onchange={() => patchSettings({ defaultVeoModel: s_defaultVeoModel })}
              >
                <option value="veo3.1-fast">Veo 3.1 - Fast</option>
                <option value="veo3.1-quality">Veo 3.1 - Quality</option>
                <option value="veo2-fast">Veo 2 - Fast</option>
                <option value="veo2-quality">Veo 2 - Quality</option>
              </select>
            </label>
          {/if}

          <label>
            <div class="lab">间隔(ms)</div>
            <input
              class="inp"
              type="number"
              min="0"
              step="500"
              bind:value={s_interTaskDelayMs}
              onchange={() => patchSettings({ interTaskDelayMs: Number(s_interTaskDelayMs) })}
            />
          </label>
        </div>
      </details>
    {/if}

    <div class="textarea-wrap">
      <textarea
        class="textarea"
        rows="7"
        bind:value={promptText}
        placeholder={"每行一个 prompt；或用空行分隔多行 prompt。\n支持：文件名, prompt"}
      ></textarea>
      <input type="file" accept=".txt" class="hidden-file" bind:this={fileInput}
        onchange={handleFileImport} />
      <button class="btn-import" onclick={() => fileInput?.click()} title="从 .txt 文件导入提示词">
        导入
      </button>
    </div>

    <div class="row row-nowrap">
      <button class="btn primary btn-flex" onclick={startQueue} disabled={!!queue?.isRunning && parsePromptText(promptText).length === 0}>
        开始生成
      </button>
      <button class="btn danger-btn btn-flex" onclick={stopQueue} disabled={!queue?.isRunning}>
        停止生成
      </button>
      <button class="btn btn-flex" onclick={retryAllErrors} disabled={!queue || counts(queue).error === 0}>
        重试失败
      </button>
      <button class="btn btn-flex" onclick={clearHistory} disabled={!queue || (counts(queue).success + counts(queue).error + counts(queue).skipped) === 0}>
        清空历史
      </button>
    </div>

    {#if queueError}
      <div class="error">{queueError}</div>
    {/if}

    {#if queue}
      {@const c = counts(queue)}
      <div class="queue-top">
        <div class="sub sub-inline">共 {c.all} 条 · 成 {c.success} · 败 {c.error} · 跳 {c.skipped}</div>
        <div class="filter-inline">
          <div class="lab2">筛选</div>
          <select class="sel sel-tight" bind:value={filter}>
            <option value="all">全部</option>
            <option value="waiting">waiting</option>
            <option value="running">running</option>
            <option value="success">success</option>
            <option value="error">error</option>
            <option value="skipped">skipped</option>
          </select>
        </div>
      </div>

      <div class="task-list">
        {#each queue.tasks.slice().reverse().filter((t) => taskMatchesTab(t) && (filter === 'all' || t.status === filter)) as t (t.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="task" class:task-clickable={hasLogs(t)} onclick={() => hasLogs(t) && toggleExpand(t.id)}>
            <div class="task-top">
              <div class="task-status">{t.status}</div>
              <div class="task-model">{t.model}</div>
              <div class="spacer"></div>
              {#if hasLogs(t)}
                <span class="expand-icon">{isExpanded(t) ? '▾' : '▸'}</span>
              {/if}
              <button class="mini" onclick={(e) => { e.stopPropagation(); skipOne(t.id); }} disabled={t.status !== 'waiting'}>
                跳过
              </button>
              <button class="mini danger" onclick={(e) => { e.stopPropagation(); removeOne(t.id); }}>删除</button>
            </div>
            {#if t.filename}
              <div class="task-fn">{t.filename}</div>
            {/if}
            <div class="task-prompt">{t.prompt}</div>
            {#if t.errorMessage}
              <div class="task-err">{t.errorMessage}</div>
            {/if}
            {#if isExpanded(t) && t.logs}
              <div class="task-logs">
                {#each t.logs as log}
                  <div class="task-log-line">
                    <span class="log-time">{fmtTime(log.ts)}</span>
                    <span class="log-msg">{log.msg}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <footer>
    <div class="hint">
      只在 `https://labs.google/fx/.../tools/flow/project/...` 页面上显示“已连接”。
    </div>
  </footer>
</main>

<style>
  main {
    padding: 12px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .title {
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .card-gap {
    margin-top: 12px;
  }
  .sub {
    opacity: 0.8;
    font-size: 12px;
    line-height: 1.35;
    margin-bottom: 10px;
  }
  .sub-inline {
    margin-bottom: 0;
    white-space: nowrap;
  }
  .queue-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: nowrap;
  }
  .filter-inline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    white-space: nowrap;
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
  .btn-flex {
    white-space: nowrap;
    padding-left: 8px;
    padding-right: 8px;
    font-size: 12px;
  }
  .lab2 {
    opacity: 0.75;
    font-size: 12px;
  }
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
  .sel-tight {
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .sel option {
    background: #1e1e1e;
    color: #fff;
  }
  .sel:focus,
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
  .card {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.04);
  }
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
  .error {
    margin-top: 10px;
    color: #ff7b72;
    font-size: 12px;
  }
  .task-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow: auto;
    padding-right: 2px;
  }
  .task {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 10px;
  }
  .task-top {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 6px;
  }
  .spacer {
    flex: 1;
  }
  .mini {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .mini:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .mini:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .mini.danger {
    border-color: rgba(255, 123, 114, 0.35);
    background: rgba(255, 123, 114, 0.10);
  }
  .mini.danger:hover {
    background: rgba(255, 123, 114, 0.14);
  }
  .task-status {
    font-weight: 650;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
  }
  .task-model {
    opacity: 0.8;
    font-size: 12px;
  }
  .task-fn {
    font-size: 12px;
    opacity: 0.85;
    margin-bottom: 4px;
  }
  .task-prompt {
    font-size: 12px;
    opacity: 0.9;
    line-height: 1.35;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .task-err {
    margin-top: 6px;
    font-size: 12px;
    color: #ff7b72;
    white-space: pre-wrap;
  }
  .task-clickable {
    cursor: pointer;
  }
  .task-clickable:hover {
    border-color: rgba(255, 255, 255, 0.18);
  }
  .expand-icon {
    opacity: 0.5;
    font-size: 11px;
    user-select: none;
  }
  .task-logs {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .task-log-line {
    font-size: 11px;
    line-height: 1.4;
    opacity: 0.8;
  }
  .log-time {
    opacity: 0.5;
    margin-right: 6px;
    font-family: monospace;
    font-size: 10px;
  }
  .log-msg {
    word-break: break-word;
  }
  .status {
    font-weight: 650;
    margin-bottom: 6px;
  }
  .status.ok {
    color: #7ee787;
  }
  .status.warn {
    color: #f6d365;
  }
  .status.bad {
    color: #ff7b72;
  }
  .reason {
    opacity: 0.9;
    margin-bottom: 8px;
  }
  .meta {
    display: grid;
    grid-template-columns: 54px 1fr;
    gap: 8px;
    margin-top: 8px;
  }
  .k {
    opacity: 0.65;
    font-size: 12px;
  }
  .v {
    font-size: 12px;
    word-break: break-all;
    line-height: 1.35;
  }
  footer {
    margin-top: 12px;
    opacity: 0.7;
    font-size: 12px;
    line-height: 1.35;
  }
  .hint {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px dashed rgba(255, 255, 255, 0.12);
  }
</style>

