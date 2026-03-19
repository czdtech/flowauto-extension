<script lang="ts">
  import { onMount } from 'svelte';
  import StatusHeader from './components/StatusHeader.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import TaskInput from './components/TaskInput.svelte';
  import TaskList from './components/TaskList.svelte';
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
  import type { GenerationMode, GenerationType, QueueState, TaskAsset, TaskItem, TaskStatus, UserSettings } from '../shared/types';

  type Status = 'checking' | 'connected' | 'disconnected';

  let status: Status = $state('checking');
  let reason = $state('');
  let url = $state('');
  let title = $state('');
  let lastCheckedAt = $state(0);
  type ActiveTopTab = 'video' | 'image' | 'unknown';
  let activeTopTab: ActiveTopTab = $state('unknown');

  let promptText = $state('');
  let fileInput: HTMLInputElement | undefined;
  let multiFileInput: HTMLInputElement | undefined;
  let folderImportStatus = $state('');
  let importSummary: { txtCount: number; imgCount: number; matchedCount: number; promptCount: number; matchedFiles: string[] } | null = $state(null);
  let queue: QueueState | null = $state(null);
  let settings: UserSettings | null = $state(null);
  let queueError = $state('');
  let filter: 'all' | TaskStatus = $state('all');

  let s_defaultModel: UserSettings['defaultModel'] = $state('nano-banana-2');
  let s_defaultGenerationType: GenerationType = $state('text-to-image');
  let s_defaultAspectRatio: '16:9' | '9:16' = $state('9:16');
  let s_defaultOutputCount = $state(1);
  let s_defaultDownloadResolution: UserSettings['defaultDownloadResolution'] = $state('2K/1080p');
  let s_interTaskDelayMs = $state(5000);
  let s_stealthMode = $state(false);
  let s_chainMode = $state(false);

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

  function stripExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function getExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  const assetCache = new Map<string, TaskAsset>();
  async function storeAsAsset(imageFile: File): Promise<TaskAsset> {
    const cached = assetCache.get(imageFile.name);
    if (cached) {
      await saveImageBlob(cached.refId, imageFile);
      return { ...cached };
    }
    const refId = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await saveImageBlob(refId, imageFile);
    const asset: TaskAsset = { type: 'start', refId, filename: imageFile.name };
    assetCache.set(imageFile.name, asset);
    return { ...asset };
  }

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
      const warnings: string[] = [];
      let matchMode = '';

      const hasAnyInlineRefs = prompts.some(
        (p) => !!p.inlineRefs && p.inlineRefs.length > 0,
      );

      const imgByFullName = new Map<string, File>();
      for (const img of imageList) imgByFullName.set(img.name.toLowerCase(), img);

      // Strategy 1: explicit inline references via @filename.ext
      if (imageList.length > 0 && hasAnyInlineRefs) {
        let inlineHits = 0;
        for (let i = 0; i < prompts.length; i++) {
          const refs = prompts[i].inlineRefs ?? [];
          if (refs.length === 0) continue;
          const assets: TaskAsset[] = [];
          for (const ref of refs) {
            const img = imgByFullName.get(ref.toLowerCase());
            if (!img) {
              warnings.push(`提示词引用了 @${ref} 但未上传该图片`);
              continue;
            }
            assets.push(await storeAsAsset(img));
            if (!matchedFiles.includes(img.name)) matchedFiles.push(img.name);
          }
          if (assets.length > 0) {
            prompts[i].assets = assets;
            matchedCount++;
            inlineHits++;
          }
        }
        if (inlineHits > 0) {
          matchMode = `按 @引用匹配（${inlineHits}条命中）`;
        }
      }

      const anyAssetsSoFar = prompts.some((p) => (p.assets?.length ?? 0) > 0);

      // Strategy 2: smart fallback matching (guarded)
      if (imageList.length > 0 && !anyAssetsSoFar) {
        warnings.push("未检测到 @引用，已启用自动匹配策略。建议在提示词中写 `@文件名.png` 显式引用参考图。");

          if (imageList.length === 1) {
            matchMode = `1图×${prompts.length}词`;
            const asset = await storeAsAsset(imageList[0]);
            for (const p of prompts) {
              p.assets = [{ ...asset }];
              matchedCount++;
            }
            matchedFiles.push(imageList[0].name);
          } else if (prompts.length === 1) {
            matchMode = `${imageList.length}图×1词`;
            const assets: TaskAsset[] = [];
            for (const img of imageList) {
              assets.push(await storeAsAsset(img));
              matchedFiles.push(img.name);
            }
            prompts[0].assets = assets;
            matchedCount++;
          } else if (imageList.length === prompts.length) {
            matchMode = `${imageList.length}图×${prompts.length}词 顺序匹配`;
            for (let i = 0; i < prompts.length; i++) {
              prompts[i].assets = [await storeAsAsset(imageList[i])];
              matchedCount++;
              matchedFiles.push(imageList[i].name);
            }
          } else {
            const totalTasks = imageList.length * prompts.length;
            matchMode = `${imageList.length}图×${prompts.length}词 = ${totalTasks}任务`;
            const originalPrompts = prompts.map((p) => ({ ...p }));
            prompts.length = 0;
            const usedFiles = new Set<string>();
            for (const p of originalPrompts) {
              for (const img of imageList) {
                const asset = await storeAsAsset(img);
                prompts.push({ prompt: p.prompt, assets: [asset] });
                matchedCount++;
                usedFiles.add(img.name);
              }
            }
            matchedFiles.push(...usedFiles);
          }
      }

      // Unused images guardrail.
      if (imageList.length > 0 && matchedFiles.length > 0) {
        const used = new Set(matchedFiles.map((n) => n.toLowerCase()));
        const unused = imageList.filter((img) => !used.has(img.name.toLowerCase()));
        if (unused.length > 0) {
          warnings.push(`以下图片未被使用：${unused.map((x) => x.name).join("、")}`);
        }
      }

      importSummary = {
        txtCount: txtFiles.length,
        imgCount: imageList.length,
        matchedCount,
        promptCount: prompts.length,
        matchedFiles,
        warnings,
      };

      folderImportStatus = `${matchMode} · ${matchedCount}/${prompts.length}，入队中...`;

      const effectiveModeForAdd: GenerationMode = (() => {
        switch (s_defaultGenerationType) {
          case 'image-to-video': return 'frames-first';
          case 'text-to-video': return 'text-to-video';
          case 'text-to-image':
          case 'image-to-image': return 'create-image';
          default: return modeForModel(s_defaultModel);
        }
      })();

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

  async function refreshPageState(): Promise<void> {
    try {
      const res = await sendMessage<GetPageStateRequest, PageStateResponse>({
        type: MSG.GET_PAGE_STATE,
      });

      if (res.isFlowProject && (res.activeTopTab === 'image' || res.activeTopTab === 'video')) {
        if (activeTopTab !== res.activeTopTab) {
          activeTopTab = res.activeTopTab;
        }
      }
    } catch {
      // Silently keep last known state.
    }
  }

  async function ping(): Promise<void> {
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
    s_defaultGenerationType = next.defaultGenerationType ?? 'text-to-image';
    s_defaultAspectRatio = next.defaultAspectRatio;
    s_defaultOutputCount = next.defaultOutputCount;
    s_defaultDownloadResolution = next.defaultDownloadResolution;
    s_interTaskDelayMs = next.interTaskDelayMs;
    s_stealthMode = next.stealthMode;
    s_chainMode = next.chainMode;
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

  async function startQueue(): Promise<void> {
    queueError = '';
    const prompts = parsePromptText(promptText);

    if (prompts.length) {
      try {
        const effectiveModeForAdd: GenerationMode = (() => {
          switch (s_defaultGenerationType) {
            case 'image-to-video': return 'frames-first';
            case 'text-to-video': return 'text-to-video';
            case 'text-to-image':
            case 'image-to-image': return 'create-image';
            default: return modeForModel(s_defaultModel);
          }
        })();

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

  let timer: number | undefined;
  onMount(() => {
    const tick = async () => {
      await Promise.all([ping(), refreshQueue(), refreshPageState()]);
    };

    tick();
    timer = window.setInterval(tick, 2500);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  });

  $effect(() => {
    if (settings) syncSettingsDraft(settings);
  });

  function isImageMode(mode: GenerationMode): boolean {
    return mode === 'create-image';
  }

  function taskMatchesTab(t: { mode: GenerationMode }): boolean {
    if (activeTopTab === 'image') return isImageMode(t.mode);
    if (activeTopTab === 'video') return !isImageMode(t.mode);
    return true;
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
  
  function dismissImportSummary() {
    importSummary = null;
  }
</script>

<main>
  <StatusHeader {status} {title} {reason} onRefresh={ping} />

  <section class="card card-gap">
    <SettingsPanel
      {settings}
      bind:s_defaultModel
      bind:s_defaultGenerationType
      bind:s_defaultAspectRatio
      bind:s_defaultOutputCount
      bind:s_defaultDownloadResolution
      bind:s_interTaskDelayMs
      bind:s_stealthMode
      bind:s_chainMode
      {patchSettings}
    />

    <TaskInput
      bind:promptText
      bind:folderImportStatus
      bind:importSummary
      {s_defaultGenerationType}
      {handleFileImport}
      {handleMultiFileImport}
      {startQueue}
      {stopQueue}
      {retryAllErrors}
      {clearHistory}
      {dismissImportSummary}
      isRunning={!!queue?.isRunning}
      hasError={queue ? counts(queue).error > 0 : false}
      canClearHistory={!!queue && !queue.isRunning && (counts(queue).success + counts(queue).error + counts(queue).skipped) > 0}
      hasQueue={!!queue}
      onUpdatePrompt={(text) => promptText = text}
    />

    {#if queueError}
      <div class="error">{queueError}</div>
    {/if}

    <TaskList 
      {queue} 
      bind:filter 
      {activeTopTab}
      onFilterChange={(f) => filter = f}
      onSkip={skipOne}
      onRemove={removeOne}
    />
  </section>

  <footer>
    <div class="hint">
      只在 `https://labs.google/fx/.../tools/flow/project/...` 页面上显示"已连接"。
    </div>
  </footer>
</main>

<style>
  main {
    padding: 12px;
  }
  .card-gap {
    margin-top: 12px;
  }
  .card {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.04);
  }
  .error {
    margin-top: 10px;
    color: #ff7b72;
    font-size: 12px;
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
