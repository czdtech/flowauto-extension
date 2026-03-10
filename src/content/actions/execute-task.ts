import { MSG } from '../../shared/constants';
import type { TaskItem } from '../../shared/types';
import { buildProjectDir, buildTaskBaseName } from '../../shared/filename-utils';
import { downloadTopNLatestWithNaming } from './download';
import { createAndWaitForGeneration } from './generate';
import { injectImageToFlow } from './inject-image';
import { setPromptText } from './prompt';
import { setAspectRatio, setMode, setModel, setOutputCount } from './settings';
import { getProjectName } from '../page-state';
import { sleep } from '../utils/dom';
import { selectTab } from './navigate';

// In-memory blob cache keyed by refId.  Avoids repeated IndexedDB + base64
// round-trips when the same image (same refId) is needed across tasks.
const blobCache = new Map<string, Blob>();

// Maps filename → Flow media UUID.  After a successful upload, Flow assigns
// a UUID to the image (visible in media.getMediaUrlRedirect?name=UUID URLs).
// Subsequent tasks can reuse the image by selecting it from the resource panel
// via this UUID instead of re-uploading.
const uploadedMediaIds = new Map<string, string>();

function mediaTypeForTask(task: TaskItem): 'image' | 'video' {
  return task.mode === 'create-image' ? 'image' : 'video';
}

function timeoutForTask(task: TaskItem): number {
  return task.mode === 'create-image' ? 120_000 : 900_000;
}

function taskLog(taskId: string, msg: string): void {
  console.log(`[FlowAuto] ${msg}`);
  try {
    const maybe = chrome.runtime.sendMessage({ type: MSG.TASK_LOG, taskId, msg } as any);
    // In MV3 this may return a Promise; avoid "Uncaught (in promise)" noise.
    if (maybe && typeof (maybe as any).catch === 'function') (maybe as any).catch(() => {});
  } catch { /* best effort */ }
}

/**
 * Fetch an image blob from IndexedDB via the background service worker.
 * The background returns base64-encoded data (ArrayBuffer cannot survive
 * chrome.runtime.sendMessage serialization).
 */
async function fetchAssetBlob(refId: string): Promise<Blob> {
  const cached = blobCache.get(refId);
  if (cached) {
    console.log(`[FlowAuto] fetchAssetBlob: ${refId} → ${cached.size} bytes (内存缓存)`);
    return cached;
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: MSG.GET_IMAGE_BLOB, refId },
      (response: any) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.found || !response.data) {
          reject(new Error(`图片未找到 (refId: ${refId})`));
          return;
        }
        const binary = atob(response.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: response.mimeType || 'image/png' });
        console.log(`[FlowAuto] fetchAssetBlob: ${refId} → ${blob.size} bytes, ${blob.type}`);
        blobCache.set(refId, blob);
        resolve(blob);
      }
    );
  });
}

export async function executeTask(task: TaskItem): Promise<{ downloadedCount: number }> {
  const mediaType = mediaTypeForTask(task);
  const log = (msg: string) => taskLog(task.id, msg);

  log(`开始执行任务`);

  log(`切换到 ${mediaType === 'image' ? '图片' : '视频'} 标签页`);
  await selectTab(mediaType === 'image' ? 'image' : 'video');
  await sleep(300);

  log(`设置生成模式: ${task.mode}`);
  await setMode(task.mode);
  await sleep(200);

  log(`设置画幅 ${task.aspectRatio}, 数量 ${task.outputCount}, 模型 ${task.model}`);
  await setAspectRatio(task.aspectRatio);
  await setOutputCount(task.outputCount);
  await setModel(task.model);
  await sleep(100);

  log(`输入提示词`);
  await setPromptText(task.prompt);
  await sleep(300);

  // Attach reference images.  For images that were already uploaded in this
  // session and have a known media UUID, try the fast path: select from Flow's
  // resource panel by UUID.  For new images, upload via clipboard paste.
  if (task.assets && task.assets.length > 0) {
    const newCount = task.assets.filter(a => !uploadedMediaIds.has(a.filename)).length;
    const reuseCount = task.assets.length - newCount;
    if (reuseCount > 0 && newCount > 0) {
      log(`注入 ${task.assets.length} 张参考图（${reuseCount} 张从面板选择，${newCount} 张新上传）...`);
    } else if (reuseCount > 0) {
      log(`注入 ${task.assets.length} 张参考图（全部从资源面板选择）...`);
    } else {
      log(`注入 ${task.assets.length} 张参考图...`);
    }

    for (const asset of task.assets) {
      try {
        const existingUuid = uploadedMediaIds.get(asset.filename);
        log(`${existingUuid ? '选择' : '获取'}参考图: ${asset.filename}${existingUuid ? ` (UUID=${existingUuid.substring(0, 8)}…)` : ''}`);

        const blob = await fetchAssetBlob(asset.refId);
        const result = await injectImageToFlow(blob, asset.filename, {
          mediaUuid: existingUuid,
        });

        if (result.success) {
          log(`✅ 参考图注入成功: ${asset.filename}`);
          if (result.mediaUuid) {
            uploadedMediaIds.set(asset.filename, result.mediaUuid);
          }
        }
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : String(e);
        log(`❌ 参考图注入失败: ${asset.filename} — ${msg}`);
        throw new Error(`参考图注入失败 (${asset.filename}): ${msg}`);
      }
    }
    await sleep(1000);
  }

  log(`点击创建，等待生成...`);
  const result = await createAndWaitForGeneration({
    expectedCount: task.outputCount,
    timeoutMs: timeoutForTask(task),
  });

  const newCount = result.newCount;
  if (newCount <= 0) {
    throw new Error(`生成失败（无新产出）`);
  }

  log(`生成完成，下载 ${newCount} 个文件...`);
  const projectName = getProjectName() ?? 'Flow';
  const dir = buildProjectDir(projectName);

  await downloadTopNLatestWithNaming(task, newCount, (outputIndex) => {
    const baseCore = buildTaskBaseName(task, outputIndex);
    const idTail = task.id.slice(-6);
    return {
      dir,
      baseName: `${baseCore}__${idTail}`,
      taskId: task.id,
      outputIndex,
    };
  }, result.baselineUrls);

  log(`任务完成`);
  return { downloadedCount: newCount };
}

