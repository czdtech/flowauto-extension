import { MSG } from '../shared/constants';
import type { ExecuteTaskRequest, TaskResultResponse } from '../shared/protocol';
import { sleep } from '../shared/sleep';
import { errorMsg } from '../shared/logger';
import {
  getAppState,
  getNextWaitingTask,
  markTaskError,
  markTaskRunning,
  markTaskSuccess,
  setRunning,
} from './queue-engine';
import { tryInjectContentScripts } from './content-injection';
import { sendMessageToTab } from '../shared/messaging';
import { TIMEOUTS } from '../shared/config';
import {
  trySendNotification,
  formatQueueCompleteMessage,
  formatTaskErrorMessage,
} from './notifier';

/** Check whether a tab URL points to a Flow project. */
function isFlowProjectUrl(url: string): boolean {
  return url.startsWith('https://labs.google/') && url.includes('/tools/flow/project/');
}

/** Try to get a valid Flow project tab. Priority:
 *  1. The previously-locked tab (if still alive & on a Flow project page).
 *  2. The current active tab (if it's a Flow project page).
 *  3. Any tab that is on a Flow project page.
 */
async function resolveFlowTab(lockedTabId?: number): Promise<chrome.tabs.Tab | undefined> {
  // 1. Check locked tab first.
  if (lockedTabId !== undefined) {
    const tab = await getTabById(lockedTabId);
    if (tab && isFlowProjectUrl(tab.url ?? '')) return tab;
  }

  // 2. Check active tab.
  const active = await getActiveTab();
  if (active?.id && isFlowProjectUrl(active.url ?? '')) return active;

  // 3. Scan all tabs for a Flow project page.
  const allTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(tabs ?? []));
  });
  return allTabs.find((t) => t.id !== undefined && isFlowProjectUrl(t.url ?? ''));
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]));
  });
}

function getTabById(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
      } else {
        resolve(tab);
      }
    });
  });
}

let loopActive = false;

export function kickRunner(): void {
  if (loopActive) return;
  loopActive = true;
  void runLoop().finally(() => {
    loopActive = false;
  });
}

async function runLoop(): Promise<void> {
  // Single-worker sequential runner. Persisted state lives in queue-engine.
  // This runner can be restarted by calling kickRunner again.
  // NOTE: MV3 service workers can be suspended; we keep it simple for now.

  // Resolve the Flow project tab ONCE at the start and lock onto it.
  // This allows the user to switch to other tabs without breaking execution.
  let lockedTabId: number | undefined;

  const startedAt = Date.now();
  let successCount = 0;
  let errorCount = 0;
  let projectName = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { queue, settings } = await getAppState();
    if (!queue.isRunning) break;

    // Capture project name from queue state (may be set by user).
    if (queue.projectName) projectName = queue.projectName;

    const next = await getNextWaitingTask();
    if (!next) {
      await setRunning(false);
      break;
    }

    await markTaskRunning(next.id);

    // Re-verify the locked tab before each task (it may have been closed or navigated away).
    const tab = await resolveFlowTab(lockedTabId);
    if (!tab?.id) {
      const tabError = '未找到可用的 Flow 项目页（请切到 Flow 项目页标签后重试）';
      await markTaskError(next.id, tabError);
      errorCount++;
      await setRunning(false);
      break;
    }

    // Lock onto this tab for all subsequent tasks in this loop.
    lockedTabId = tab.id;

    let taskFailed = false;
    let taskErrorMsg = '';

    try {
      await tryInjectContentScripts(tab.id);
      const res = await sendMessageToTab<ExecuteTaskRequest, TaskResultResponse>(
        tab.id,
        { type: MSG.EXECUTE_TASK, task: next },
        TIMEOUTS.TASK_EXECUTION
      );

      if (res.ok) {
        await markTaskSuccess(next.id);
        successCount++;
      } else {
        taskErrorMsg = res.error ?? '执行失败（未知错误）';
        await markTaskError(next.id, taskErrorMsg);
        errorCount++;
        taskFailed = true;
      }
    } catch (e: unknown) {
      taskErrorMsg = errorMsg(e);
      await markTaskError(next.id, taskErrorMsg);
      errorCount++;
      taskFailed = true;
    }

    // Immediate error notification
    if (taskFailed && settings.notificationSettings?.notifyOnError) {
      const msg = formatTaskErrorMessage(next.prompt, taskErrorMsg);
      void trySendNotification(settings.notificationSettings, msg);
    }

    // Inter-task delay (also gives UI time to settle).
    await sleep(Math.max(0, settings.interTaskDelayMs));
  }

  // Queue completion notification
  const elapsed = Date.now() - startedAt;
  const totalProcessed = successCount + errorCount;
  if (totalProcessed > 0) {
    const { settings } = await getAppState();
    if (settings.notificationSettings?.notifyOnComplete) {
      const msg = formatQueueCompleteMessage(projectName, successCount, errorCount, elapsed);
      void trySendNotification(settings.notificationSettings, msg);
    }
  }
}
