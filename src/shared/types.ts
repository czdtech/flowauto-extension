export type GenerationMode =
  | "text-to-video"
  | "frames-first"
  | "frames-first-last"
  | "ingredients"
  | "create-image"
  | "extend"
  | "jump-to"
  | "insert-object"
  | "remove-object"
  | "camera-position"
  | "camera-motion"
  | "camera-control";

export type VeoModel = "veo3.1-fast" | "veo3.1-quality";
export type ImageModel = "nano-banana-2" | "nano-banana-pro" | "imagen4";
export type AnyModel = VeoModel | ImageModel;

export type GenerationType =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video";

/** Returns true if the model generates images (as opposed to videos). */
export function isImageModel(model: AnyModel): boolean {
  return (
    model === "nano-banana-2" ||
    model === "nano-banana-pro" ||
    model === "imagen4"
  );
}

/** Map a model to its natural GenerationMode. */
export function modeForModel(model: AnyModel): GenerationMode {
  return isImageModel(model) ? "create-image" : "text-to-video";
}

export type AspectRatio = "16:9" | "9:16";

/**
 * Unified download resolution selection.
 * '1K/720p' → 1K for images, 720p for videos.
 * '2K/1080p' → 2K for images, 1080p for videos.
 * '4K' → 4K for both (requires upgraded tier).
 */
export type DownloadResolution = "1K/720p" | "2K/1080p" | "4K";

export type TaskStatus =
  | "waiting"
  | "running"
  | "downloading"
  | "success"
  | "error"
  | "skipped";

export type AssetType = "start" | "end" | "ingredient";

export interface TaskAsset {
  type: AssetType;
  refId: string; // IndexedDB key for the image blob
  filename: string; // original filename for display/debugging
}

export interface TaskLogEntry {
  ts: number;
  msg: string;
}

export interface TaskItem {
  id: string;
  filename?: string;
  prompt: string;
  mode: GenerationMode;
  model: AnyModel;
  aspectRatio: AspectRatio;
  outputCount: number;
  status: TaskStatus;
  retries: number;
  maxRetries: number;
  errorMessage?: string;
  downloadResolution?: DownloadResolution;
  logs?: TaskLogEntry[];
  assets?: TaskAsset[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  chainPreviousRefId?: string;
}

export interface QueueState {
  tasks: TaskItem[];
  isRunning: boolean;
  currentTaskId?: string;
  projectName?: string;
}

export interface UserSettings {
  defaultModel: AnyModel;
  defaultGenerationType: GenerationType;
  defaultAspectRatio: AspectRatio;
  defaultOutputCount: number;
  interTaskDelayMs: number;
  defaultDownloadResolution: DownloadResolution;
  stealthMode: boolean;
  chainMode: boolean;
  aiSettings?: import("./ai-provider").AiSettings;
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultModel: "nano-banana-2",
  defaultGenerationType: "text-to-image",
  defaultAspectRatio: "9:16",
  defaultOutputCount: 1,
  interTaskDelayMs: 5000,
  defaultDownloadResolution: "2K/1080p",
  stealthMode: false,
  chainMode: false,
};

export const DEFAULT_QUEUE_STATE: QueueState = {
  tasks: [],
  isRunning: false,
};

export interface ParsedPromptItem {
  prompt: string;
  inlineRefs?: string[];
  assets?: TaskAsset[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}
