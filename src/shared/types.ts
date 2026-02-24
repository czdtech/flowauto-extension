export type GenerationMode =
  | 'text-to-video'
  | 'frames-first'
  | 'frames-first-last'
  | 'ingredients'
  | 'create-image'
  | 'extend'
  | 'jump-to'
  | 'insert-object'
  | 'remove-object'
  | 'camera-position'
  | 'camera-motion'
  | 'camera-control';

export type VeoModel = 'veo2-fast' | 'veo2-quality' | 'veo3.1-fast' | 'veo3.1-quality';
export type ImageModel = 'nano-banana' | 'nano-banana-pro' | 'imagen4';
export type AnyModel = VeoModel | ImageModel;

export type AspectRatio = '16:9' | '9:16';

export type TaskStatus = 'waiting' | 'running' | 'downloading' | 'success' | 'error' | 'skipped';

export type AssetType = 'start' | 'end' | 'ingredient';

export interface TaskAsset {
  type: AssetType;
  dataUrl: string; // base64 data URL
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
  logs?: TaskLogEntry[];
  assets?: TaskAsset[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface QueueState {
  tasks: TaskItem[];
  isRunning: boolean;
  currentTaskId?: string;
  projectName?: string;
}

export interface UserSettings {
  defaultMode: GenerationMode;
  defaultVeoModel: VeoModel;
  defaultImageModel: ImageModel;
  defaultAspectRatio: AspectRatio;
  defaultOutputCount: number;
  interTaskDelayMs: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultMode: 'text-to-video',
  defaultVeoModel: 'veo3.1-quality',
  defaultImageModel: 'nano-banana-pro',
  defaultAspectRatio: '9:16',
  defaultOutputCount: 1,
  interTaskDelayMs: 5000,
};

export const DEFAULT_QUEUE_STATE: QueueState = {
  tasks: [],
  isRunning: false,
};

export interface ParsedPromptItem {
  filename?: string;
  prompt: string;
}

