import { resolveCapabilities } from '../shared/capability-guard';
import {
  DEFAULT_QUEUE_STATE,
  DEFAULT_SETTINGS,
  modeForModel,
  type ParsedPromptItem,
  type QueueState,
  type TaskItem,
  type TaskLogEntry,
  type UserSettings,
} from '../shared/types';
import { storageGet, storageSet } from './storage';

const STORAGE_KEYS = {
  queue: 'flowauto.queueState.v1',
  settings: 'flowauto.settings.v1',
} as const;

let initialized = false;
let queue: QueueState = structuredClone(DEFAULT_QUEUE_STATE);
let settings: UserSettings = structuredClone(DEFAULT_SETTINGS);

function now(): number {
  return Date.now();
}

function makeId(): string {
  // Avoid relying on crypto.randomUUID availability across all extension contexts.
  return `t_${now()}_${Math.random().toString(16).slice(2)}`;
}


async function persist(): Promise<void> {
  await storageSet(STORAGE_KEYS.queue, queue);
  await storageSet(STORAGE_KEYS.settings, settings);
}

export async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const storedQueue = await storageGet<QueueState>(STORAGE_KEYS.queue);
  const storedSettings = await storageGet<UserSettings>(STORAGE_KEYS.settings);

  if (storedQueue && Array.isArray(storedQueue.tasks)) queue = storedQueue;
  if (storedSettings) settings = { ...DEFAULT_SETTINGS, ...storedSettings };
}

export async function getAppState(): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  return { queue, settings };
}

export async function clearQueue(): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = structuredClone(DEFAULT_QUEUE_STATE);
  await persist();
  return { queue, settings };
}

/** Remove only finished tasks (success / error / skipped). Waiting/running tasks are kept. */
export async function clearHistory(): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  const DONE: Set<string> = new Set(['success', 'error', 'skipped']);
  queue = {
    ...queue,
    tasks: queue.tasks.filter((t) => !DONE.has(t.status)),
  };
  await persist();
  return { queue, settings };
}

export async function addPrompts(
  prompts: ParsedPromptItem[],
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();

  const newTasks: TaskItem[] = prompts.map((p) => {
    const model = settings.defaultModel;
    const mode = modeForModel(model);

    const task: TaskItem = {
      id: makeId(),
      filename: p.filename,
      prompt: p.prompt,
      mode,
      model,
      aspectRatio: settings.defaultAspectRatio,
      outputCount: settings.defaultOutputCount,
      status: 'waiting',
      retries: 0,
      maxRetries: 0,  // No auto-retry; user can manually retry via "重试失败项"
      createdAt: now(),
      downloadResolution: settings.defaultDownloadResolution,
      logs: [{ ts: now(), msg: '任务已创建入队' }],
    };

    const cap = resolveCapabilities(task);
    if (!cap.valid) {
      task.status = 'skipped';
      task.errorMessage = cap.reason ?? 'Capability guard rejected';
      task.completedAt = now();
      return task;
    }

    if (cap.corrected) Object.assign(task, cap.corrected);
    return task;
  });

  queue = {
    ...queue,
    tasks: [...queue.tasks, ...newTasks],
  };

  await persist();
  return { queue, settings };
}

export async function setRunning(
  isRunning: boolean
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = { ...queue, isRunning };
  await persist();
  return { queue, settings };
}

export async function removeTask(
  taskId: string
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.filter((t) => t.id !== taskId),
  };
  if (queue.currentTaskId === taskId) {
    queue.currentTaskId = undefined;
    queue.isRunning = false;
  }
  await persist();
  return { queue, settings };
}

export async function skipTask(
  taskId: string,
  reason = 'skipped by user'
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        status: 'skipped',
        errorMessage: t.errorMessage ?? reason,
        completedAt: now(),
      };
    }),
  };
  await persist();
  return { queue, settings };
}

export async function retryErrors(): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.status !== 'error') return t;
      return {
        ...t,
        status: 'waiting',
        errorMessage: undefined,
        startedAt: undefined,
        completedAt: undefined,
      };
    }),
  };
  await persist();
  return { queue, settings };
}

export async function updateSettings(
  patch: Partial<UserSettings>
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  settings = { ...settings, ...patch };
  await persist();
  return { queue, settings };
}

export async function getNextWaitingTask(): Promise<TaskItem | undefined> {
  await ensureInitialized();
  return queue.tasks.find((t) => t.status === 'waiting');
}

export async function markTaskRunning(taskId: string): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    currentTaskId: taskId,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, status: 'running', startedAt: now(), errorMessage: undefined };
    }),
  };
  await persist();
  return { queue, settings };
}

export async function markTaskSuccess(
  taskId: string
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    currentTaskId: undefined,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, status: 'success', completedAt: now() };
    }),
  };
  await persist();
  return { queue, settings };
}

export async function markTaskError(
  taskId: string,
  errorMessage: string
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    currentTaskId: undefined,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const retries = (t.retries ?? 0) + 1;
      const shouldRetry = retries <= (t.maxRetries ?? 0);
      return {
        ...t,
        retries,
        status: shouldRetry ? 'waiting' : 'error',
        errorMessage: shouldRetry ? `(重试 ${retries}/${t.maxRetries}) ${errorMessage}` : errorMessage,
      };
    }),
  };
  await persist();
  return { queue, settings };
}

const MAX_LOGS_PER_TASK = 30;

export async function appendTaskLog(taskId: string, msg: string): Promise<void> {
  await ensureInitialized();
  const entry: TaskLogEntry = { ts: now(), msg };
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const logs = [...(t.logs ?? []), entry].slice(-MAX_LOGS_PER_TASK);
      return { ...t, logs };
    }),
  };
  await persist();
}

