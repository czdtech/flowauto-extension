# FlowAuto Extension — Tech Debt Optimization Design

**Date:** 2026-03-19
**Status:** Approved
**Scope:** All P0-P3 items from quality analysis report

---

## Context

A prior refactoring session created `config.ts`, `logger.ts`, `messaging.ts`, and split `App.svelte` into 4 sub-components. The work was ~70% complete with **7 TypeScript compilation errors blocking the build**. This design covers completing that work and addressing all remaining tech debt.

## Phase 1: Restore Build

### 1.1 Rewrite logger.ts
- Replace `enum LogLevel` with `const LogLevel` object + type union (satisfies `erasableSyntaxOnly`)
- Replace `process.env` with `import.meta.env.DEV` (Vite built-in)
- Remove `require()` references, use chrome.runtime API
- Keep public API unchanged: `logger.debug/info/warn/error` + `logger.forTask()`

### 1.2 Clean Unused Imports
- `background/index.ts`: remove unused `TIMEOUTS` import; use `logger` to replace bare `console.*`
- `background/runner.ts`: replace hardcoded `30 * 60 * 1000` (line 111) with `TIMEOUTS.TASK_EXECUTION`; use `logger`

### 1.3 Complete Constant Migration
**execute-task.ts:**
- Line 338 `MAX_GENERATION_ATTEMPTS = 3` → `LIMITS.MAX_GENERATION_ATTEMPTS`
- Line 47 timeout values → `TIMEOUTS.GENERATION_IMAGE` / `TIMEOUTS.GENERATION_VIDEO`
- Lines 413/431/445/479 hardcoded `randomSleep` → add `TIMING.RETRY_PAUSE` etc.
- Remove duplicate local `taskLog()` function, use shared logger

**download.ts:**
- Line 15 `MIN_RESULT_PX = 80` → `DOWNLOAD.MIN_RESULT_DIMENSION_PX`

**Success criteria:** `tsc && vite build` passes clean.

## Phase 2: Type Safety (P0)

### 2.1 Eliminate `as any`
- Create `src/shared/chrome-types.d.ts` for missing chrome API types (`chrome.sidePanel`)
- Fix remaining `as any` casts with proper types or explicit `// @ts-expect-error` where chrome types are genuinely missing
- Principle: no fake type safety — prefer honest `@ts-expect-error` over `as any`

## Phase 3: Robustness (P1-P2)

### 3.1 DOM Selector Consolidation (P1)
- Move inline selectors from `download.ts`, `inject-image.ts` etc. into `selectors.ts`
- No "version management" or external config (YAGNI)

### 3.2 Log Level Completion (P2)
- Replace `console.log("[FlowAuto Debug]...")` with `logger.debug()` across content scripts
- Replace `console.warn("[FlowAuto] ⚠️...")` with `logger.warn()`
- Production: DEBUG auto-silenced via `import.meta.env.DEV`

### 3.3 Magic Number Elimination (P2)
- Scan all remaining files for hardcoded timing/limit values
- `generate.ts` timeouts → TIMEOUTS
- `inject-image.ts` waits → TIMING
- `queue-engine.ts` MAX_LOGS_PER_TASK → LIMITS

### 3.4 Duplicate Code Cleanup (P3)
- `sendMessageToTab` duplication already resolved via `messaging.ts`
- Scan for other duplicate patterns

### 3.5 Error Handling (Report 4.8)
- `.catch(() => {})` → `.catch(e => logger.warn("cleanup failed", e))`

## Phase 4: Testability (P3)

### 4.1 Setup
- Add Vitest (zero-config with existing Vite setup)
- Create `src/__tests__/chrome-mock.ts` for minimal chrome API stubs
- Configure `vitest.config.ts` with `setupFiles`

### 4.2 Test Priority

| Module | Type | Rationale |
|--------|------|-----------|
| `prompt-parser.ts` | Unit | Pure function, multi-format parsing, highest value |
| `capability-guard.ts` | Unit | Complex rule combinations, regression risk |
| `filename-utils.ts` | Unit | Pure function, simple coverage |
| `queue-engine.ts` | Unit | State core, needs chrome.storage mock |

### 4.3 Coverage per Module
- Happy path (all normal use cases)
- Edge cases (empty input, boundary values, max limits)
- Error scenarios (invalid format, illegal parameters)

### 4.4 Excluded
- No E2E tests for `download.ts` / `execute-task.ts` (deep DOM/Flow page dependency, mock cost > benefit)

## Files Changed (Expected)

**New:**
- `src/shared/chrome-types.d.ts`
- `src/__tests__/chrome-mock.ts`
- `vitest.config.ts`
- `src/__tests__/prompt-parser.test.ts`
- `src/__tests__/capability-guard.test.ts`
- `src/__tests__/filename-utils.test.ts`
- `src/__tests__/queue-engine.test.ts`

**Rewritten:**
- `src/shared/logger.ts`

**Modified:**
- `src/background/index.ts`
- `src/background/runner.ts`
- `src/content/actions/execute-task.ts`
- `src/content/actions/download.ts`
- `src/content/actions/generate.ts`
- `src/content/actions/inject-image.ts`
- `src/content/selectors.ts`
- `src/background/queue-engine.ts`
- `package.json` (add vitest dev dependency)

## Risks

1. **logger.ts rewrite** may break callers if public API changes — mitigated by keeping same interface
2. **Selector consolidation** needs careful grep to find all inline selectors
3. **Chrome API type declarations** may be incomplete — use `@ts-expect-error` as escape hatch
