import { MSG } from "../../shared/constants";
import { TIMING, TIMEOUTS, LIMITS } from "../../shared/config";
import { taskLog, logger, errorMsg } from "../../shared/logger";
import type {
  RefMediaLookupRequest,
  RefMediaLookupResponse,
  RefMediaUpsertRequest,
  RefMediaUpsertResponse,
} from "../../shared/protocol";
import type { TaskItem } from "../../shared/types";
import {
  buildProjectDir,
  buildTaskBaseName,
} from "../../shared/filename-utils";
import { downloadTopNLatestWithNaming } from "./download";
import {
  collectResultImageSrcs,
  createAndWaitForGeneration,
} from "./generate";
import { clearAttachedReferences, injectImageToFlow } from "./inject-image";
import { setPromptText } from "./prompt";
import { setAspectRatio, setMode, setModel, setOutputCount } from "./settings";
import { getProjectName } from "../page-state";
import { randomSleep } from "../utils/dom";
import { selectTab } from "./navigate";
import { findPromptInput } from "../finders";

// In-memory blob cache keyed by refId.  Avoids repeated IndexedDB + base64
// round-trips when the same image (same refId) is needed across tasks.
const blobCache = new Map<string, Blob>();
const assetHashCache = new Map<string, string>();

// Maps assetHash → Flow media UUID for this content-script session.
// Compared with filename mapping, hash mapping avoids collisions when users
// reuse the same filename for different image contents.
//
// After a successful upload, Flow assigns
// a UUID to the image (visible in media.getMediaUrlRedirect?name=UUID URLs).
// Subsequent tasks can reuse the image by selecting it from the resource panel
// via this UUID instead of re-uploading.
const uploadedMediaByHash = new Map<string, string>();

function mediaTypeForTask(task: TaskItem): "image" | "video" {
  return task.mode === "create-image" ? "image" : "video";
}

function timeoutForTask(task: TaskItem): number {
  return task.mode === "create-image" ? TIMEOUTS.GENERATION_IMAGE : TIMEOUTS.GENERATION_VIDEO;
}

/**
 * Fetch an image blob from IndexedDB via the background service worker.
 * The background returns base64-encoded data (ArrayBuffer cannot survive
 * chrome.runtime.sendMessage serialization).
 */
async function fetchAssetBlob(refId: string): Promise<Blob> {
  const cached = blobCache.get(refId);
  if (cached) {
    logger.info(
      `fetchAssetBlob: ${refId} → ${cached.size} bytes (内存缓存)`,
    );
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
        const blob = new Blob([bytes], {
          type: response.mimeType || "image/png",
        });
        logger.info(
          `fetchAssetBlob: ${refId} → ${blob.size} bytes, ${blob.type}`,
        );
        blobCache.set(refId, blob);
        resolve(blob);
      },
    );
  });
}

function getCurrentProjectId(): string | null {
  const m = location.pathname.match(
    /\/tools\/flow\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m?.[1] ?? null;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hash);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function getAssetHash(refId: string, blob: Blob): Promise<string> {
  const cached = assetHashCache.get(refId);
  if (cached) return cached;
  const hash = await sha256Hex(blob);
  assetHashCache.set(refId, hash);
  return hash;
}

async function lookupPersistedMediaUuid(
  projectId: string | null,
  assetHash: string,
): Promise<string | undefined> {
  if (!projectId) return undefined;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: MSG.REF_MEDIA_LOOKUP,
        projectId,
        assetHash,
      } satisfies RefMediaLookupRequest,
      (res: RefMediaLookupResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        if (res?.found && res.mediaUuid) {
          resolve(res.mediaUuid);
          return;
        }
        resolve(undefined);
      },
    );
  });
}

async function upsertPersistedMediaUuid(input: {
  projectId: string | null;
  assetHash: string;
  mediaUuid: string;
  filename?: string;
}): Promise<void> {
  const projectId = input.projectId;
  if (!projectId) return;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: MSG.REF_MEDIA_UPSERT,
        projectId,
        assetHash: input.assetHash,
        mediaUuid: input.mediaUuid,
        filename: input.filename,
      } satisfies RefMediaUpsertRequest,
      (_res: RefMediaUpsertResponse | undefined) => {
        // Best-effort: lookup cache miss should never break task execution.
        resolve();
      },
    );
  });
}

function assertStillOnProject(): void {
  const url = location.href;
  if (url.includes("/edit/") && url.includes("/tools/flow/project/")) {
    const parts = url.split("/");
    const editIdx = parts.indexOf("edit");
    if (editIdx > 0 && parts[editIdx - 1] !== "project") {
      throw new Error(
        `页面已导航到图片编辑界面 (${url})，中止任务以避免误操作`,
      );
    }
  }
}

/**
 * Reset in-page execution session cache.
 * Used by "clear history/queue" so a new run starts from a clean state.
 */
export async function resetExecutionSession(options?: {
  clearAttachedReferences?: boolean;
}): Promise<void> {
  blobCache.clear();
  assetHashCache.clear();
  uploadedMediaByHash.clear();
  logger.info(
    "会话缓存已重置（blobCache / assetHashCache / uploadedMediaByHash）",
  );
  if (options?.clearAttachedReferences !== false) {
    await clearAttachedReferences();
    logger.info("已清理提示词区域参考图");
  }
}

export async function executeTask(
  task: TaskItem,
): Promise<{ downloadedCount: number }> {
  const mediaType = mediaTypeForTask(task);
  const log = (msg: string) => taskLog(task.id, msg);

  log("开始执行任务");

  // Keep prompt area clean between tasks.
  await clearAttachedReferences();
  await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);

  await selectTab(mediaType === "image" ? "image" : "video");
  await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);

  await setMode(task.mode);
  await randomSleep(TIMING.SHORT_MIN, TIMING.MEDIUM_MIN);

  await setAspectRatio(task.aspectRatio);
  await setOutputCount(task.outputCount);
  await setModel(task.model);
  await randomSleep(TIMING.SHORT_MIN, TIMING.SHORT_MAX);

  log(`参数已就绪：${task.model} · ${task.aspectRatio} · x${task.outputCount}`);
  await setPromptText(task.prompt);
  await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);
  log("提示词已填写");

  // Attach reference images.  For images that were already uploaded in this
  // session and have a known media UUID, try the fast path: select from Flow's
  // resource panel by UUID.  For new images, upload via clipboard paste.
  if (task.assets && task.assets.length > 0) {
    const projectId = getCurrentProjectId();
    log(`参考图处理中：${task.assets.length} 张`);

    let attachedCount = 0;
    let reusedCount = 0;
    let uploadedCount = 0;
    for (let i = 0; i < task.assets.length; i++) {
      const asset = task.assets[i];
      try {
        assertStillOnProject();

        const blob = await fetchAssetBlob(asset.refId);
        const assetHash = await getAssetHash(asset.refId, blob);
        const persistedUuid = await lookupPersistedMediaUuid(
          projectId,
          assetHash,
        );
        const sessionUuid = uploadedMediaByHash.get(assetHash);
        const existingUuid = persistedUuid ?? sessionUuid;

        logger.debug(
          `参考图 ${i + 1}/${task.assets.length}: ${asset.filename}${existingUuid ? `（复用UUID=${existingUuid.substring(0, 8)}…）` : "（上传）"} hash=${assetHash.slice(0, 10)}…`,
        );

        const result = await injectImageToFlow(blob, asset.filename, {
          mediaUuid: existingUuid,
        });

        // Check for unintended navigation after each injection attempt.
        assertStillOnProject();

        if (result.success) {
          attachedCount++;
          if (result.mediaUuid) {
            uploadedMediaByHash.set(assetHash, result.mediaUuid);
            void upsertPersistedMediaUuid({
              projectId,
              assetHash,
              mediaUuid: result.mediaUuid,
              filename: asset.filename,
            });
          }

          if (
            existingUuid &&
            result.mediaUuid &&
            existingUuid === result.mediaUuid
          ) {
            reusedCount++;
          } else {
            uploadedCount++;
          }
        }
      } catch (e: unknown) {
        const msg = errorMsg(e);
        logger.debug(`参考图失败: ${asset.filename} — ${msg}`);
        log(`参考图处理失败：${asset.filename}`);
        throw new Error(`参考图注入失败 (${asset.filename}): ${msg}`);
      }

      // Allow Flow's UI to fully settle between sequential injections.
      // Without this, a rapid second paste can displace the first attachment.
      if (i < task.assets.length - 1) {
        await randomSleep(TIMING.BETWEEN_ASSETS_MIN, TIMING.BETWEEN_ASSETS_MAX);
      }
    }

    log(
      `参考图已就绪：${attachedCount}/${task.assets.length}（复用 ${reusedCount}，上传 ${uploadedCount}）`,
    );
    await randomSleep(TIMING.LONG_MIN, TIMING.LONG_MAX);
  }

  const projectName = getProjectName() ?? "Flow";
  const dir = buildProjectDir(projectName);

  let downloadedTotal = 0;
  let remaining = task.outputCount;
  let attempt = 0;
  // Preserve the baseline from the first generation round so retries can
  // detect images that loaded late (after the first round's Signal C).
  let originalBaseline: Set<string> | null = null;

  while (remaining > 0 && attempt < LIMITS.MAX_GENERATION_ATTEMPTS) {
    attempt++;
    log(
      attempt === 1
        ? "开始生成"
        : `开始重试生成（第 ${attempt}/${LIMITS.MAX_GENERATION_ATTEMPTS} 次）`,
    );

    // Before retrying, check if late-arriving images already cover the gap.
    if (attempt > 1 && originalBaseline) {
      const currentUrls = collectResultImageSrcs();
      let totalNewSinceOriginal = 0;
      for (const u of currentUrls) {
        if (!originalBaseline.has(u)) totalNewSinceOriginal++;
      }
      if (totalNewSinceOriginal >= task.outputCount) {
        const lateArrivals = totalNewSinceOriginal - downloadedTotal;
        logger.debug(
          `重试前检查: 原始基线后已有 ${totalNewSinceOriginal} 张新图（已下载 ${downloadedTotal}），无需再生成`,
        );
        if (lateArrivals > 0) {
          const toDownload = Math.min(lateArrivals, remaining);
          log(`发现 ${lateArrivals} 张迟到的图片，直接下载`);
          await downloadTopNLatestWithNaming(
            task,
            toDownload,
            (outputIndex) => {
              const finalIndex = downloadedTotal + outputIndex;
              const baseCore = buildTaskBaseName(task, finalIndex);
              const idTail = task.id.slice(-6);
              return {
                dir,
                baseName: `${baseCore}__${idTail}`,
                taskId: task.id,
                outputIndex: finalIndex,
              };
            },
            originalBaseline,
          );
          downloadedTotal += toDownload;
          remaining = Math.max(0, task.outputCount - downloadedTotal);
        }
        break;
      }
    }

    if (attempt > 1) {
      try {
        const input = findPromptInput();
        input.focus();
        if (
          input instanceof HTMLTextAreaElement ||
          input instanceof HTMLInputElement
        ) {
          input.value += " ";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false); // move to end
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("insertText", false, " ");
          }
        }
        await randomSleep(TIMING.UI_SETTLE_MIN, TIMING.UI_SETTLE_MAX);
      } catch (e) {
        logger.warn("重试前唤醒输入框失败:", e);
      }
      await randomSleep(TIMING.SHORT_MIN, TIMING.SHORT_MAX);
    }

    let round: { newCount: number; baselineUrls: Set<string> };
    try {
      round = await createAndWaitForGeneration({
        expectedCount: remaining,
        timeoutMs: timeoutForTask(task),
      });
    } catch (e: unknown) {
      const msg = errorMsg(e);
      logger.warn(`生成异常(第${attempt}次): ${msg}`);
      if (attempt < LIMITS.MAX_GENERATION_ATTEMPTS) {
        log(`生成异常，准备重试（还差 ${remaining}）`);
        await randomSleep(TIMING.RETRY_PAUSE_MIN, TIMING.RETRY_PAUSE_MAX);
        continue;
      }
      throw new Error(`生成失败: ${msg}`);
    }

    if (attempt === 1) {
      originalBaseline = round.baselineUrls;
    }

    const produced = round.newCount;
    if (produced <= 0) {
      if (attempt < LIMITS.MAX_GENERATION_ATTEMPTS) {
        log(`本轮未产出结果，准备重试（还差 ${remaining}）`);
        await randomSleep(TIMING.RETRY_PAUSE_MIN, TIMING.RETRY_PAUSE_MAX);
        continue;
      }
      throw new Error("生成失败（无新产出）");
    }

    const roundCount = Math.min(produced, remaining);
    log(
      `生成完成：${roundCount} 个结果（累计 ${downloadedTotal + roundCount}/${task.outputCount}）`,
    );

    log("开始下载");
    await downloadTopNLatestWithNaming(
      task,
      roundCount,
      (outputIndex) => {
        const finalIndex = downloadedTotal + outputIndex;
        const baseCore = buildTaskBaseName(task, finalIndex);
        const idTail = task.id.slice(-6);
        return {
          dir,
          baseName: `${baseCore}__${idTail}`,
          taskId: task.id,
          outputIndex: finalIndex,
        };
      },
      round.baselineUrls,
    );

    downloadedTotal += roundCount;
    remaining = Math.max(0, task.outputCount - downloadedTotal);

    if (remaining > 0 && attempt < LIMITS.MAX_GENERATION_ATTEMPTS) {
      log(`结果不足，自动补生成（剩余 ${remaining}）`);
      await randomSleep(TIMING.RETRY_PAUSE_MIN, TIMING.RETRY_PAUSE_MAX);
    }
  }

  if (remaining > 0) {
    throw new Error(
      `生成结果不足：期望 ${task.outputCount}，实际 ${downloadedTotal}（已达到最大重试次数）`,
    );
  }

  log(`下载完成：${downloadedTotal} 个文件`);
  log("任务完成");
  return { downloadedCount: downloadedTotal };
}
