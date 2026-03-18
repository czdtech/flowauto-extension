import { MSG } from "./constants";

export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

let currentLevel: LogLevel = import.meta.env?.DEV
  ? LogLevel.DEBUG
  : LogLevel.WARN;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}
export function getLogLevel(): LogLevel {
  return currentLevel;
}

const PREFIX = "[FlowAuto]";

function fmt(tag: string, msg: string): string {
  return `${PREFIX}${tag} ${msg}`;
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG) console.log(fmt(" 🔍", msg), ...args);
  },
  info(msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO) console.info(fmt(" ℹ️", msg), ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN) console.warn(fmt(" ⚠️", msg), ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.ERROR) console.error(fmt(" ❌", msg), ...args);
  },

  forTask(taskId: string) {
    const tag = ` [${taskId.slice(-6)}]`;
    return {
      debug: (msg: string, ...a: unknown[]) => {
        if (currentLevel <= LogLevel.DEBUG) console.log(fmt(tag, msg), ...a);
      },
      info: (msg: string, ...a: unknown[]) => {
        if (currentLevel <= LogLevel.INFO) console.info(fmt(tag, msg), ...a);
      },
      warn: (msg: string, ...a: unknown[]) => {
        if (currentLevel <= LogLevel.WARN) console.warn(fmt(tag, msg), ...a);
      },
      error: (msg: string, ...a: unknown[]) => {
        if (currentLevel <= LogLevel.ERROR) console.error(fmt(tag, msg), ...a);
      },
    };
  },
};

/** Extract a human-readable message from an unknown caught value. */
export function errorMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

/** Send a log line to the background for UI display. */
export function taskLog(taskId: string, msg: string): void {
  logger.forTask(taskId).info(msg);
  try {
    chrome.runtime.sendMessage({ type: MSG.TASK_LOG, taskId, msg });
  } catch {
    // content script may be disconnected — safe to ignore
  }
}
