import { MSG } from './constants';
import type { GenerationMode, ParsedPromptItem, QueueState, TaskItem, UserSettings } from './types';

export type ConnectionReason =
  | 'no_active_tab'
  | 'not_labs'
  | 'not_flow_project'
  | 'no_content_script'
  | 'timeout'
  | 'unknown';

export type PingRequest = { type: typeof MSG.PING };

export type PongResponse = {
  type: typeof MSG.PONG;
  connected: boolean;
  reason?: ConnectionReason;
  tabId?: number;
  url?: string;
  title?: string;
  isFlowProject?: boolean;
};

export type GetPageStateRequest = { type: typeof MSG.GET_PAGE_STATE };

export type PageStateResponse = {
  type: typeof MSG.PAGE_STATE;
  tabId: number;
  url: string;
  title: string;
  isLabs: boolean;
  isFlowProject: boolean;
  // Active top tab in Flow UI (video/image). Undefined when not detectable.
  activeTopTab?: 'video' | 'image';
};

export type QueueGetStateRequest = { type: typeof MSG.QUEUE_GET_STATE };

export type QueueAddTasksRequest = {
  type: typeof MSG.QUEUE_ADD_TASKS;
  prompts: ParsedPromptItem[];
  // Optional override used by UI to match the current Flow tab (video/image).
  modeOverride?: GenerationMode;
};

export type QueueClearRequest = { type: typeof MSG.QUEUE_CLEAR };
export type QueueClearHistoryRequest = { type: typeof MSG.QUEUE_CLEAR_HISTORY };
export type QueueRemoveTaskRequest = { type: typeof MSG.QUEUE_REMOVE_TASK; taskId: string };
export type QueueSkipTaskRequest = { type: typeof MSG.QUEUE_SKIP_TASK; taskId: string };
export type QueueRetryErrorsRequest = { type: typeof MSG.QUEUE_RETRY_ERRORS };
export type QueueStartRequest = { type: typeof MSG.QUEUE_START };
export type QueuePauseRequest = { type: typeof MSG.QUEUE_PAUSE };
export type QueueStopRequest = { type: typeof MSG.QUEUE_STOP };

export type SettingsUpdateRequest = {
  type: typeof MSG.SETTINGS_UPDATE;
  patch: Partial<UserSettings>;
};

export type ExecuteTaskRequest = {
  type: typeof MSG.EXECUTE_TASK;
  task: TaskItem;
};

export type TaskLogMessage = {
  type: typeof MSG.TASK_LOG;
  taskId: string;
  msg: string;
};

export type TaskResultResponse = {
  type: typeof MSG.TASK_RESULT;
  taskId: string;
  ok: boolean;
  error?: string;
  downloadedCount?: number;
};

export type ExpectDownloadRequest = {
  type: typeof MSG.EXPECT_DOWNLOAD;
  dir: string;
  baseName: string;
  taskId: string;
  outputIndex: number;
};

export type ExpectDownloadResponse = { ok: true };

export type DownloadByUrlRequest = {
  type: typeof MSG.DOWNLOAD_BY_URL;
  url: string;
  dir: string;
  baseName: string;
};

export type DownloadByUrlResponse = { ok: boolean };

export type QueueStateResponse = {
  type: typeof MSG.QUEUE_STATE;
  queue: QueueState;
  settings: UserSettings;
};

export type AnyRequest =
  | PingRequest
  | GetPageStateRequest
  | QueueGetStateRequest
  | QueueAddTasksRequest
  | QueueClearRequest
  | QueueClearHistoryRequest
  | QueueRemoveTaskRequest
  | QueueSkipTaskRequest
  | QueueRetryErrorsRequest
  | QueueStartRequest
  | QueuePauseRequest
  | QueueStopRequest
  | SettingsUpdateRequest
  | ExecuteTaskRequest
  | TaskLogMessage
  | ExpectDownloadRequest
  | DownloadByUrlRequest;

export type AnyResponse =
  | PongResponse
  | PageStateResponse
  | QueueStateResponse
  | TaskResultResponse
  | ExpectDownloadResponse
  | DownloadByUrlResponse;

