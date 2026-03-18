/**
 * Global configuration constants for FlowAuto Extension
 * 
 * All timing values and limits are centralized here for easy adjustment
 * and maintenance. These can be overridden via chrome.storage in the future.
 */

// ============================================
// Timing Configuration (milliseconds)
// ============================================

/** UI stabilization delay after state changes */
export const TIMING = {
  /** Short random sleep for quick UI updates (100-250ms) */
  SHORT_MIN: 100,
  SHORT_MAX: 250,

  /** Medium random sleep for standard UI transitions (300-600ms) */
  MEDIUM_MIN: 300,
  MEDIUM_MAX: 600,

  /** Long random sleep for complex UI updates (800-1500ms) */
  LONG_MIN: 800,
  LONG_MAX: 1500,

  /** Delay between sequential reference image injections (1500-2500ms) */
  BETWEEN_ASSETS_MIN: 1500,
  BETWEEN_ASSETS_MAX: 2500,

  /** Delay between downloads (1500-2500ms) */
  BETWEEN_DOWNLOADS_MIN: 1500,
  BETWEEN_DOWNLOADS_MAX: 2500,

  /** Delay for URL fallback downloads (1200-2000ms) */
  URL_DOWNLOAD_MIN: 1200,
  URL_DOWNLOAD_MAX: 2000,
} as const;

// ============================================
// Timeouts (milliseconds)
// ============================================

export const TIMEOUTS = {
  /** Default message timeout between background and content script */
  MESSAGE_DEFAULT: 1500,

  /** Extended timeout for content script injection */
  CONTENT_INJECTION: 2500,

  /** Resource panel open/close timeout */
  RESOURCE_PANEL: 5000,

  /** Resource panel polling interval */
  RESOURCE_PANEL_INTERVAL: 300,

  /** Image generation timeout (2 minutes) */
  GENERATION_IMAGE: 120_000,

  /** Video generation timeout (15 minutes) */
  GENERATION_VIDEO: 900_000,

  /** Task execution timeout (30 minutes) */
  TASK_EXECUTION: 30 * 60 * 1000,

  /** Download completion wait timeout (2 minutes) */
  DOWNLOAD_COMPLETE: 120_000,
} as const;

// ============================================
// Retry & Limits
// ============================================

export const LIMITS = {
  /** Maximum generation attempts per task */
  MAX_GENERATION_ATTEMPTS: 3,

  /** Maximum logs per task before truncation */
  MAX_LOGS_PER_TASK: 30,

  /** Polling interval for task status checks (ms) */
  STATUS_POLL_INTERVAL: 2500,
} as const;

// ============================================
// Download & Storage
// ============================================

export const DOWNLOAD = {
  /** Minimum image dimension to qualify as a result thumbnail (px) */
  MIN_RESULT_DIMENSION_PX: 80,

  /** Default download resolution */
  DEFAULT_RESOLUTION: '2K/1080p' as const,

  /** Task ID suffix length in filenames */
  TASK_ID_SUFFIX_LENGTH: 6,
} as const;

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEYS = {
  QUEUE_STATE: 'flowauto.queueState.v1',
  SETTINGS: 'flowauto.settings.v1',
} as const;