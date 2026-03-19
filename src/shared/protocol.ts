import { MSG } from "./constants";
import type {
  GenerationMode,
  ParsedPromptItem,
  Project,
  QueueState,
  TaskItem,
  UserSettings,
} from "./types";

export type ConnectionReason =
  | "no_active_tab"
  | "not_labs"
  | "not_flow_project"
  | "no_content_script"
  | "timeout"
  | "unknown";

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
  activeTopTab?: "video" | "image";
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
export type QueueRemoveTaskRequest = {
  type: typeof MSG.QUEUE_REMOVE_TASK;
  taskId: string;
};
export type QueueSkipTaskRequest = {
  type: typeof MSG.QUEUE_SKIP_TASK;
  taskId: string;
};
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
  stealthMode: boolean;
  chainMode: boolean;
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
  chainCapturedRefId?: string;
};

export type ResetExecutionSessionRequest = {
  type: typeof MSG.RESET_EXECUTION_SESSION;
  clearAttachedReferences?: boolean;
};

export type ResetExecutionSessionResponse = {
  type: typeof MSG.RESET_EXECUTION_SESSION;
  ok: boolean;
};

export type RefMediaLookupRequest = {
  type: typeof MSG.REF_MEDIA_LOOKUP;
  projectId: string;
  assetHash: string;
};

export type RefMediaLookupResponse = {
  type: typeof MSG.REF_MEDIA_LOOKUP;
  found: boolean;
  mediaUuid?: string;
};

export type RefMediaUpsertRequest = {
  type: typeof MSG.REF_MEDIA_UPSERT;
  projectId: string;
  assetHash: string;
  mediaUuid: string;
  filename?: string;
};

export type RefMediaUpsertResponse = {
  type: typeof MSG.REF_MEDIA_UPSERT;
  ok: boolean;
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

export type GetImageBlobRequest = {
  type: typeof MSG.GET_IMAGE_BLOB;
  refId: string;
};

export type GetImageBlobResponse = {
  type: typeof MSG.GET_IMAGE_BLOB;
  found: boolean;
  data?: string; // base64-encoded image data
  mimeType?: string;
};

export type AiEnhanceRequest = {
  type: typeof MSG.AI_ENHANCE;
  prompt: string;
};

export type AiEnhanceResponse = {
  ok: boolean;
  enhanced?: string;
  error?: string;
};

export type AiRewriteRequest = {
  type: typeof MSG.AI_REWRITE;
  prompt: string;
  errorMessage: string;
};

export type AiRewriteResponse = {
  ok: boolean;
  rewritten?: string;
  error?: string;
};

export type AiVariantsRequest = {
  type: typeof MSG.AI_VARIANTS;
  prompt: string;
  count: number;
};

export type AiVariantsResponse = {
  ok: boolean;
  variants?: string[];
  error?: string;
};

export type QueueStateResponse = {
  type: typeof MSG.QUEUE_STATE;
  queue: QueueState;
  settings: UserSettings;
  activeProjectId?: string;
};

// ── Project management ──

export type ProjectListRequest = { type: typeof MSG.PROJECT_LIST };
export type ProjectListResponse = {
  type: typeof MSG.PROJECT_LIST;
  projects: Project[];
  activeProjectId: string;
};

export type ProjectCreateRequest = {
  type: typeof MSG.PROJECT_CREATE;
  name: string;
};
export type ProjectCreateResponse = {
  type: typeof MSG.PROJECT_CREATE;
  project: Project;
  projects: Project[];
  activeProjectId: string;
};

export type ProjectRenameRequest = {
  type: typeof MSG.PROJECT_RENAME;
  projectId: string;
  newName: string;
};
export type ProjectRenameResponse = {
  type: typeof MSG.PROJECT_RENAME;
  projects: Project[];
};

export type ProjectDeleteRequest = {
  type: typeof MSG.PROJECT_DELETE;
  projectId: string;
};
export type ProjectDeleteResponse = {
  type: typeof MSG.PROJECT_DELETE;
  projects: Project[];
  activeProjectId: string;
};

export type ProjectSwitchRequest = {
  type: typeof MSG.PROJECT_SWITCH;
  projectId: string;
};
export type ProjectSwitchResponse = {
  type: typeof MSG.PROJECT_SWITCH;
  queue: QueueState;
  settings: UserSettings;
  activeProjectId: string;
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
  | ResetExecutionSessionRequest
  | RefMediaLookupRequest
  | RefMediaUpsertRequest
  | ExpectDownloadRequest
  | DownloadByUrlRequest
  | GetImageBlobRequest
  | ProjectListRequest
  | ProjectCreateRequest
  | ProjectRenameRequest
  | ProjectDeleteRequest
  | ProjectSwitchRequest
  | AiEnhanceRequest
  | AiRewriteRequest
  | AiVariantsRequest;

export type AnyResponse =
  | PongResponse
  | PageStateResponse
  | QueueStateResponse
  | TaskResultResponse
  | ResetExecutionSessionResponse
  | RefMediaLookupResponse
  | RefMediaUpsertResponse
  | ExpectDownloadResponse
  | DownloadByUrlResponse
  | GetImageBlobResponse
  | ProjectListResponse
  | ProjectCreateResponse
  | ProjectRenameResponse
  | ProjectDeleteResponse
  | ProjectSwitchResponse
  | AiEnhanceResponse
  | AiRewriteResponse
  | AiVariantsResponse;
