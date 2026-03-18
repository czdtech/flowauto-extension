/**
 * Structured logging utility with level-based filtering
 * 
 * Usage:
 *   import { logger } from '../shared/logger';
 *   logger.debug('Detailed debug info');
 *   logger.info('General information');
 *   logger.warn('Warning message');
 *   logger.error('Error message', error);
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

let currentLogLevel: LogLevel = LogLevel.DEBUG;

// Check if we're in development mode
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
  currentLogLevel = LogLevel.INFO;
}

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Format log message with optional prefix
 */
function formatMessage(level: string, message: string): string {
  return `[FlowAuto][${level}] ${message}`;
}

/**
 * Main logger object
 */
export const logger = {
  /**
   * Debug level logging - detailed information for debugging
   * Only shown when log level is DEBUG
   */
  debug(message: string, ...args: unknown[]): void {
    if (currentLogLevel <= LogLevel.DEBUG) {
      console.log(formatMessage('DEBUG', message), ...args);
    }
  },

  /**
   * Info level logging - general operational information
   * Shown when log level is INFO or lower
   */
  info(message: string, ...args: unknown[]): void {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(formatMessage('INFO', message), ...args);
    }
  },

  /**
   * Warning level logging - non-critical issues
   * Shown when log level is WARN or lower
   */
  warn(message: string, ...args: unknown[]): void {
    if (currentLogLevel <= LogLevel.WARN) {
      console.warn(formatMessage('WARN', message), ...args);
    }
  },

  /**
   * Error level logging - critical errors
   * Always shown unless log level is SILENT
   */
  error(message: string, error?: unknown): void {
    if (currentLogLevel <= LogLevel.ERROR) {
      console.error(formatMessage('ERROR', message), error);
    }
  },

  /**
   * Task-specific logging with structured prefix
   */
  forTask(taskId: string) {
    return {
      debug: (msg: string, ...args: unknown[]) => 
        logger.debug(`[${taskId.slice(-6)}] ${msg}`, ...args),
      info: (msg: string, ...args: unknown[]) => 
        logger.info(`[${taskId.slice(-6)}] ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => 
        logger.warn(`[${taskId.slice(-6)}] ${msg}`, ...args),
      error: (msg: string, err?: unknown) => 
        logger.error(`[${taskId.slice(-6)}] ${msg}`, err),
    };
  },
};

/**
 * Legacy compatibility: maintains the old taskLog function signature
 * while routing through the new logger
 */
export function taskLog(
  taskId: string,
  msg: string,
  options?: { toUi?: boolean; toConsole?: boolean }
): void {
  const toUi = options?.toUi ?? true;
  const toConsole = options?.toConsole ?? true;

  if (toConsole) {
    logger.forTask(taskId).info(msg);
  }

  if (toUi) {
    // Send to UI for display in task card
    try {
      const { MSG } = require('./constants');
      const maybe = chrome.runtime.sendMessage({
        type: MSG.TASK_LOG,
        taskId,
        msg,
      });
      // In MV3 this may return a Promise
      if (maybe && typeof maybe.catch === 'function') {
        maybe.catch(() => { /* best effort */ });
      }
    } catch {
      // best effort - UI might not be available
    }
  }
}