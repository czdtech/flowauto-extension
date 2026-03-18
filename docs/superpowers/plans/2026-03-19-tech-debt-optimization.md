# Tech Debt Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the in-progress refactoring and resolve all P0-P3 tech debt items from the quality analysis report.

**Architecture:** 4-phase approach — restore build first, then type safety, robustness improvements, and finally unit tests. Each phase produces a buildable project.

**Tech Stack:** TypeScript 5.9, Svelte, Vite + CRXJS, Chrome Extension MV3, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-tech-debt-optimization-design.md`

---

## Phase 1: Restore Build

### Task 1: Rewrite `logger.ts`

**Files:**
- Rewrite: `src/shared/logger.ts`

The current file has 7 TypeScript errors: `enum` violates `erasableSyntaxOnly`, `process` and `require()` don't exist in browser extensions.

- [ ] **Step 1: Rewrite logger.ts**

Replace the entire file. Key changes:
- `export enum LogLevel` → `export const LogLevel = { ... } as const` + `export type LogLevel = ...`
- `typeof process !== 'undefined' && process.env?.NODE_ENV` → `import.meta.env?.DEV`
- `require('./constants')` at line 128 → static `import { MSG } from './constants'` at top
- Keep public API identical: `logger.debug/info/warn/error`, `logger.forTask(taskId)`, `taskLog(taskId, msg)`

```typescript
// src/shared/logger.ts
import { MSG } from "./constants";

export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

let currentLevel: LogLevel = (import.meta.env?.DEV) ? LogLevel.DEBUG : LogLevel.WARN;

export function setLogLevel(level: LogLevel): void { currentLevel = level; }
export function getLogLevel(): LogLevel { return currentLevel; }

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
      debug: (msg: string, ...a: unknown[]) => { if (currentLevel <= LogLevel.DEBUG) console.log(fmt(tag, msg), ...a); },
      info:  (msg: string, ...a: unknown[]) => { if (currentLevel <= LogLevel.INFO)  console.info(fmt(tag, msg), ...a); },
      warn:  (msg: string, ...a: unknown[]) => { if (currentLevel <= LogLevel.WARN)  console.warn(fmt(tag, msg), ...a); },
      error: (msg: string, ...a: unknown[]) => { if (currentLevel <= LogLevel.ERROR) console.error(fmt(tag, msg), ...a); },
    };
  },
};

/** Send a log line to the background for UI display. */
export function taskLog(taskId: string, msg: string): void {
  logger.forTask(taskId).info(msg);
  try {
    chrome.runtime.sendMessage({ type: MSG.TASK_LOG, taskId, msg });
  } catch {
    // content script may be disconnected — safe to ignore
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/jiang/Desktop/sea/flowauto-extension && npx tsc --noEmit 2>&1 | head -30`
Expected: logger.ts errors gone. May still have unused-import errors in other files.

- [ ] **Step 3: Commit**

```bash
git add src/shared/logger.ts
git commit -m "fix: rewrite logger.ts for browser extension compatibility

Replace enum with const object, process.env with import.meta.env.DEV,
require() with static ESM import."
```

---

### Task 2: Add missing config constants

**Files:**
- Modify: `src/shared/config.ts` (add TIMING.RETRY_PAUSE, TIMING.GENERATION_POLL, TIMING.CLIPBOARD_INJECT)

- [ ] **Step 1: Add new TIMING constants**

Add after the existing `URL_DOWNLOAD_MAX` entry in config.ts (around line 36):

```typescript
  /** randomSleep between retry attempts in generation loop */
  RETRY_PAUSE_MIN: 1000,
  RETRY_PAUSE_MAX: 1800,
  /** short pause after non-critical UI actions */
  UI_SETTLE_MIN: 400,
  UI_SETTLE_MAX: 800,
  /** generation poll interval */
  GENERATION_POLL_MIN: 3000,
  GENERATION_POLL_MAX: 4000,
```

Add to LIMITS (around line 82):

```typescript
  /** consecutive stable polls required before declaring generation complete */
  STABLE_POLLS_REQUIRED: 3,
  PARTIAL_STABLE_POLLS_REQUIRED: 5,
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/config.ts
git commit -m "feat: add RETRY_PAUSE, UI_SETTLE, GENERATION_POLL timing constants"
```

---

### Task 3: Fix background file imports

**Files:**
- Modify: `src/background/index.ts` (remove unused `TIMEOUTS` import)
- Modify: `src/background/runner.ts` (use `TIMEOUTS.TASK_EXECUTION`, remove unused `logger`)

- [ ] **Step 1: Fix index.ts**

Remove the unused `TIMEOUTS` import at line 54. Or, if line 388 has a hardcoded `120_000` for download timeout, replace it with `TIMEOUTS.DOWNLOAD_COMPLETE` and keep the import. Check which applies.

- [ ] **Step 2: Fix runner.ts**

At line 109, replace `30 * 60 * 1000` with `TIMEOUTS.TASK_EXECUTION`.
Remove unused `logger` import at line 15 (no console calls to replace in this file).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors from background/*.ts files.

- [ ] **Step 4: Commit**

```bash
git add src/background/index.ts src/background/runner.ts
git commit -m "fix: clean unused imports, use TIMEOUTS.TASK_EXECUTION in runner"
```

---

### Task 4: Migrate execute-task.ts constants

**Depends on:** Task 1 (logger rewrite) and Task 2 (new config constants)

**Files:**
- Modify: `src/content/actions/execute-task.ts`

- [ ] **Step 1: Replace imports and constants**

1. Add import: `import { TIMING, TIMEOUTS, LIMITS } from "../../shared/config";` (TIMING already imported; add TIMEOUTS, LIMITS)
2. Add import: `import { taskLog } from "../../shared/logger";`
3. Remove the local `taskLog` function (lines 50-71) and `taskDebug` (lines 73-75)
4. Line 47: replace `120_000` with `TIMEOUTS.GENERATION_IMAGE` and `900_000` with `TIMEOUTS.GENERATION_VIDEO`
5. Line 338: remove `const MAX_GENERATION_ATTEMPTS = 3;` — replace all usages with `LIMITS.MAX_GENERATION_ATTEMPTS`
6. Line 413: `randomSleep(400, 800)` → `randomSleep(TIMING.UI_SETTLE_MIN, TIMING.UI_SETTLE_MAX)`
7. Lines 431, 445, 479: `randomSleep(1000, 1800)` → `randomSleep(TIMING.RETRY_PAUSE_MIN, TIMING.RETRY_PAUSE_MAX)`

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep execute-task`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/content/actions/execute-task.ts
git commit -m "refactor: migrate execute-task.ts to shared config constants and logger"
```

---

### Task 5: Migrate download.ts constant

**Files:**
- Modify: `src/content/actions/download.ts`

- [ ] **Step 1: Replace MIN_RESULT_PX**

1. Add import: `import { TIMING, DOWNLOAD } from '../../shared/config';` (TIMING already imported; add DOWNLOAD)
2. Remove line 15: `const MIN_RESULT_PX = 80;`
3. Replace all `MIN_RESULT_PX` usages with `DOWNLOAD.MIN_RESULT_DIMENSION_PX`

- [ ] **Step 2: Fix generate.ts duplicate**

`src/content/actions/generate.ts` line 9 also has `const MIN_RESULT_PX = 80;`.
Add DOWNLOAD import and replace the same way.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "download|generate"`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/content/actions/download.ts src/content/actions/generate.ts
git commit -m "refactor: use DOWNLOAD.MIN_RESULT_DIMENSION_PX, remove duplicate constants"
```

---

### Task 6: Full build verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run vite build**

Run: `npx vite build`
Expected: Build succeeds, output in `dist/`.

- [ ] **Step 3: Commit if any fixups needed**

---

## Phase 2: Type Safety (P0)

### Task 7: Create chrome type declarations

**Files:**
- Create: `src/shared/chrome-types.d.ts`
- Modify: `src/background/index.ts`

- [ ] **Step 1: Analyze the `as any` patterns**

All 12 `as any` casts in `background/index.ts` are around `chrome.sidePanel.*` methods. The pattern:
```typescript
const maybe = chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true } as any);
if (maybe && typeof (maybe as any).catch === "function") (maybe as any).catch(() => {});
```

The issue: `@types/chrome` types these methods as `void` but in MV3 they return `Promise<void>`.

- [ ] **Step 2: Create type declarations**

**Important:** First check what `@types/chrome` already declares for `chrome.sidePanel`. Only declare types that are missing or incorrectly typed. Use declaration merging carefully to avoid duplicate identifier errors.

```typescript
// src/shared/chrome-types.d.ts
// Only add declarations MISSING from @types/chrome.
// Check installed @types/chrome version first.

declare namespace chrome.sidePanel {
  interface SetPanelBehaviorOptions {
    openPanelOnActionClick?: boolean;
  }
  interface SetOptionsOptions {
    enabled?: boolean;
    tabId?: number;
    path?: string;
  }
  interface OpenOptions {
    tabId?: number;
    windowId?: number;
  }
  function setPanelBehavior(options: SetPanelBehaviorOptions): Promise<void>;
  function setOptions(options: SetOptionsOptions): Promise<void>;
  function open(options: OpenOptions): Promise<void>;
}
```

- [ ] **Step 3: Remove `as any` from index.ts**

Replace patterns like:
```typescript
const maybe = chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true } as any);
if (maybe && typeof (maybe as any).catch === "function") (maybe as any).catch(() => {});
```
With:
```typescript
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

The Promise-based API lets us just call `.catch()` directly — no need for the `typeof .catch` guard.

- [ ] **Step 4: Scan for remaining `as any` in other files**

Run: `grep -rn "as any" src/ --include="*.ts" --include="*.svelte"`

Known locations beyond index.ts (from codebase scan):
- `inject-image.ts`: ~4 occurrences (DOM event construction — likely need `@ts-expect-error`)
- `execute-task.ts`: ~3 occurrences
- `dom.ts`: ~5 occurrences (DOM API gaps)
- `content-injection.ts`: ~2 occurrences
- `prompt.ts`: ~1 occurrence

For each remaining `as any`:
- If it's a chrome API type gap → add to chrome-types.d.ts
- If it's a DOM API limitation (e.g., `ClipboardEvent` construction) → replace with `// @ts-expect-error <reason>`
- If it's genuinely untyped → replace with `// @ts-expect-error <reason>`
- If it's fixable with a proper type → fix it

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/shared/chrome-types.d.ts src/background/index.ts
git commit -m "fix(types): add chrome.sidePanel declarations, eliminate as any casts"
```

---

## Phase 3: Robustness (P1-P2)

### Task 8: Consolidate inline selectors

**Files:**
- Modify: `src/content/selectors.ts`
- Modify: `src/content/actions/download.ts` (inline selectors)
- Modify: `src/content/actions/inject-image.ts` (inline selectors)

- [ ] **Step 1: Find all inline selectors**

Run: `grep -rn 'class\*=' src/content/ --include="*.ts"` and `grep -rn 'querySelector' src/content/actions/ --include="*.ts"`

Identify selectors not going through `selectors.ts`.

- [ ] **Step 2: Add missing selectors to selectors.ts**

Add any discovered inline selectors as named constants. Example patterns to look for:
- `[class*="eUdvpI"]` in download.ts
- `[class*="sc-"]` in download.ts
- Hardcoded role/aria queries in inject-image.ts

- [ ] **Step 3: Update files to use SELECTORS**

Replace inline selector strings with `SELECTORS.xxx` references.

- [ ] **Step 4: Verify build + commit**

```bash
npx tsc --noEmit
git add src/content/selectors.ts src/content/actions/download.ts src/content/actions/inject-image.ts
git commit -m "refactor: consolidate inline selectors into selectors.ts"
```

---

### Task 9: Migrate console.* to logger

**Files:**
- Modify: `src/content/actions/download.ts` (~23 console calls)
- Modify: `src/content/actions/generate.ts`
- Modify: `src/content/actions/inject-image.ts`
- Modify: `src/content/actions/execute-task.ts`
- Modify: `src/content/actions/navigate.ts`
- Modify: `src/content/actions/settings.ts`
- Modify: `src/content/actions/prompt.ts`
- Modify: other content script files as discovered

- [ ] **Step 1: Inventory all console.* calls**

Run: `grep -rn "console\.\(log\|warn\|error\|debug\)" src/ --include="*.ts" --include="*.svelte" | wc -l`

Then categorize:
- `console.log("[FlowAuto Debug]..."` → `logger.debug(...)`
- `console.warn("[FlowAuto]..."` → `logger.warn(...)`
- `console.error(...)` → `logger.error(...)`
- `console.log("[FlowAuto]..."` (non-debug) → `logger.info(...)`

- [ ] **Step 2: Batch replace in download.ts**

Add `import { logger } from "../../shared/logger";` at top.
Replace all ~23 console calls following the categorization above.
Strip the `[FlowAuto Debug]` / `[FlowAuto]` prefixes (logger adds its own prefix).

- [ ] **Step 3: Batch replace in remaining content action files**

Repeat for each file: add logger import, replace console calls, strip redundant prefixes.

- [ ] **Step 4: Verify build + commit**

```bash
npx tsc --noEmit
git add src/content/ src/shared/logger.ts
git commit -m "refactor: migrate console.* to structured logger across content scripts"
```

---

### Task 10: Eliminate remaining magic numbers

**Depends on:** Task 2 (config constants must exist)

**Files:**
- Modify: `src/content/actions/generate.ts`
- Modify: `src/content/actions/inject-image.ts`
- Modify: `src/background/queue-engine.ts`
- Modify: `src/shared/config.ts` (if new constants needed)

- [ ] **Step 1: generate.ts**

- Line 112: `randomSleep(3000, 4000)` → `randomSleep(TIMING.GENERATION_POLL_MIN, TIMING.GENERATION_POLL_MAX)`
- Lines 114-115: `STABLE_REQUIRED = 3`, `PARTIAL_STABLE_REQUIRED = 5` → `LIMITS.STABLE_POLLS_REQUIRED`, `LIMITS.PARTIAL_STABLE_POLLS_REQUIRED`
- Line 74, 418: `randomSleep(400, 800)` → `randomSleep(TIMING.UI_SETTLE_MIN, TIMING.UI_SETTLE_MAX)`

- [ ] **Step 2: queue-engine.ts**

- Line 278: `const MAX_LOGS_PER_TASK = 30` → import and use `LIMITS.MAX_LOGS_PER_TASK`

- [ ] **Step 3: inject-image.ts — selective migration**

inject-image.ts has ~30 hardcoded sleep values. Apply KISS principle:
- Replace values that match existing TIMING constants (300-600 → TIMING.MEDIUM_MIN/MEDIUM_MAX, 800-1500 → TIMING.LONG_MIN/LONG_MAX, 200-400 → TIMING.SHORT_MIN/SHORT_MAX)
- Leave genuinely one-off values (like `sleep(50)` for microtask yields) as-is with a brief comment
- Add `import { TIMING, TIMEOUTS } from "../../shared/config";`
- Replace `timeoutMs: 5000` with `TIMEOUTS.RESOURCE_PANEL` where semantically appropriate
- Replace `timeoutMs: 60000` upload timeout — add `TIMEOUTS.UPLOAD` to config.ts if needed

- [ ] **Step 4: Verify build + commit**

```bash
npx tsc --noEmit
git add src/content/actions/generate.ts src/content/actions/inject-image.ts src/background/queue-engine.ts src/shared/config.ts
git commit -m "refactor: extract magic numbers to config constants"
```

---

### Task 11: Improve error handling

**Files:**
- Modify: `src/background/queue-engine.ts`
- Any other files with `.catch(() => {})`

- [ ] **Step 1: Find all silent catches**

Run: `grep -rn "\.catch(() => {})" src/ --include="*.ts"`
Run: `grep -rn "\.catch(() =>" src/ --include="*.ts"`

- [ ] **Step 2: Replace with logger.warn**

Replace `.catch(() => {})` with `.catch(e => logger.warn("description of what failed", e))`

Add logger import to files that don't have it.

- [ ] **Step 3: Verify build + commit**

```bash
npx tsc --noEmit
git add -u src/
git commit -m "fix: replace silent error swallowing with logger.warn"
```

---

### Task 11.5: Scan for duplicate code patterns

**Files:**
- Scan: all `src/` files

- [ ] **Step 1: Find duplicate patterns**

Run: `grep -rn "function sendMessage" src/ --include="*.ts"` — already resolved via messaging.ts.
Run: `grep -rn "randomSleep\|sleep(" src/ --include="*.ts" | sort` — check for duplicate utility definitions.
Run: `grep -rn "function waitFor" src/ --include="*.ts"` — check for duplicate wait/poll helpers.

- [ ] **Step 2: Fix any discovered duplicates**

If duplicates found, extract to shared modules. If no actionable duplicates beyond the already-resolved `sendMessageToTab`, document that in commit message.

- [ ] **Step 3: Commit**

```bash
git add -u src/
git commit -m "refactor: scan and clean duplicate code patterns (spec 3.4)"
```

---

### Task 12: Setup Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `src/__tests__/chrome-mock.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/chrome-mock.ts"],
    include: ["src/__tests__/**/*.test.ts"],
  },
  define: {
    "import.meta.env.DEV": "true",
  },
});
```

- [ ] **Step 3: Create chrome mock**

```typescript
// src/__tests__/chrome-mock.ts
const storage: Record<string, unknown> = {};

const chromeMock = {
  runtime: {
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: {
      get: (keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const k of keys) if (k in storage) result[k] = storage[k];
        return Promise.resolve(result);
      },
      set: (items: Record<string, unknown>) => {
        Object.assign(storage, items);
        return Promise.resolve();
      },
    },
  },
};

Object.defineProperty(globalThis, "chrome", { value: chromeMock, writable: true });
```

- [ ] **Step 4: Add test script to package.json**

Add to scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

- [ ] **Step 5: Verify setup**

Run: `npx vitest run` — should report 0 tests found, no errors.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/__tests__/chrome-mock.ts package.json package-lock.json
git commit -m "feat: add Vitest test infrastructure with chrome API mocks"
```

---

### Task 13: Test prompt-parser.ts

**Files:**
- Create: `src/__tests__/prompt-parser.test.ts`

Reference: `src/shared/prompt-parser.ts` — exports `parsePromptText(text: string): ParsedPrompt[]` and internal `splitFilenamePrompt`.

- [ ] **Step 1: Write tests**

```typescript
// src/__tests__/prompt-parser.test.ts
import { describe, it, expect } from "vitest";
import { parsePromptText } from "../shared/prompt-parser";

describe("parsePromptText", () => {
  // Happy path
  it("parses single line prompt", () => {
    const result = parsePromptText("一只橘猫");
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[0].filename).toBeUndefined();
  });

  it("parses multiple single-line prompts", () => {
    const result = parsePromptText("一只橘猫\n一只黑猫");
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe("一只橘猫");
    expect(result[1].prompt).toBe("一只黑猫");
  });

  it("parses filename, prompt format", () => {
    const result = parsePromptText("cat_orange, 一只橘猫在窗台上晒太阳");
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("cat_orange");
    expect(result[0].prompt).toBe("一只橘猫在窗台上晒太阳");
  });

  it("parses multi-line prompts separated by blank lines", () => {
    const text = "vi_001, 一只橘猫坐在窗台上\n阳光透过玻璃窗照射进来\n\nvi_002, 一只黑猫在月光下";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toContain("一只橘猫坐在窗台上");
    expect(result[0].prompt).toContain("阳光透过玻璃窗照射进来");
    expect(result[1].filename).toBe("vi_002");
  });

  // Comments
  it("ignores comment lines starting with #", () => {
    const result = parsePromptText("# 这是注释\ncat_01, 橘猫");
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("cat_01");
  });

  // Edge cases
  it("returns empty array for empty input", () => {
    expect(parsePromptText("")).toHaveLength(0);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parsePromptText("   \n\n  \n")).toHaveLength(0);
  });

  it("returns empty array for comment-only input", () => {
    expect(parsePromptText("# only comments\n# here")).toHaveLength(0);
  });

  it("trims whitespace from prompts", () => {
    const result = parsePromptText("  一只橘猫  ");
    expect(result[0].prompt).toBe("一只橘猫");
  });

  it("handles mixed comment and prompt lines", () => {
    const text = "# batch 1\ncat_01, 橘猫\n# batch 2\ncat_02, 黑猫";
    const result = parsePromptText(text);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/prompt-parser.test.ts`
Expected: All pass. Fix any failures based on actual parsePromptText behavior.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/prompt-parser.test.ts
git commit -m "test: add prompt-parser unit tests"
```

---

### Task 14: Test capability-guard.ts

**Files:**
- Create: `src/__tests__/capability-guard.test.ts`

Reference: `src/shared/capability-guard.ts` — exports `resolveCapabilities(task)` returning `CapabilityResolution`.

- [ ] **Step 1: Write tests**

```typescript
// src/__tests__/capability-guard.test.ts
import { describe, it, expect } from "vitest";
import { resolveCapabilities } from "../shared/capability-guard";
import type { TaskItem } from "../shared/types";

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "test-1",
    prompt: "test prompt",
    mode: "text-to-video",
    model: "veo3.1-quality",
    aspectRatio: "16:9",
    outputCount: 1,
    status: "waiting",
    retries: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("resolveCapabilities", () => {
  // Happy path — valid combinations
  it("accepts valid video task", () => {
    const res = resolveCapabilities(makeTask());
    expect(res.valid).toBe(true);
  });

  it("accepts valid image task", () => {
    const task = makeTask({ mode: "create-image", model: "imagen4" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
  });

  // Ingredients + non-Veo 3.1 Fast → auto-correct
  it("corrects Ingredients mode to Veo 3.1 Fast", () => {
    const task = makeTask({ mode: "ingredients", model: "veo3.1-quality" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
    expect(res.corrected?.model).toBe("veo3.1-fast");
  });

  // Jump To + 9:16 → auto-correct to 16:9
  it("corrects Jump To with 9:16 to 16:9", () => {
    const task = makeTask({ mode: "jump-to", aspectRatio: "9:16" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
    expect(res.corrected?.aspectRatio).toBe("16:9");
  });

  // Jump To + Veo 3.1 Fast → auto-correct to Quality
  it("corrects Jump To with Veo 3.1 Fast to Quality", () => {
    const task = makeTask({ mode: "jump-to", model: "veo3.1-fast" });
    const res = resolveCapabilities(task);
    expect(res.corrected?.model).toBe("veo3.1-quality");
  });

  // Video mode + image model → invalid
  it("rejects video mode with image model", () => {
    const task = makeTask({ mode: "text-to-video", model: "imagen4" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(false);
    expect(res.reason).toBeDefined();
  });

  // Extend + 9:16 → auto-correct to 16:9
  it("corrects Extend with 9:16 to 16:9", () => {
    const task = makeTask({ mode: "extend", aspectRatio: "9:16" });
    const res = resolveCapabilities(task);
    expect(res.corrected?.aspectRatio).toBe("16:9");
  });

  // Camera Control → Veo 3.1 Fast + landscape
  it("corrects Camera Control to Veo 3.1 Fast", () => {
    const task = makeTask({ mode: "camera-control", model: "veo3.1-quality" });
    const res = resolveCapabilities(task);
    expect(res.corrected?.model).toBe("veo3.1-fast");
  });

  // No correction needed → no corrected field
  it("returns no corrected field when no correction needed", () => {
    const res = resolveCapabilities(makeTask());
    expect(res.corrected).toBeUndefined();
  });
});
```

Note: Test cases may need adjustment based on actual model string values and mode types from `types.ts`. The test writer should read the type definitions first.

- [ ] **Step 2: Run tests and fix**

Run: `npx vitest run src/__tests__/capability-guard.test.ts`
Adjust test expectations to match actual behavior.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/capability-guard.test.ts
git commit -m "test: add capability-guard unit tests"
```

---

### Task 15: Test filename-utils.ts

**Files:**
- Create: `src/__tests__/filename-utils.test.ts`

Reference: `src/shared/filename-utils.ts` — exports `sanitizePathSegment`, `shortPrompt`, `buildProjectDir`, `buildTaskBaseName`.

- [ ] **Step 1: Write tests**

```typescript
// src/__tests__/filename-utils.test.ts
import { describe, it, expect } from "vitest";
import { sanitizePathSegment, shortPrompt, buildProjectDir, buildTaskBaseName } from "../shared/filename-utils";

describe("sanitizePathSegment", () => {
  it("passes through clean names", () => {
    expect(sanitizePathSegment("my-project")).toBe("my-project");
  });

  it("replaces invalid path characters", () => {
    const result = sanitizePathSegment("my/project:name");
    expect(result).not.toContain("/");
    expect(result).not.toContain(":");
  });

  it("trims whitespace", () => {
    expect(sanitizePathSegment("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    const result = sanitizePathSegment("");
    expect(typeof result).toBe("string");
  });

  it("truncates very long names", () => {
    const long = "a".repeat(300);
    expect(sanitizePathSegment(long).length).toBeLessThan(300);
  });
});

describe("shortPrompt", () => {
  it("returns short prompts unchanged", () => {
    expect(shortPrompt("hello world")).toBe("hello world");
  });

  it("truncates long prompts", () => {
    const long = "一".repeat(200);
    expect(shortPrompt(long).length).toBeLessThan(200);
  });
});

describe("buildProjectDir", () => {
  it("returns sanitized project name", () => {
    const result = buildProjectDir("My Project");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildTaskBaseName", () => {
  it("builds name from task properties", () => {
    const result = buildTaskBaseName({
      filename: "test_file",
      prompt: "一只橘猫",
    }, 1);
    expect(typeof result).toBe("string");
    expect(result).toContain("test_file");
    expect(result).toContain("__o01");
  });

  it("uses filename when provided", () => {
    const result = buildTaskBaseName({
      filename: "custom_name",
      prompt: "一只橘猫",
    }, 0);
    expect(result).toContain("custom_name");
    expect(result).toContain("__o00");
  });

  it("falls back to prompt when no filename", () => {
    const result = buildTaskBaseName({
      prompt: "一只橘猫在窗台上",
    }, 3);
    expect(result).toContain("__o03");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/filename-utils.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/filename-utils.test.ts
git commit -m "test: add filename-utils unit tests"
```

---

### Task 16: Test queue-engine.ts

**Files:**
- Create: `src/__tests__/queue-engine.test.ts`

Reference: `src/background/queue-engine.ts` — exports `addPrompts`, `markTaskRunning`, `markTaskSuccess`, `markTaskError`, `retryErrors`, `clearHistory`, `clearQueue`, `appendTaskLog`, `getQueue`.

This module uses `chrome.storage.local` for persistence — the mock from Task 12 handles this.

- [ ] **Step 1: Write tests**

```typescript
// src/__tests__/queue-engine.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// queue-engine uses module-level state — use dynamic import with resetModules
async function loadFreshModule() {
  vi.resetModules();
  return await import("../background/queue-engine");
}

describe("queue-engine", () => {
  it("addPrompts adds tasks to the queue", async () => {
    const qe = await loadFreshModule();
    const result = await qe.addPrompts([
      { prompt: "test prompt", mode: "text-to-video", model: "veo3.1-quality",
        aspectRatio: "16:9", outputCount: 1 },
    ]);
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks[0].status).toBe("waiting");
  });

  it("markTaskRunning changes status", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([
      { prompt: "test", mode: "text-to-video", model: "veo3.1-quality",
        aspectRatio: "16:9", outputCount: 1 },
    ]);
    const taskId = added.tasks[0].id;
    const result = await qe.markTaskRunning(taskId);
    expect(result.tasks[0].status).toBe("running");
  });

  it("markTaskError sets error message", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([
      { prompt: "test", mode: "text-to-video", model: "veo3.1-quality",
        aspectRatio: "16:9", outputCount: 1 },
    ]);
    const taskId = added.tasks[0].id;
    await qe.markTaskRunning(taskId);
    const result = await qe.markTaskError(taskId, "something broke");
    expect(result.tasks[0].status).toBe("error");
    expect(result.tasks[0].errorMessage).toBe("something broke");
  });

  it("appendTaskLog respects MAX_LOGS_PER_TASK limit", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([
      { prompt: "test", mode: "text-to-video", model: "veo3.1-quality",
        aspectRatio: "16:9", outputCount: 1 },
    ]);
    const taskId = added.tasks[0].id;
    // Add 35 logs — should be capped at LIMITS.MAX_LOGS_PER_TASK (30)
    for (let i = 0; i < 35; i++) {
      await qe.appendTaskLog(taskId, `log ${i}`);
    }
    const q = qe.getQueue();
    const task = q.tasks.find(t => t.id === taskId);
    expect(task?.logs?.length).toBeLessThanOrEqual(30);
  });

  it("retryErrors resets errored tasks to waiting", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([
      { prompt: "test", mode: "text-to-video", model: "veo3.1-quality",
        aspectRatio: "16:9", outputCount: 1 },
    ]);
    const taskId = added.tasks[0].id;
    await qe.markTaskRunning(taskId);
    await qe.markTaskError(taskId, "fail");
    const result = await qe.retryErrors();
    expect(result.tasks[0].status).toBe("waiting");
  });
});
```

Note: The test implementer should check actual function signatures from queue-engine.ts — `addPrompts` may require a `settings` parameter or different argument shape. Adjust accordingly.

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/queue-engine.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/queue-engine.test.ts
git commit -m "test: add queue-engine unit tests"
```

---

## Final Verification

### Task 17: Final build and test check

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Full build**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Final commit if needed**

- [ ] **Step 5: Verify no remaining tech debt markers**

Run: `grep -rn "as any" src/ --include="*.ts" | wc -l` — should be minimal
Run: `grep -rn "console\.\(log\|warn\|error\)" src/content/ --include="*.ts" | wc -l` — should be 0 or near-0
Run: `grep -rn "\.catch(() => {})" src/ --include="*.ts" | wc -l` — should be 0
