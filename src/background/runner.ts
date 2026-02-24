import { MSG } from '../shared/constants';
import type { ExecuteTaskRequest, TaskResultResponse } from '../shared/protocol';
import { sleep } from '../shared/sleep';
import {
  getAppState,
  getNextWaitingTask,
  markTaskError,
  markTaskRunning,
  markTaskSuccess,
  setRunning,
} from './queue-engine';
import { tryInjectContentScripts } from './content-injection';

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]));
  });
}

function sendMessageToTab<TReq, TRes>(tabId: number, message: TReq, timeoutMs: number): Promise<TRes> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message as any, (response) => {
      const err = chrome.runtime.lastError;
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
        return;
      }
      resolve(response as TRes);
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

    const tab = await getActiveTab();
    const url = tab?.url ?? '';
    const isFlowProject = url.startsWith('https://labs.google/') && url.includes('/tools/flow/project/');
    if (!tab?.id || !isFlowProject) {
      await markTaskError(next.id, '未找到可用的 Flow 项目页（请切到 Flow 项目页标签后重试）');
      await setRunning(false);
      return;
    }

    try {
      await tryInjectContentScripts(tab.id);
      const res = await sendMessageToTab<ExecuteTaskRequest, TaskResultResponse>(
        tab.id,
        { type: MSG.EXECUTE_TASK, task: next },
        30 * 60 * 1000
      );

      if (res.ok) {
        await markTaskSuccess(next.id);
      } else {
        await markTaskError(next.id, res.error ?? '执行失败（未知错误）');
      }
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e);
      await markTaskError(next.id, msg);
    }

    // Inter-task delay (also gives UI time to settle).
    await sleep(Math.max(0, settings.interTaskDelayMs));
  }
}

