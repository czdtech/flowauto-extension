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

  /** Delay between retry attempts in generation loop (1000-1800ms) */
  RETRY_PAUSE_MIN: 1000,
  RETRY_PAUSE_MAX: 1800,

  /** Short pause after non-critical UI actions (400-800ms) */
  UI_SETTLE_MIN: 400,
  UI_SETTLE_MAX: 800,

  /** Generation poll interval (3000-4000ms) */
  GENERATION_POLL_MIN: 3000,
  GENERATION_POLL_MAX: 4000,
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

  /** Consecutive stable polls required before declaring generation complete */
  STABLE_POLLS_REQUIRED: 3,
  PARTIAL_STABLE_POLLS_REQUIRED: 5,
} as const;

// ============================================
// Stealth Mode
// ============================================

export const STEALTH = {
  /** Minimum delay multiplier when stealth is enabled */
  MULTIPLIER_MIN: 1.5,
  /** Maximum delay multiplier when stealth is enabled */
  MULTIPLIER_MAX: 3.0,
  /** Minimum inter-step pause in stealth mode (ms) */
  PAUSE_MIN_MS: 500,
  /** Maximum inter-step pause in stealth mode (ms) */
  PAUSE_MAX_MS: 2000,
  /** Hard cap: stealth delay never exceeds original_max × this factor */
  MAX_SLOWDOWN_FACTOR: 4,
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