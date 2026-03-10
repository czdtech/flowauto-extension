<script lang="ts">
  import { onMount } from 'svelte';
  import { MSG } from '../shared/constants';
  import { parsePromptText } from '../shared/prompt-parser';
  import { saveImageBlob } from '../shared/image-store';
  import type {
    GetPageStateRequest,
    PageStateResponse,
    PingRequest,
    PongResponse,
    QueueAddTasksRequest,
    QueueClearHistoryRequest,
    QueueGetStateRequest,
    QueuePauseRequest,
    QueueRemoveTaskRequest,
    QueueRetryErrorsRequest,
    QueueSkipTaskRequest,
    QueueStartRequest,
    QueueStateResponse,
    SettingsUpdateRequest,
  } from '../shared/protocol';
  import { modeForModel } from '../shared/types';
  import type { GenerationMode, QueueState, TaskAsset, TaskItem, TaskStatus, UserSettings } from '../shared/types';

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
  let multiFileInput: HTMLInputElement | undefined;
  let folderImportStatus = '';
  let importSummary: { txtCount: number; imgCount: number; matchedCount: number; promptCount: number; matchedFiles: string[] } | null = null;
  let queue: QueueState | null = null;
  let settings: UserSettings | null = null;
  let queueError = '';
  let filter: 'all' | TaskStatus = 'all';

  let s_defaultModel: UserSettings['defaultModel'] = 'veo3.1-quality';
  let s_defaultAspectRatio: '16:9' | '9:16' = '9:16';
  let s_defaultOutputCount = 1;
  let s_defaultDownloadResolution: UserSettings['defaultDownloadResolution'] = '2K/1080p';
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

  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

  /** Strip the file extension from a filename. */
  function stripExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  /** Get the file extension (lowercase, no dot). */
  function getExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  /**
   * Store an image file in IndexedDB and return a TaskAsset.
   * Deduplicates by filename: the same file is stored only once.
   */
  const assetCache = new Map<string, TaskAsset>();
  async function storeAsAsset(imageFile: File): Promise<TaskAsset> {
    const cached = assetCache.get(imageFile.name);
    if (cached) {
      // Always re-save: IndexedDB entries may have been GC'd by clearQueue/clearHistory
      await saveImageBlob(cached.refId, imageFile);
      return { ...cached };
    }
    const refId = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await saveImageBlob(refId, imageFile);
    const asset: TaskAsset = { type: 'start', refId, filename: imageFile.name };
    assetCache.set(imageFile.name, asset);
    return { ...asset };
  }

  /**
   * Common logic: process a list of files (from folder or multi-file).
   * Finds .txt for prompts, matches images by basename.
   *
   * Matching strategies (in order):
   * 1. Exact basename match: prompt line "myimg, prompt text" → myimg.png
   * 2. If no prompts have filenames:
   *    - 1 image + N prompts → same image for all prompts
   *    - N images + N prompts → positional match (1st image → 1st prompt)
   *    - Otherwise → warn about format
   */
  async function processImportedFiles(files: FileList | File[]): Promise<void> {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    folderImportStatus = `正在解析 ${fileArr.length} 个文件...`;
    queueError = '';
    importSummary = null;

    try {
      const txtFiles: File[] = [];
      const imageFiles = new Map<string, File>();
      const imageList: File[] = [];

      for (const file of fileArr) {
        if (file.name.startsWith('.')) continue;
        const ext = getExt(file.name);
        if (ext === 'txt') {
          txtFiles.push(file);
        } else if (IMAGE_EXTS.has(ext)) {
          imageFiles.set(stripExt(file.name), file);
          imageList.push(file);
        }
      }

      if (txtFiles.length === 0) {
        importSummary = { txtCount: 0, imgCount: imageFiles.size, matchedCount: 0, promptCount: 0, matchedFiles: [] };
        queueError = `未找到 .txt 文件（找到 ${imageFiles.size} 张图片，但需要 .txt 提示词文件来匹配）`;
        folderImportStatus = '';
        return;
      }

      let allPromptText = '';
      for (const txt of txtFiles) {
        allPromptText += (await txt.text()) + '\n';
      }

      const prompts = parsePromptText(allPromptText);
      if (prompts.length === 0) {
        importSummary = { txtCount: txtFiles.length, imgCount: imageFiles.size, matchedCount: 0, promptCount: 0, matchedFiles: [] };
        queueError = '.txt 文件中未找到有效的提示词';
        folderImportStatus = '';
        return;
      }

      folderImportStatus = `解析到 ${prompts.length} 条提示词，正在匹配 ${imageList.length} 张图片...`;

      let matchedCount = 0;
      const matchedFiles: string[] = [];
      let matchMode = '';

      const hasAnyFilename = prompts.some((p) => !!p.filename);

      // Build a lowercase lookup for inline reference scanning
      const imgByFullName = new Map<string, File>();
      const imgByBaseName = new Map<string, File>();
      for (const img of imageList) {
        imgByFullName.set(img.name.toLowerCase(), img);
        const base = stripExt(img.name).toLowerCase();
        if (base.length >= 2) imgByBaseName.set(base, img);
      }

      if (hasAnyFilename) {
        // Strategy 1: Explicit "filename, prompt text" in txt → basename match
        matchMode = '按文件名匹配';
        for (const p of prompts) {
          if (!p.filename) continue;
          const imageFile = imageFiles.get(p.filename);
          if (!imageFile) continue;

          p.assets = [await storeAsAsset(imageFile)];
          matchedCount++;
          matchedFiles.push(imageFile.name);
        }
      } else if (imageList.length > 0) {
        // Strategy 2: Inline reference scan — find image filenames mentioned
        // in the prompt text. Supports multi-image per prompt.
        // e.g. "角色图1.png中的角色和角色图2.png中的角色搏斗" → [角色图1.png, 角色图2.png]
        let inlineTotal = 0;
        const inlineResults: { promptIdx: number; refs: File[] }[] = [];

        for (let i = 0; i < prompts.length; i++) {
          const textLower = prompts[i].prompt.toLowerCase();
          const refs: File[] = [];
          const seen = new Set<string>();

          // Pass 1: Match full filename (with extension) — high confidence
          for (const [fullName, img] of imgByFullName) {
            if (textLower.includes(fullName) && !seen.has(img.name)) {
              refs.push(img);
              seen.add(img.name);
            }
          }

          // Pass 2: Match basename (without extension) for remaining images
          for (const [baseName, img] of imgByBaseName) {
            if (!seen.has(img.name) && textLower.includes(baseName)) {
              refs.push(img);
              seen.add(img.name);
            }
          }

          if (refs.length > 0) {
            inlineResults.push({ promptIdx: i, refs });
            inlineTotal += refs.length;
          }
        }

        if (inlineTotal > 0) {
          // Inline references found — use them
          matchMode = `按提示词内引用匹配（${inlineResults.length}条命中）`;
          for (const { promptIdx, refs } of inlineResults) {
            const assets: TaskAsset[] = [];
            for (const img of refs) {
              assets.push(await storeAsAsset(img));
              if (!matchedFiles.includes(img.name)) matchedFiles.push(img.name);
            }
            prompts[promptIdx].assets = assets;
            matchedCount++;
          }
        } else {
          // Strategy 3: No inline refs found — fall back to smart M×N assign
          if (imageList.length === 1) {
            // 1图 × N词 → same image for all prompts
            matchMode = `1图×${prompts.length}词`;
            const asset = await storeAsAsset(imageList[0]);
            for (const p of prompts) {
              p.assets = [{ ...asset }];
              matchedCount++;
            }
            matchedFiles.push(imageList[0].name);
          } else if (prompts.length === 1) {
            // N图 × 1词 → duplicate the prompt for each image → N tasks
            matchMode = `${imageList.length}图×1词`;
            const original = prompts[0];
            prompts.length = 0;
            for (const img of imageList) {
              const asset = await storeAsAsset(img);
              prompts.push({ prompt: original.prompt, assets: [asset] });
              matchedCount++;
              matchedFiles.push(img.name);
            }
          } else if (imageList.length === prompts.length) {
            // N图 × N词 → positional match
            matchMode = `${imageList.length}图×${prompts.length}词 顺序匹配`;
            for (let i = 0; i < prompts.length; i++) {
              prompts[i].assets = [await storeAsAsset(imageList[i])];
              matchedCount++;
              matchedFiles.push(imageList[i].name);
            }
          } else {
            // M图 × N词 (M≠N, both > 1) → Cartesian product: M×N tasks
            const totalTasks = imageList.length * prompts.length;
            matchMode = `${imageList.length}图×${prompts.length}词 = ${totalTasks}任务`;
            const originalPrompts = prompts.map((p) => ({ ...p }));
            prompts.length = 0;
            const usedFiles = new Set<string>();
            for (const p of originalPrompts) {
              for (const img of imageList) {
                const asset = await storeAsAsset(img);
                prompts.push({ prompt: p.prompt, filename: p.filename, assets: [asset] });
                matchedCount++;
                usedFiles.add(img.name);
              }
            }
            matchedFiles.push(...usedFiles);
          }
        }
      }

      importSummary = {
        txtCount: txtFiles.length,
        imgCount: imageList.length,
        matchedCount,
        promptCount: prompts.length,
        matchedFiles,
      };

      folderImportStatus = `${matchMode} · ${matchedCount}/${prompts.length}，入队中...`;

      const res = await sendMessage<QueueAddTasksRequest, QueueStateResponse>({
        type: MSG.QUEUE_ADD_TASKS,
        prompts,
        modeOverride: effectiveModeForAdd,
      });
      queue = res.queue;
      settings = res.settings;

      folderImportStatus = `✅ ${matchMode} · 导入 ${prompts.length} 条任务（${matchedCount} 条含参考图）`;
      setTimeout(() => { folderImportStatus = ''; }, 8000);
    } catch (err: any) {
      queueError = `导入失败: ${err?.message ?? err}`;
      folderImportStatus = '';
    }
  }

  async function handleMultiFileImport(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    await processImportedFiles(input.files);
    input.value = '';
  }

  function topTabText(tab: ActiveTopTab): string {
    if (tab === 'image') return '图片';
    if (tab === 'video') return '视频';
    return '未知';
  }

  $: effectiveModeForAdd = ((): GenerationMode => {
    if (activeTopTab === 'image') return 'create-image';
    if (activeTopTab === 'video') return 'text-to-video';
    return modeForModel(s_defaultModel);
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
    s_defaultModel = next.defaultModel;
    s_defaultAspectRatio = next.defaultAspectRatio;
    s_defaultOutputCount = next.defaultOutputCount;
    s_defaultDownloadResolution = next.defaultDownloadResolution;
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
    if (queue?.isRunning) {
      queueError = '正在执行任务时不能清空历史';
      return;
    }
    try {
      const res = await sendMessage<QueueClearHistoryRequest, QueueStateResponse>({
        type: MSG.QUEUE_CLEAR_HISTORY,
      });
      queue = res.queue;
      settings = res.settings;
      // Also clear sidepanel-side caches so "历史清空" truly starts fresh.
      assetCache.clear();
      importSummary = null;
      folderImportStatus = '';
    } catch {
      queueError = '清空历史失败';
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

  function taskAssetFilenames(t: TaskItem): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const a of t.assets ?? []) {
      const name = (a.filename || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
    return result;
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
              onchange={(e) => patchSettings({ defaultAspectRatio: (e.target as HTMLSelectElement).value as any })}
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
              onchange={(e) => patchSettings({ defaultModel: (e.target as HTMLSelectElement).value as any })}
            >
              <optgroup label="视频与动画">
                <option value="veo3.1-quality">Veo 3.1 - Quality</option>
                <option value="veo3.1-fast">Veo 3.1 - Fast</option>
                <option value="veo2-quality">Veo 2 - Quality</option>
                <option value="veo2-fast">Veo 2 - Fast</option>
              </optgroup>
              <optgroup label="图像生成">
                <option value="nano-banana-pro">Nano Banana Pro</option>
                <option value="nano-banana-2">Nano Banana 2</option>
                <option value="imagen4">Imagen 4</option>
              </optgroup>
            </select>
          </label>

          <label>
            <div class="lab">下载画质</div>
            <select
              class="sel"
              bind:value={s_defaultDownloadResolution}
              onchange={(e) => patchSettings({ defaultDownloadResolution: (e.target as HTMLSelectElement).value as any })}
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

    <div class="textarea-wrap">
      <textarea
        class="textarea"
        rows="7"
        bind:value={promptText}
        placeholder={"每行一个 prompt；或用空行分隔多行 prompt。\n支持：文件名, prompt"}
      ></textarea>
      <input type="file" accept=".txt" class="hidden-file" bind:this={fileInput}
        onchange={handleFileImport} />
      <input type="file" class="hidden-file" bind:this={multiFileInput}
        accept=".txt,.png,.jpg,.jpeg,.webp,.gif,.bmp" onchange={handleMultiFileImport} multiple />
      <button class="btn-import" onclick={() => fileInput?.click()} title="从 .txt 文件导入提示词">
        导入
      </button>
    </div>

    <div class="import-row">
      <button class="btn btn-folder" onclick={() => multiFileInput?.click()} title="Ctrl多选 .txt + 图片文件 → 自动匹配">
        📎 导入 txt + 图片
      </button>
    </div>
    <div class="import-hint">
      Ctrl+点击 同时选中 .txt 和图片文件。提示词中直接写图片文件名可引用多张参考图；也支持 1图N词、N图1词、M×N 等自动匹配。
    </div>

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
        {#if importSummary.matchedFiles.length > 0}
          <div class="matched-list">
            {#each importSummary.matchedFiles as f}
              <span class="matched-tag">{f}</span>
            {/each}
          </div>
        {/if}
        <button class="btn-dismiss" onclick={() => { importSummary = null; }}>关闭</button>
      </div>
    {/if}

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
      <button class="btn btn-flex" onclick={clearHistory} disabled={!queue || queue.isRunning || (counts(queue).success + counts(queue).error + counts(queue).skipped) === 0}>
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
          {@const assetNames = taskAssetFilenames(t)}
          <div class="task">
            <div class="task-top">
              <div class="task-status">{t.status}</div>
              <div class="task-model">{t.model}</div>
              <div class="spacer"></div>
              <button class="mini" onclick={() => skipOne(t.id)} disabled={t.status !== 'waiting'}>
                跳过
              </button>
              <button class="mini danger" onclick={() => removeOne(t.id)}>删除</button>
            </div>
            {#if t.filename}
              <div class="task-fn">{t.filename}</div>
            {/if}
            <div class="task-prompt">{t.prompt}</div>
            {#if assetNames.length > 0}
              <div class="task-refs">
                <span class="task-refs-label">参考图</span>
                <div class="task-refs-list">
                  {#each assetNames as name}
                    <span class="task-ref-tag">{name}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if t.errorMessage}
              <div class="task-err">{t.errorMessage}</div>
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
  .sel option,
  .sel optgroup {
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
  .task-refs {
    margin-top: 6px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .task-refs-label {
    font-size: 11px;
    opacity: 0.65;
    white-space: nowrap;
    margin-top: 1px;
  }
  .task-refs-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .task-ref-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(126, 231, 135, 0.28);
    background: rgba(126, 231, 135, 0.10);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-err {
    margin-top: 6px;
    font-size: 12px;
    color: #ff7b72;
    white-space: pre-wrap;
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

