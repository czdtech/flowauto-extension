import { resolveCapabilities } from "../shared/capability-guard";
import { LIMITS, STORAGE_KEYS, STORAGE_QUOTA_BYTES, STORAGE_QUOTA_WARN_RATIO } from "../shared/config";
import { logger } from "../shared/logger";
import {
  DEFAULT_QUEUE_STATE,
  DEFAULT_SETTINGS,
  modeForModel,
  type ParsedPromptItem,
  type Project,
  type QueueState,
  type TaskItem,
  type TaskLogEntry,
  type UserSettings,
} from "../shared/types";
import { storageGet, storageSet, storageRemove } from "./storage";
import { deleteImageBlobs } from "../shared/image-store";

// ── Helpers ──

function collectAssetRefIds(tasks: TaskItem[]): string[] {
  const ids: string[] = [];
  for (const t of tasks) {
    if (t.assets) {
      for (const a of t.assets) ids.push(a.refId);
    }
  }
  return ids;
}

function now(): number {
  return Date.now();
}

function makeId(prefix = "t"): string {
  return `${prefix}_${now()}_${Math.random().toString(16).slice(2)}`;
}

// ── Module state ──

let initPromise: Promise<void> | null = null;
let projects: Project[] = [];
let activeProjectId = "";
let queue: QueueState = structuredClone(DEFAULT_QUEUE_STATE);
let settings: UserSettings = structuredClone(DEFAULT_SETTINGS);

// ── Storage helpers (project-scoped) ──

async function persistQueue(): Promise<void> {
  await storageSet(STORAGE_KEYS.projectQueue(activeProjectId), queue);
}

async function persistSettings(): Promise<void> {
  await storageSet(STORAGE_KEYS.projectSettings(activeProjectId), settings);
}

async function persist(): Promise<void> {
  await persistQueue();
  await persistSettings();
}

async function persistProjects(): Promise<void> {
  await storageSet(STORAGE_KEYS.PROJECTS_LIST, projects);
}

async function persistActiveProject(): Promise<void> {
  await storageSet(STORAGE_KEYS.ACTIVE_PROJECT, activeProjectId);
}

async function loadProjectData(projectId: string): Promise<{
  queue: QueueState;
  settings: UserSettings;
}> {
  const storedQueue = await storageGet<QueueState>(
    STORAGE_KEYS.projectQueue(projectId),
  );
  const storedSettings = await storageGet<UserSettings>(
    STORAGE_KEYS.projectSettings(projectId),
  );

  const q =
    storedQueue && Array.isArray(storedQueue.tasks)
      ? storedQueue
      : structuredClone(DEFAULT_QUEUE_STATE);
  const s = storedSettings
    ? { ...DEFAULT_SETTINGS, ...storedSettings }
    : structuredClone(DEFAULT_SETTINGS);

  return { queue: q, settings: s };
}

// ── Migration ──

async function migrateFromLegacyKeys(): Promise<boolean> {
  const legacyQueue = await storageGet<QueueState>(STORAGE_KEYS.LEGACY_QUEUE);
  const legacySettings = await storageGet<UserSettings>(
    STORAGE_KEYS.LEGACY_SETTINGS,
  );

  if (!legacyQueue && !legacySettings) return false;

  const projectName =
    legacyQueue?.projectName || "默认项目";

  const projectId = makeId("proj");
  const project: Project = {
    id: projectId,
    name: projectName,
    createdAt: now(),
  };

  projects = [project];
  activeProjectId = projectId;

  queue = legacyQueue && Array.isArray(legacyQueue.tasks)
    ? legacyQueue
    : structuredClone(DEFAULT_QUEUE_STATE);
  settings = legacySettings
    ? { ...DEFAULT_SETTINGS, ...legacySettings }
    : structuredClone(DEFAULT_SETTINGS);

  // Write new project-scoped keys
  await persistProjects();
  await persistActiveProject();
  await persist();

  // Delete old keys
  await storageRemove(STORAGE_KEYS.LEGACY_QUEUE);
  await storageRemove(STORAGE_KEYS.LEGACY_SETTINGS);

  logger.info(`Migrated legacy data into project "${projectName}" (${projectId})`);
  return true;
}

// ── Initialization ──

export async function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {

  // Try migration first
  const migrated = await migrateFromLegacyKeys();
  if (migrated) return;

  // Load existing projects list
  const storedProjects = await storageGet<Project[]>(STORAGE_KEYS.PROJECTS_LIST);
  const storedActiveId = await storageGet<string>(STORAGE_KEYS.ACTIVE_PROJECT);

  if (storedProjects && storedProjects.length > 0) {
    projects = storedProjects;
    activeProjectId =
      storedActiveId && storedProjects.some((p) => p.id === storedActiveId)
        ? storedActiveId
        : storedProjects[0].id;
  } else {
    // Fresh install: create default project
    const projectId = makeId("proj");
    projects = [{ id: projectId, name: "默认项目", createdAt: now() }];
    activeProjectId = projectId;
    await persistProjects();
    await persistActiveProject();
  }

  // Load active project data
  const data = await loadProjectData(activeProjectId);
  queue = data.queue;
  settings = data.settings;
}

// ── Project CRUD ──

export async function getActiveProjectId(): Promise<string> {
  await ensureInitialized();
  return activeProjectId;
}

export async function listProjects(): Promise<Project[]> {
  await ensureInitialized();
  return [...projects];
}

export async function createProject(name: string): Promise<Project> {
  await ensureInitialized();
  const project: Project = {
    id: makeId("proj"),
    name,
    createdAt: now(),
  };
  projects = [...projects, project];

  // Initialize empty queue & default settings for the new project
  await storageSet(
    STORAGE_KEYS.projectQueue(project.id),
    structuredClone(DEFAULT_QUEUE_STATE),
  );
  await storageSet(
    STORAGE_KEYS.projectSettings(project.id),
    structuredClone(DEFAULT_SETTINGS),
  );
  await persistProjects();
  return project;
}

export async function renameProject(
  projectId: string,
  newName: string,
): Promise<void> {
  await ensureInitialized();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx === -1) throw new Error(`Project not found: ${projectId}`);
  projects = projects.map((p) =>
    p.id === projectId ? { ...p, name: newName } : p,
  );
  await persistProjects();
}

export async function deleteProject(projectId: string): Promise<void> {
  await ensureInitialized();
  if (projects.length <= 1) {
    throw new Error("Cannot delete the last project");
  }

  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx === -1) throw new Error(`Project not found: ${projectId}`);

  // GC: remove image blobs for all tasks in the deleted project
  const projectData = await loadProjectData(projectId);
  const refIds = collectAssetRefIds(projectData.queue.tasks);
  if (refIds.length) {
    void deleteImageBlobs(refIds).catch((e) =>
      logger.warn("deleteImageBlobs failed during project delete", e),
    );
  }

  // Remove project-scoped storage keys
  await storageRemove(STORAGE_KEYS.projectQueue(projectId));
  await storageRemove(STORAGE_KEYS.projectSettings(projectId));

  projects = projects.filter((p) => p.id !== projectId);
  await persistProjects();

  // If we deleted the active project, switch to the first remaining
  if (activeProjectId === projectId) {
    activeProjectId = projects[0].id;
    await persistActiveProject();
    const data = await loadProjectData(activeProjectId);
    queue = data.queue;
    settings = data.settings;
  }
}

export async function switchProject(
  projectId: string,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  if (queue.isRunning) {
    throw new Error("Cannot switch project while queue is running");
  }
  if (projectId === activeProjectId) return { queue, settings };

  if (!projects.some((p) => p.id === projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Save current project state
  await persist();

  // Switch
  activeProjectId = projectId;
  await persistActiveProject();

  // Load target project data
  const data = await loadProjectData(projectId);
  queue = data.queue;
  settings = data.settings;

  return { queue, settings };
}

// ── Storage quota ──

export async function getStorageUsage(): Promise<{
  bytesUsed: number;
  quota: number;
  warning: boolean;
}> {
  const bytesUsed = await new Promise<number>((resolve) => {
    if (chrome.storage.local.getBytesInUse) {
      chrome.storage.local.getBytesInUse((bytes: number) => resolve(bytes));
    } else {
      resolve(0);
    }
  });
  return {
    bytesUsed,
    quota: STORAGE_QUOTA_BYTES,
    warning: bytesUsed > STORAGE_QUOTA_BYTES * STORAGE_QUOTA_WARN_RATIO,
  };
}

// ── Queue operations (unchanged API, project-scoped persistence) ──

export async function getAppState(): Promise<{
  queue: QueueState;
  settings: UserSettings;
}> {
  await ensureInitialized();
  return { queue, settings };
}

export async function clearQueue(): Promise<{
  queue: QueueState;
  settings: UserSettings;
}> {
  await ensureInitialized();
  // GC: only delete blobs belonging to the current project's tasks, not all projects.
  const refIds = collectAssetRefIds(queue.tasks);
  if (refIds.length) {
    void deleteImageBlobs(refIds).catch((e) =>
      logger.warn("deleteImageBlobs failed", e),
    );
  }
  queue = structuredClone(DEFAULT_QUEUE_STATE);
  await persistQueue();
  return { queue, settings };
}

export async function clearHistory(): Promise<{
  queue: QueueState;
  settings: UserSettings;
}> {
  await ensureInitialized();
  const DONE: Set<string> = new Set(["success", "error", "skipped"]);
  const removed = queue.tasks.filter((t) => DONE.has(t.status));
  const refIds = collectAssetRefIds(removed);
  if (refIds.length)
    void deleteImageBlobs(refIds).catch((e) =>
      logger.warn("deleteImageBlobs failed", e),
    );
  queue = {
    ...queue,
    tasks: queue.tasks.filter((t) => !DONE.has(t.status)),
  };
  await persistQueue();
  return { queue, settings };
}

export async function addPrompts(
  prompts: ParsedPromptItem[],
  modeOverride?: import("../shared/types").GenerationMode,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();

  const newTasks: TaskItem[] = prompts.map((p) => {
    const model = settings.defaultModel;
    const mode = modeOverride ?? modeForModel(model);

    const task: TaskItem = {
      id: makeId(),
      prompt: p.prompt,
      mode,
      model,
      aspectRatio: settings.defaultAspectRatio,
      outputCount: settings.defaultOutputCount,
      status: "waiting",
      retries: 0,
      maxRetries: 0,
      createdAt: now(),
      downloadResolution: settings.defaultDownloadResolution,
      logs: [{ ts: now(), msg: "任务已创建入队" }],
      assets: p.assets,
    };

    const cap = resolveCapabilities(task);
    if (!cap.valid) {
      task.status = "skipped";
      task.errorMessage = cap.reason ?? "Capability guard rejected";
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

  await persistQueue();
  return { queue, settings };
}

export async function setRunning(
  isRunning: boolean,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = { ...queue, isRunning };
  await persistQueue();
  return { queue, settings };
}

export async function removeTask(
  taskId: string,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  const removed = queue.tasks.find((t) => t.id === taskId);
  if (removed) {
    const refIds = collectAssetRefIds([removed]);
    if (refIds.length)
      void deleteImageBlobs(refIds).catch((e) =>
        logger.warn("deleteImageBlobs failed", e),
      );
  }
  queue = {
    ...queue,
    tasks: queue.tasks.filter((t) => t.id !== taskId),
  };
  if (queue.currentTaskId === taskId) {
    queue.currentTaskId = undefined;
    queue.isRunning = false;
  }
  await persistQueue();
  return { queue, settings };
}

export async function skipTask(
  taskId: string,
  reason = "skipped by user",
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        status: "skipped",
        errorMessage: t.errorMessage ?? reason,
        completedAt: now(),
      };
    }),
  };
  await persistQueue();
  return { queue, settings };
}

export async function retryErrors(): Promise<{
  queue: QueueState;
  settings: UserSettings;
}> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.status !== "error") return t;
      return {
        ...t,
        status: "waiting",
        errorMessage: undefined,
        startedAt: undefined,
        completedAt: undefined,
      };
    }),
  };
  await persistQueue();
  return { queue, settings };
}

export async function updateSettings(
  patch: Partial<UserSettings>,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  settings = { ...settings, ...patch };
  await persistSettings();
  return { queue, settings };
}

export async function getNextWaitingTask(): Promise<TaskItem | undefined> {
  await ensureInitialized();
  return queue.tasks.find((t) => t.status === "waiting");
}

export async function markTaskRunning(
  taskId: string,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    currentTaskId: taskId,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        status: "running",
        startedAt: now(),
        errorMessage: undefined,
      };
    }),
  };
  await persistQueue();
  return { queue, settings };
}

export async function markTaskSuccess(
  taskId: string,
): Promise<{ queue: QueueState; settings: UserSettings }> {
  await ensureInitialized();
  queue = {
    ...queue,
    currentTaskId: undefined,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, status: "success", completedAt: now() };
    }),
  };
  await persistQueue();
  return { queue, settings };
}

export async function markTaskError(
  taskId: string,
  errorMessage: string,
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
        status: shouldRetry ? "waiting" : "error",
        errorMessage: shouldRetry
          ? `(重试 ${retries}/${t.maxRetries}) ${errorMessage}`
          : errorMessage,
      };
    }),
  };
  await persistQueue();
  return { queue, settings };
}

export async function appendTaskLog(
  taskId: string,
  msg: string,
): Promise<void> {
  await ensureInitialized();
  const entry: TaskLogEntry = { ts: now(), msg };
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      const logs = [...(t.logs ?? []), entry].slice(-LIMITS.MAX_LOGS_PER_TASK);
      return { ...t, logs };
    }),
  };
  await persistQueue();
}

export async function setChainRef(taskId: string, refId: string): Promise<void> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, chainPreviousRefId: refId };
    }),
  };
  await persistQueue();
}

/** Reset a failed task with a new prompt for retry (used by AI auto-rewrite). */
export async function resetTaskForRetry(
  taskId: string,
  newPrompt: string,
): Promise<void> {
  await ensureInitialized();
  queue = {
    ...queue,
    tasks: queue.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        prompt: newPrompt,
        status: "waiting" as const,
        errorMessage: undefined,
        startedAt: undefined,
        completedAt: undefined,
      };
    }),
  };
  await persistQueue();
}
