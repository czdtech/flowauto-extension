import { MSG } from '../shared/constants';
import type { ExecuteTaskRequest, TaskResultResponse } from '../shared/protocol';
import { sleep } from '../shared/sleep';
import { errorMsg, logger } from '../shared/logger';
import {
  getAppState,
  getNextWaitingTask,
  markTaskError,
  markTaskRunning,
  markTaskSuccess,
  setChainRef,
  setRunning,
} from './queue-engine';
import { tryInjectContentScripts } from './content-injection';
import { sendMessageToTab } from '../shared/messaging';
import { TIMEOUTS, STEALTH } from '../shared/config';

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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { queue, settings } = await getAppState();
    if (!queue.isRunning) return;

    const next = await getNextWaitingTask();
    if (!next) {
      await setRunning(false);
      return;
    }

    await markTaskRunning(next.id);

    // Re-verify the locked tab before each task (it may have been closed or navigated away).
    const tab = await resolveFlowTab(lockedTabId);
    if (!tab?.id) {
      await markTaskError(next.id, '未找到可用的 Flow 项目页（请切到 Flow 项目页标签后重试）');
      await setRunning(false);
      return;
    }

    // Lock onto this tab for all subsequent tasks in this loop.
    lockedTabId = tab.id;

    try {
      await tryInjectContentScripts(tab.id);
      const res = await sendMessageToTab<ExecuteTaskRequest, TaskResultResponse>(
        tab.id,
        {
          type: MSG.EXECUTE_TASK,
          task: next,
          stealthMode: settings.stealthMode,
          chainMode: settings.chainMode,
        },
        TIMEOUTS.TASK_EXECUTION
      );

      if (res.ok) {
        await markTaskSuccess(next.id);

        // Chain propagation: pass captured ref to the next waiting task.
        if (settings.chainMode && res.chainCapturedRefId) {
          const nextTask = await getNextWaitingTask();
          if (nextTask) {
            await setChainRef(nextTask.id, res.chainCapturedRefId);
            logger.info(`Chain: propagated ${res.chainCapturedRefId} → task ${nextTask.id.slice(-6)}`);
          }
        } else if (settings.chainMode && !res.chainCapturedRefId) {
          logger.warn('Chain: failed to capture result, next task will run without chain reference');
        }
      } else {
        await markTaskError(next.id, res.error ?? '执行失败（未知错误）');
      }
    } catch (e: unknown) {
      const msg = errorMsg(e);
      await markTaskError(next.id, msg);
    }

    // Inter-task delay with optional stealth multiplier.
    const baseDelay = Math.max(0, settings.interTaskDelayMs);
    const delay = settings.stealthMode
      ? baseDelay * (STEALTH.MULTIPLIER_MIN + Math.random() * (STEALTH.MULTIPLIER_MAX - STEALTH.MULTIPLIER_MIN))
      : baseDelay;
    await sleep(delay);
  }
}


