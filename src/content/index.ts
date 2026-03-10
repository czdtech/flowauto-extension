import { MSG } from "../shared/constants";
import type {
  AnyRequest,
  ExecuteTaskRequest,
  PageStateResponse,
  PongResponse,
  ResetExecutionSessionRequest,
  ResetExecutionSessionResponse,
  TaskResultResponse,
} from "../shared/protocol";
import { executeTask, resetExecutionSession } from "./actions/execute-task";
import { getActiveTopTab } from "./actions/navigate";

// Minimal debug signal to confirm injection on the page.
console.debug("[FlowAuto] content script loaded:", location.href);

function isLabs(): boolean {
  return location.hostname === "labs.google";
}

function isFlowProject(): boolean {
  // Example: https://labs.google/fx/zh/tools/flow/project/{uuid}
  return location.pathname.includes("/tools/flow/project/");
}

function makePong(): PongResponse {
  return {
    type: MSG.PONG,
    connected: true,
    url: location.href,
    title: document.title,
    isFlowProject: isFlowProject(),
  };
}

function makePageState(tabId: number): PageStateResponse {
  const activeTopTab = isFlowProject() ? getActiveTopTab() : null;
  return {
    type: MSG.PAGE_STATE,
    tabId,
    url: location.href,
    title: document.title,
    isLabs: isLabs(),
    isFlowProject: isFlowProject(),
    activeTopTab: activeTopTab ?? undefined,
  };
}

chrome.runtime.onMessage.addListener(
  (message: AnyRequest, sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;

    if (message.type === MSG.PING) {
      sendResponse(makePong() satisfies PongResponse);
      return;
    }

    if (message.type === MSG.GET_PAGE_STATE) {
      const tabId = sender.tab?.id ?? -1;
      sendResponse(makePageState(tabId) satisfies PageStateResponse);
      return;
    }

    if (message.type === MSG.EXECUTE_TASK) {
      const req = message as ExecuteTaskRequest;
      console.log(`[FlowAuto] 收到任务执行指令:`, req.task);
      executeTask(req.task)
        .then((result) => {
          console.log(`[FlowAuto] 任务执行成功:`, result);
          sendResponse({
            type: MSG.TASK_RESULT,
            taskId: req.task.id,
            ok: true,
            downloadedCount: result.downloadedCount,
          } satisfies TaskResultResponse);
        })
        .catch((err) => {
          console.error(`[FlowAuto] 任务执行失败:`, err);
          sendResponse({
            type: MSG.TASK_RESULT,
            taskId: req.task.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies TaskResultResponse);
        });
      return true; // Keep message channel open for async response
    }

    if (message.type === MSG.RESET_EXECUTION_SESSION) {
      const req = message as ResetExecutionSessionRequest;
      resetExecutionSession({
        clearAttachedReferences: req.clearAttachedReferences !== false,
      })
        .then(() => {
          sendResponse({
            type: MSG.RESET_EXECUTION_SESSION,
            ok: true,
          } satisfies ResetExecutionSessionResponse);
        })
        .catch((err) => {
          console.warn("[FlowAuto] 重置执行会话失败:", err);
          sendResponse({
            type: MSG.RESET_EXECUTION_SESSION,
            ok: false,
          } satisfies ResetExecutionSessionResponse);
        });
      return true;
    }
  },
);
