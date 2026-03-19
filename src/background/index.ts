import { MSG } from "../shared/constants";
import type {
  AnyRequest,
  AnyResponse,
  DownloadByUrlRequest,
  ExpectDownloadRequest,
  ExpectDownloadResponse,
  GetImageBlobRequest,
  GetImageBlobResponse,
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
  QueueStopRequest,
  SettingsUpdateRequest,
  ResetExecutionSessionRequest,
  ResetExecutionSessionResponse,
  RefMediaLookupRequest,
  RefMediaLookupResponse,
  RefMediaUpsertRequest,
  RefMediaUpsertResponse,
  TestNotificationRequest,
  TestNotificationResponse,
} from "../shared/protocol";
import { getImageAsBase64 } from "../shared/image-store";
import {
  lookupReferenceMediaUuid,
  upsertReferenceMediaUuid,
} from "../shared/reference-media-store";
import {
  addPrompts,
  appendTaskLog,
  clearHistory,
  clearQueue,
  getAppState,
  removeTask,
  retryErrors,
  setRunning,
  skipTask,
  updateSettings,
} from "./queue-engine";
import { expectDownload, initDownloadManager } from "./download-manager";
import { kickRunner } from "./runner";
import { tryInjectContentScripts } from "./content-injection";
import { sendMessageToTab } from "../shared/messaging";
import { TIMEOUTS } from "../shared/config";
import { logger } from "../shared/logger";
import { sendNotification } from "./notifier";

initDownloadManager();

function initSidePanelBehavior(): void {
  // Chrome side panel behavior is opt-in; without this, clicking the extension action may do nothing.
  try {
    if (!chrome.sidePanel?.setPanelBehavior) return;
    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    }).catch(() => {});

    // Globally disable the side panel so it does NOT follow the user across tabs.
    // We enable it on a per-tab basis when the user clicks the extension action.
    if (chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

initSidePanelBehavior();
chrome.runtime.onInstalled.addListener(() => initSidePanelBehavior());

chrome.action.onClicked.addListener((tab) => {
  try {
    if (!tab.id || !chrome.sidePanel?.open) return;

    // Best-effort: inject our content script even if the tab wasn't refreshed.
    // This avoids the common "未检测到内容脚本（可能未刷新页面）" issue after extension reload.
    void tryInjectContentScripts(tab.id);

    // Enable the side panel ONLY for this specific tab.
    // The global default is disabled, so switching to another tab will hide the panel.
    if (chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: "sidepanel/index.html",
        enabled: true,
      }).catch(() => {});
    }

    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  } catch {
    // ignore
  }
});

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]);
    });
  });
}

async function resetExecutionSessionOnActiveTab(): Promise<void> {
  const tab = await getActiveTab();
  const tabId = tab?.id;
  const url = tab?.url ?? "";
  if (!tabId) return;
  if (!url.startsWith("https://labs.google/")) return;
  if (!url.includes("/tools/flow/project/")) return;

  try {
    await tryInjectContentScripts(tabId);
    const res = await sendMessageToTab<
      ResetExecutionSessionRequest,
      ResetExecutionSessionResponse
    >(
      tabId,
      {
        type: MSG.RESET_EXECUTION_SESSION,
        clearAttachedReferences: true,
      },
      2500,
    );
    if (!res.ok) {
      logger.warn("清空历史后重置执行会话失败（content返回ok=false）");
    }
  } catch (e) {
    logger.warn("清空历史后重置执行会话失败", e);
  }
}

async function handlePing(_req: PingRequest): Promise<PongResponse> {
  const tab = await getActiveTab();
  if (!tab?.id)
    return { type: MSG.PONG, connected: false, reason: "no_active_tab" };

  const url = tab.url ?? "";
  if (!url.startsWith("https://labs.google/")) {
    return {
      type: MSG.PONG,
      connected: false,
      reason: "not_labs",
      tabId: tab.id,
      url,
    };
  }

  try {
    const res = await sendMessageToTab<PingRequest, PongResponse>(tab.id, {
      type: MSG.PING,
    });

    if (!res.isFlowProject) {
      return {
        ...res,
        connected: false,
        reason: "not_flow_project",
        tabId: tab.id,
        url: res.url ?? url,
        title: res.title ?? tab.title,
      };
    }

    return {
      ...res,
      connected: true,
      tabId: tab.id,
      url: res.url ?? url,
      title: res.title ?? tab.title,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("timeout")) {
      return {
        type: MSG.PONG,
        connected: false,
        reason: "timeout",
        tabId: tab.id,
        url,
      };
    }

    // Try to inject content scripts for already-open tabs (common after extension reload).
    const injected = await tryInjectContentScripts(tab.id);
    if (injected) {
      try {
        const res = await sendMessageToTab<PingRequest, PongResponse>(tab.id, {
          type: MSG.PING,
        });
        if (res.isFlowProject) {
          return {
            ...res,
            connected: true,
            tabId: tab.id,
            url: res.url ?? url,
            title: res.title ?? tab.title,
          };
        }
        return {
          ...res,
          connected: false,
          reason: "not_flow_project",
          tabId: tab.id,
          url: res.url ?? url,
          title: res.title ?? tab.title,
        };
      } catch {
        // fall through
      }
    }

    return {
      type: MSG.PONG,
      connected: false,
      reason: "no_content_script",
      tabId: tab.id,
      url,
    };
  }
}

async function handleGetPageState(
  _req: GetPageStateRequest,
): Promise<PageStateResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return {
      type: MSG.PAGE_STATE,
      tabId: -1,
      url: "",
      title: "",
      isLabs: false,
      isFlowProject: false,
    };
  }

  const url = tab.url ?? "";
  const isLabs = url.startsWith("https://labs.google/");

  try {
    const res = await sendMessageToTab<GetPageStateRequest, PageStateResponse>(
      tab.id,
      {
        type: MSG.GET_PAGE_STATE,
      },
    );
    return res;
  } catch {
    // Best-effort inject then retry once.
    const injected = await tryInjectContentScripts(tab.id);
    if (injected) {
      try {
        const res = await sendMessageToTab<
          GetPageStateRequest,
          PageStateResponse
        >(tab.id, {
          type: MSG.GET_PAGE_STATE,
        });
        return res;
      } catch {
        // ignore
      }
    }
    return {
      type: MSG.PAGE_STATE,
      tabId: tab.id,
      url,
      title: tab.title ?? "",
      isLabs,
      isFlowProject: false,
    };
  }
}

async function handleQueueGetState(
  _req: QueueGetStateRequest,
): Promise<QueueStateResponse> {
  const state = await getAppState();
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueAddTasks(
  req: QueueAddTasksRequest,
): Promise<QueueStateResponse> {
  const state = await addPrompts(req.prompts ?? [], req.modeOverride);
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueClear(
  _req: QueueClearRequest,
): Promise<QueueStateResponse> {
  const state = await clearQueue();
  void resetExecutionSessionOnActiveTab();
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueClearHistory(
  _req: QueueClearHistoryRequest,
): Promise<QueueStateResponse> {
  const state = await clearHistory();
  void resetExecutionSessionOnActiveTab();
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueStart(
  _req: QueueStartRequest,
): Promise<QueueStateResponse> {
  const state = await setRunning(true);
  // Fire-and-forget runner (state is persisted; UI polls).
  kickRunner();
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueuePause(
  _req: QueuePauseRequest,
): Promise<QueueStateResponse> {
  const state = await setRunning(false);
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueStop(
  _req: QueueStopRequest,
): Promise<QueueStateResponse> {
  // Stop == Pause for now (execution engine lands in later milestones).
  const state = await setRunning(false);
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueRemoveTask(
  req: QueueRemoveTaskRequest,
): Promise<QueueStateResponse> {
  const state = await removeTask(req.taskId);
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueSkipTask(
  req: QueueSkipTaskRequest,
): Promise<QueueStateResponse> {
  const state = await skipTask(req.taskId);
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleQueueRetryErrors(
  _req: QueueRetryErrorsRequest,
): Promise<QueueStateResponse> {
  const state = await retryErrors();
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleSettingsUpdate(
  req: SettingsUpdateRequest,
): Promise<QueueStateResponse> {
  const state = await updateSettings(req.patch ?? {});
  return { type: MSG.QUEUE_STATE, ...state };
}

async function handleExpectDownload(
  req: ExpectDownloadRequest,
): Promise<ExpectDownloadResponse> {
  expectDownload({
    dir: req.dir,
    baseName: req.baseName,
    taskId: req.taskId,
    outputIndex: req.outputIndex,
  });
  return { ok: true };
}

function waitForDownloadComplete(
  downloadId: number,
  timeoutMs = TIMEOUTS.DOWNLOAD_COMPLETE,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      chrome.downloads.search({ id: downloadId }, (results) => {
        if (!results?.length) {
          resolve(false);
          return;
        }
        const state = results[0].state;
        if (state === "complete") {
          resolve(true);
          return;
        }
        if (state === "interrupted") {
          resolve(false);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(poll, 1000);
      });
    };
    poll();
  });
}

async function handleDownloadByUrl(
  req: DownloadByUrlRequest,
): Promise<{ ok: boolean }> {
  try {
    expectDownload({
      dir: req.dir,
      baseName: req.baseName,
      taskId: "",
      outputIndex: 0,
    });

    const downloadId = await new Promise<number>((resolve, reject) => {
      chrome.downloads.download(
        { url: req.url, conflictAction: "uniquify" },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) {
            reject(
              new Error(chrome.runtime.lastError?.message ?? "download failed"),
            );
          } else {
            resolve(id);
          }
        },
      );
    });

    const completed = await waitForDownloadComplete(downloadId);
    return { ok: completed };
  } catch {
    return { ok: false };
  }
}

async function handleGetImageBlob(
  req: GetImageBlobRequest,
): Promise<GetImageBlobResponse> {
  const result = await getImageAsBase64(req.refId);
  if (!result) return { type: MSG.GET_IMAGE_BLOB, found: false };
  return {
    type: MSG.GET_IMAGE_BLOB,
    found: true,
    data: result.data,
    mimeType: result.type,
  };
}

async function handleRefMediaLookup(
  req: RefMediaLookupRequest,
): Promise<RefMediaLookupResponse> {
  const uuid = await lookupReferenceMediaUuid(req.projectId, req.assetHash);
  if (!uuid) {
    return { type: MSG.REF_MEDIA_LOOKUP, found: false };
  }
  return { type: MSG.REF_MEDIA_LOOKUP, found: true, mediaUuid: uuid };
}

async function handleRefMediaUpsert(
  req: RefMediaUpsertRequest,
): Promise<RefMediaUpsertResponse> {
  await upsertReferenceMediaUuid({
    projectId: req.projectId,
    assetHash: req.assetHash,
    mediaUuid: req.mediaUuid,
    filename: req.filename,
  });
  return { type: MSG.REF_MEDIA_UPSERT, ok: true };
}

async function handleTestNotification(
  req: TestNotificationRequest,
): Promise<TestNotificationResponse> {
  try {
    await sendNotification(req.settings, '\u{1F514} FlowAuto 测试通知 - 配置成功！');
    return { type: MSG.TEST_NOTIFICATION, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { type: MSG.TEST_NOTIFICATION, ok: false, error: msg };
  }
}

async function makeErrorResponse(
  message: AnyRequest,
): Promise<AnyResponse | undefined> {
  if (message.type === MSG.EXPECT_DOWNLOAD) return { ok: true };
  if (message.type === MSG.DOWNLOAD_BY_URL) return { ok: false };
  if (message.type === MSG.REF_MEDIA_LOOKUP)
    return { type: MSG.REF_MEDIA_LOOKUP, found: false };
  if (message.type === MSG.REF_MEDIA_UPSERT)
    return { type: MSG.REF_MEDIA_UPSERT, ok: false };
  if (message.type === MSG.PING) {
    return {
      type: MSG.PONG,
      connected: false,
      reason: "unknown",
    } satisfies PongResponse;
  }
  if (message.type === MSG.GET_PAGE_STATE) {
    return {
      type: MSG.PAGE_STATE,
      tabId: -1,
      url: "",
      title: "",
      isLabs: false,
      isFlowProject: false,
    } satisfies PageStateResponse;
  }

  // Default fallback: return last known queue state so the UI doesn't crash.
  const state = await getAppState();
  return { type: MSG.QUEUE_STATE, ...state } satisfies QueueStateResponse;
}

chrome.runtime.onMessage.addListener(
  (message: AnyRequest, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;

    (async () => {
      try {
        if (message.type === MSG.PING)
          return handlePing(message as PingRequest);
        if (message.type === MSG.GET_PAGE_STATE)
          return handleGetPageState(message as GetPageStateRequest);
        if (message.type === MSG.QUEUE_GET_STATE)
          return handleQueueGetState(message as QueueGetStateRequest);
        if (message.type === MSG.QUEUE_ADD_TASKS)
          return handleQueueAddTasks(message as QueueAddTasksRequest);
        if (message.type === MSG.QUEUE_CLEAR)
          return handleQueueClear(message as QueueClearRequest);
        if (message.type === MSG.QUEUE_CLEAR_HISTORY)
          return handleQueueClearHistory(message as QueueClearHistoryRequest);
        if (message.type === MSG.QUEUE_REMOVE_TASK)
          return handleQueueRemoveTask(message as QueueRemoveTaskRequest);
        if (message.type === MSG.QUEUE_SKIP_TASK)
          return handleQueueSkipTask(message as QueueSkipTaskRequest);
        if (message.type === MSG.QUEUE_RETRY_ERRORS)
          return handleQueueRetryErrors(message as QueueRetryErrorsRequest);
        if (message.type === MSG.QUEUE_START)
          return handleQueueStart(message as QueueStartRequest);
        if (message.type === MSG.QUEUE_PAUSE)
          return handleQueuePause(message as QueuePauseRequest);
        if (message.type === MSG.QUEUE_STOP)
          return handleQueueStop(message as QueueStopRequest);
        if (message.type === MSG.SETTINGS_UPDATE)
          return handleSettingsUpdate(message as SettingsUpdateRequest);
        if (message.type === MSG.TASK_LOG) {
          const m = message as import("../shared/protocol").TaskLogMessage;
          void appendTaskLog(m.taskId, m.msg);
          // Ack immediately (fire-and-forget). If we return undefined while the listener
          // returns true, the sender will see "message channel closed" errors.
          return { ok: true };
        }
        if (message.type === MSG.REF_MEDIA_LOOKUP)
          return handleRefMediaLookup(message as RefMediaLookupRequest);
        if (message.type === MSG.REF_MEDIA_UPSERT)
          return handleRefMediaUpsert(message as RefMediaUpsertRequest);
        if (message.type === MSG.EXPECT_DOWNLOAD)
          return handleExpectDownload(message as ExpectDownloadRequest);
        if (message.type === MSG.DOWNLOAD_BY_URL)
          return handleDownloadByUrl(message as DownloadByUrlRequest);
        if (message.type === MSG.GET_IMAGE_BLOB)
          return handleGetImageBlob(message as GetImageBlobRequest);
        if (message.type === MSG.TEST_NOTIFICATION)
          return handleTestNotification(message as TestNotificationRequest);
        return undefined;
      } catch {
        return await makeErrorResponse(message);
      }
    })().then((res) => {
      if (res) sendResponse(res);
    });

    // Keep service worker alive for async response.
    return true;
  },
);
