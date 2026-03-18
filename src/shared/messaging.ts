/**
 * Shared messaging utilities for Chrome Extension communication
 * 
 * Provides type-safe wrappers around chrome.tabs.sendMessage and
 * chrome.runtime.sendMessage with consistent timeout handling.
 */

import { TIMEOUTS } from './config';

export interface MessageOptions {
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface TypedResponse<T> {
  data: T;
  error?: undefined;
}

export interface TypedError {
  data?: undefined;
  error: Error;
}

/**
 * Send a message to a specific tab and wait for a typed response.
 * 
 * This is a type-safe wrapper around chrome.tabs.sendMessage with
 * built-in timeout support and error handling.
 * 
 * @param tabId - The ID of the target tab
 * @param message - The message to send
 * @param timeoutMs - Optional timeout (defaults to TIMEOUTS.MESSAGE_DEFAULT)
 * @returns Promise resolving to the typed response
 * @throws Error if the message fails or times out
 * 
 * @example
 * const response = await sendMessageToTab<PingRequest, PongResponse>(
 *   tabId,
 *   { type: MSG.PING },
 *   2000
 * );
 */
export function sendMessageToTab<TReq, TRes>(
  tabId: number,
  message: TReq,
  timeoutMs: number = TIMEOUTS.MESSAGE_DEFAULT
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response: TRes) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Send a message to the background script and wait for a typed response.
 * 
 * @param message - The message to send
 * @returns Promise resolving to the typed response
 * @throws Error if the message fails
 * 
 * @example
 * const response = await sendMessageToBackground<QueueGetStateRequest, QueueStateResponse>({
 *   type: MSG.QUEUE_GET_STATE,
 * });
 */
export function sendMessageToBackground<TReq, TRes>(message: TReq): Promise<TRes> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TRes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Send a message to the background with error suppression.
 * Use this when you don't care about the result and want to avoid
 * "Uncaught (in promise)" warnings in MV3.
 */
export function sendMessageToBackgroundSafe(message: unknown): void {
  try {
    const maybe = chrome.runtime.sendMessage(message);
    // In MV3 this may return a Promise
    if (maybe && typeof (maybe as Promise<unknown>).catch === 'function') {
      (maybe as Promise<unknown>).catch(() => {
        // Silently ignore errors - best effort only
      });
    }
  } catch {
    // Best effort - extension might not be available
  }
}

/**
 * Create a promise that rejects after a specified timeout.
 * Useful for wrapping other async operations.
 * 
 * @param ms - Timeout in milliseconds
 * @param message - Optional error message
 */
export function createTimeoutPromise(ms: number, message = 'timeout'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Race a promise against a timeout.
 * 
 * @param promise - The promise to race
 * @param ms - Timeout in milliseconds
 * @returns The promise result or throws timeout error
 * 
 * @example
 * const result = await withTimeout(
 *   fetchData(),
 *   5000,
 *   'Data fetch timed out'
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'timeout'
): Promise<T> {
  return Promise.race([
    promise,
    createTimeoutPromise(ms, message),
  ]);
}