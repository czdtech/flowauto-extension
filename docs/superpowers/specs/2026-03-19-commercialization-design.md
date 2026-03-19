# FlowAuto Commercialization & Feature Parity Design

**Date:** 2026-03-19
**Status:** Reviewed (R1 — 21 issues addressed)
**Scope:** Feature parity with competitors + monetization system + Chrome Web Store launch

---

## 1. Context & Market Analysis

### 1.1 What is Google Flow?

Google Flow is Google Labs' AI filmmaking/creative tool at `labs.google/fx/tools/flow`. It generates images (Imagen 4, Nano Banana) and videos (Veo 3.1, Veo 2) from text prompts. As of Feb 2026, it has generated 1.5 billion images/videos. Gemini ecosystem has 750M+ MAU.

### 1.2 Competitive Landscape

10+ active Chrome extensions automate Google Flow. Market is fragmented, early-stage, no dominant player.

| Extension | Rating | Key Differentiator |
|---|---|---|
| AutoBoom | 4.1/5 | AI prompt rewriter, Chain Mode, Fast-Fire Mode |
| FlowForge Pro | 4.6/5 | Emergency download, video validation |
| AutoFlow (auto-flow.studio) | — | Dedicated website, Discord community |
| VEO Automation | 4.0/5 | Auto-chaining, no external servers |
| Auto Flow Pro | — | One-time license model |
| FlowEngine | 5.0/5 | Project management, auto-start queue |
| Flow Automator | 5.0/5 | Whisk-to-Flow pipeline |
| GLabs Automator | 4.2/5 | Multi-tool (Flow + Whisk + ImageFX + MusicFX) |

### 1.3 FlowAuto Current State (v0.1.0)

**Existing strengths:**
- M x N reference image x prompt combinations (unique, no competitor has this)
- SHA-256 reference image dedup + IndexedDB persistence with TTL/LRU eviction
- Model/mode/aspect compatibility auto-correction guard (unique)
- TypeScript strict + Vitest tests + structured logging (engineering quality advantage)
- Batch queue with pause/resume/skip/retry
- Auto-download with project folder grouping + resolution selection (720p-4K)
- File/folder import for prompts
- Partial failure auto-retry (3 rounds)

**Missing vs competitors:**
- No Chain Mode
- No Stealth/Slow Mode
- No notification integration (Telegram/Discord)
- No project management system (multi-project queues)
- No AI prompt rewriting
- No payment/monetization system
- Not published on Chrome Web Store

---

## 2. Pricing Model: Hybrid (Free / Pro / Pro+)

### 2.1 Tier Structure

| Feature | Free | Pro ($19 one-time) | Pro+ ($9.99/mo) |
|---|:---:|:---:|:---:|
| Daily generation limit | 30 tasks | Unlimited | Unlimited |
| Batch queue | Yes | Yes | Yes |
| Auto-download 720p | Yes | Yes | Yes |
| 4K download | No | Yes | Yes |
| Generation modes | 2 modes: `text-to-video`, `create-image` | All 12 modes | All 12 modes |
| Chain Mode | No | Yes | Yes |
| M x N reference combos | No | Yes | Yes |
| File/folder import | No | Yes | Yes |
| AI prompt (own API key) | No | Yes | Yes |
| AI prompt (proxy, no key needed) | No | No | Yes (500/mo) |
| Stealth/Slow Mode | No | No | Yes |
| Notification integration | No | No | Yes |
| Project management | 1 project | 3 projects | Unlimited |
| Priority support | No | No | Yes |

**Daily counter unit:** 1 task = 1 count, regardless of `outputCount` or retry rounds. A task with `outputCount: 4` that triggers 2 retry rounds still counts as 1.

**Existing feature downgrade note:** M x N combos and file/folder import currently work in v0.1.0 with no restrictions. After gating, free users lose these features. Mitigate by: (a) announcing the free tier limitations clearly before CWS launch, (b) considering a 30-day grace period for existing users.

**Clock manipulation:** Daily counter uses `dailyCount:{YYYY-MM-DD}` in `chrome.storage.local`. Users could reset by changing system clock. Acceptable for V1; honest users won't bother.

### 2.2 Payment Infrastructure

**Platform:** LemonSqueezy (handles payments, invoices, tax, subscriptions)

**License Key Verification (Activation-then-Cache model):**
1. User purchases on LemonSqueezy → receives a license key (LemonSqueezy's native format)
2. User pastes key into extension Settings → "Activate" button
3. Extension calls LemonSqueezy's `POST /v1/licenses/activate` API with the key
4. LemonSqueezy returns: `valid`, `license_key.status`, `meta` (we store tier in meta)
5. Extension caches the activation response in `chrome.storage.local`
6. Subsequent loads: check cached response. Re-validate against LemonSqueezy API every 7 days (Pro) or 30 days (Pro+)
7. If re-validation fails (expired/revoked): downgrade to free tier, show upgrade prompt

**Key delivery flow:** User manually copy-pastes the key from their LemonSqueezy purchase email into the extension settings. No `externally_connectable` needed.

**Anti-piracy note:** Determined crackers can patch the extension to skip validation. Acceptable for V1 — the goal is honest users paying, not DRM perfection. Upgrade to server-side enforcement in V2 if piracy exceeds 20% of user base.

---

## 3. New Feature Designs

### 3.1 Chain Mode

**Purpose:** Each generation's output automatically becomes the reference image for the next task. Creates visual consistency across a batch.

**Behavior:**
1. User enables "Chain Mode" toggle in TaskInput (queue-level setting)
2. After task N completes generation, content script calls `collectResultImageSrcs()` to get the first result's CDN URL
3. Content script fetches that URL as a blob, stores it in `image-store.ts` (IndexedDB) with a chain-specific key
4. Runner populates task N+1's `chainPreviousRefId` field with the stored blob's reference ID
5. `execute-task.ts` checks `chainPreviousRefId` and injects it as the reference image before generation
6. If task N produces multiple outputs, use the first one

**Data model changes:**
- `types.ts`: Add `chainMode: boolean` to `QueueSettings`
- `types.ts`: Add `chainPreviousRefId?: string` to `TaskItem`
- Runner: After task N succeeds, set `tasks[N+1].chainPreviousRefId = capturedRefId`

**Edge cases:**
- First task in chain: No reference image (user can optionally provide a seed image)
- Task failure: Clear `chainPreviousRefId` on next task → runs without reference. Log warning.
- Video mode: Capture thumbnail `<img>` src from the video tile in the result grid
- User adds tasks mid-chain: New tasks get `chainPreviousRefId = undefined`. Runner fills it when their predecessor completes.
- User reorders tasks: Reordering clears all `chainPreviousRefId` fields; runner repopulates sequentially.

**Integration points:**
- `execute-task.ts`: After download, call `collectResultImageSrcs()`, fetch first URL as blob, store in `image-store.ts`
- `runner.ts`: After task success, populate next task's `chainPreviousRefId`
- `inject-image.ts`: Accept `chainPreviousRefId` as reference source
- `TaskInput.svelte`: Add Chain Mode toggle

### 3.2 Stealth/Slow Mode

**Purpose:** Reduce automation detection risk by adding human-like timing randomization.

**Behavior:**
- All intra-task delays multiplied by a random factor: `base_delay * (1.5 + Math.random() * 1.5)`
- Result: delays range from 1.5x to 3.0x normal speed
- Additional random pauses (500-2000ms) at these specific injection points:
  1. Between mode/model selection and prompt fill
  2. Between prompt fill and generate button click
  3. Between generation complete and download initiation
- Total slowdown cap: max 4x normal task duration (if combined multiplier + pauses exceed 4x, clamp)

**Architecture note:** Delays are applied in the **content script** (`execute-task.ts`, `generate.ts`) where `randomSleep()` is called — NOT in `runner.ts`. The stealth flag must be passed to the content script via the `ExecuteTaskRequest` message payload.

**Integration points:**
- `types.ts`: Add `stealthMode: boolean` to `Settings`
- `shared/config.ts`: Add `STEALTH_MULTIPLIER_MIN = 1.5`, `STEALTH_MULTIPLIER_MAX = 3.0`, `STEALTH_PAUSE_MIN = 500`, `STEALTH_PAUSE_MAX = 2000`
- `content/actions/execute-task.ts`: Read stealth flag from task request, apply multiplier to all `randomSleep()` calls
- `content/actions/generate.ts`: Same — apply multiplier to polling intervals
- `runner.ts`: Also apply multiplier to `interTaskDelayMs` between tasks
- `SettingsPanel.svelte`: Add Stealth Mode toggle

### 3.3 Notification Integration

**Purpose:** Alert user when batch completes or errors occur, for unattended operation.

**Supported platforms:**
- **Telegram:** User provides Bot Token + Chat ID
- **Discord:** User provides Webhook URL

**Behavior:**
- Triggered on: queue fully completed, task error (configurable)
- Message includes: project name, total/success/error counts, elapsed time
- Sent from background service worker via `fetch()`

**Integration points:**
- New file: `src/background/notifier.ts`
  - `sendTelegram(token, chatId, message): Promise<void>`
  - `sendDiscord(webhookUrl, message): Promise<void>`
- `runner.ts`: Call notifier on queue completion/error
- `SettingsPanel.svelte`: Notification config section (provider, credentials, triggers)
- `types.ts`: Add notification settings to `Settings`

**Manifest changes required:** Add `https://api.telegram.org/*` and `https://discord.com/api/webhooks/*` to `host_permissions` in `manifest.json`. Without this, `fetch()` from the service worker will fail with CORS errors.

### 3.4 Project Management System

**Purpose:** Support multiple independent project queues with their own settings and history.

**Current state:** Single queue stored in `chrome.storage.local` under flat keys.

**New design:**
```
chrome.storage.local:
  projects: ["project-uuid-1", "project-uuid-2", ...]
  activeProject: "project-uuid-1"
  project:{uuid}:queue: Task[]
  project:{uuid}:settings: Settings
  project:{uuid}:stats: { totalGenerated, totalDownloaded, ... }
```

**Behavior:**
- Project list in sidebar with add/rename/delete/switch
- Each project has independent queue, settings, download folder
- Active project indicator in StatusHeader
- Project stats: total generated, success rate, history

**Integration points:**
- `queue-engine.ts`: Refactor storage keys to be project-scoped
- `runner.ts`: Operate on active project's queue
- New component: `ProjectSidebar.svelte` or extend `StatusHeader.svelte`
- `types.ts`: Add `Project` type with `id, name, createdAt`

**Migration:** On first load after update, wrap existing queue/settings into a default project. Migration must: (a) pause any running queue first, (b) read all old keys, (c) write new project-scoped keys, (d) delete old keys only after new keys are confirmed written. Design storage schema with feature-gating in mind (store user tier alongside project data).

**Storage quota:** `chrome.storage.local` has a 10MB total quota. With multiple projects + task logs, storage pressure is real. Mitigations:
- Monitor `chrome.storage.local.getBytesInUse()` and warn at 80%
- Truncate completed task logs (keep last 50 per project)
- Archive/delete completed tasks older than 30 days

### 3.5 AI Prompt Engine

**Purpose:** AI-powered prompt enhancement, violation rewriting, and batch variant generation.

**Three capabilities:**

| Capability | Input | Output | Trigger |
|---|---|---|---|
| Enhance | Rough description | Detailed prompt | Manual "AI Enhance" button |
| Rewrite | Failed prompt + error | Modified prompt | Auto on generation failure |
| Variants | Single prompt + count N | N prompt variations | Manual "Generate Variants" |

**Architecture:**

```
AI Provider Adapter (src/shared/ai-provider.ts)
├── OpenAIProvider   (user's API key)
├── GeminiProvider   (user's API key)
└── ProxyProvider    (our backend API, Pro+ only)

Common interface:
  enhance(prompt: string): Promise<string>
  rewrite(prompt: string, error: string): Promise<string>
  variants(prompt: string, count: number): Promise<string[]>
```

**Provider selection:**
- Pro+ users: Default to ProxyProvider (no config needed). Fallback to user's key if proxy quota exhausted.
- Pro users: Must configure own API key in Settings.
- Free users: AI features disabled.

**Proxy backend (Pro+ only):**
- Minimal API: `POST /api/ai/{enhance,rewrite,variants}`
- Auth: License Key in header
- Rate limit: 500 calls/month per Pro+ user
- Backend: Cloudflare Worker or Vercel Edge Function (minimal cost)
- LLM: Route to cheapest adequate model (gpt-4o-mini or gemini-flash)

**Integration points:**
- New: `src/shared/ai-provider.ts` (adapter + providers)
- `TaskInput.svelte`: "AI Enhance" and "Generate Variants" buttons
- `runner.ts`: On generation failure, attempt AI rewrite before marking error
- `SettingsPanel.svelte`: AI provider config (provider, API key, model)
- `types.ts`: AI settings in Settings type

---

## 4. Feature Gate System

### 4.1 Design

```typescript
// src/shared/feature-gate.ts

type Tier = 'free' | 'pro' | 'pro_plus';

interface FeatureGate {
  isEnabled(feature: Feature, tier: Tier): boolean;
  getDailyLimit(tier: Tier): number;
  getProjectLimit(tier: Tier): number;
  getAiQuota(tier: Tier): number;
}

type Feature =
  | 'download_4k'
  | 'all_modes'
  | 'chain_mode'
  | 'mxn_combos'
  | 'file_import'
  | 'ai_own_key'
  | 'ai_proxy'
  | 'stealth_mode'
  | 'notifications'
  | 'priority_support';
```

### 4.2 Enforcement Points

| Check | Location | Behavior on limit |
|---|---|---|
| Daily generation limit | `runner.ts` before task execution | Show upgrade prompt, skip task |
| Feature availability | UI components | Disable control + show lock icon |
| Project count | `ProjectSidebar` on create | Show upgrade prompt |
| AI proxy quota | `ProxyProvider` response | Fallback to "add API key" prompt |

### 4.3 Daily Counter

- Stored in `chrome.storage.local` as `dailyCount:{YYYY-MM-DD}`: number
- Incremented in `runner.ts` after each successful task (1 task = 1 count)
- Resets at midnight local time (checked on task start)

### 4.4 AI Proxy Quota Counter

- Monthly AI quota is enforced **server-side** by the proxy backend
- Proxy identifies user by License Key in request header
- Proxy tracks usage per key per calendar month
- Proxy returns remaining quota in response header: `X-AI-Quota-Remaining: 487`
- Extension displays remaining quota in Settings panel

### 4.5 Tier Data Flow

User tier must be accessible across all three extension components:

1. **Storage:** `chrome.storage.local` key `license` stores `{ tier, activatedAt, expiresAt, lastValidated }`
2. **Background:** Reads tier on init, re-reads on `chrome.storage.onChanged`
3. **Side Panel:** Reads tier via `chrome.storage.local.get('license')` on mount
4. **Content Script:** Receives stealth flag via `ExecuteTaskRequest` message payload (no direct tier access needed — background pre-gates features before dispatching tasks)

---

## 5. Chrome Web Store Launch

### 5.1 CWS Policy Compliance (Critical Risk)

The extension automates Google's own service — this is the highest-risk area for CWS rejection. Multiple Flow automation extensions have been removed.

**Policy review checklist:**
- [ ] **Single Purpose policy**: Extension has a clear single purpose (automate Flow generation). Description must frame it as "productivity tool for batch content creation" not "bot."
- [ ] **User Data policy**: Extension stores API keys (OpenAI/Gemini) and notification credentials (Telegram/Discord). Privacy policy must disclose this. Keys must never leave the device (except API calls to their intended services).
- [ ] **No remote code**: All logic runs locally. AI proxy calls are data API calls, not code execution.
- [ ] **Permission justification**: Each permission must be justified in CWS submission:
  - `storage`: Queue persistence
  - `downloads`: Auto-download generated content
  - `tabs`/`activeTab`: Detect active Flow tab
  - `sidePanel`: Main UI
  - `scripting`: Content script injection
  - `host_permissions` for `labs.google/*`: DOM automation
  - `host_permissions` for `api.telegram.org/*`, `discord.com/api/webhooks/*`: Notification delivery

**Contingency if CWS rejects:**
1. Self-distribution via landing page (.crx download + manual sideloading instructions)
2. Appeal with precedent: cite existing Flow automation extensions still listed
3. Reframe description to emphasize "enhancement" not "automation"

### 5.2 Other Requirements

- [ ] Privacy policy page (hosted on landing page)
- [ ] Extension screenshots (5+) and promotional images
- [ ] Store description (localized: EN + ZH)
- [ ] CWS developer account ($5 one-time)

### 5.3 Landing Page

- Purpose: Payment portal + documentation + marketing
- Sections: Features, Pricing, FAQ, Download, Docs
- Payment: LemonSqueezy checkout embed
- Hosting: Vercel/Netlify (free tier sufficient)

---

## 6. Development Phases

| Phase | Content | Dependencies | Effort |
|---|---|---|---|
| **P1: Core Feature Parity** | Chain Mode + Stealth Mode | None | M |
| **P2: Project Management** | Multi-project queues + storage migration | None | L |
| **P3: AI Prompt Engine** | Provider adapter + 3 capabilities + Settings UI | None | L |
| **P4: Notifications + Polish** | Telegram/Discord + manifest changes + UI refinements | None | S |
| **P5: Payment System** | Feature Gate + License activation + LemonSqueezy | P1-P4 | L |
| **P6: Pro+ Backend** | AI proxy API (Cloudflare Worker) + rate limiting | P3, P5 | M |
| **P7: Launch** | CWS submission + Landing Page + marketing materials | P5 | M |

Effort: S = days, M = ~1 week, L = 1-2 weeks.

P1-P4 are independent and can be parallelized.
P5 depends on all features being done (to gate them correctly).
P6 depends on AI engine (P3) and payment (P5).
P7 is the final gate.

---

## 7. Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Google changes Flow DOM structure | All automation breaks | Robust selectors (existing), structured logging for fast debugging, rapid patch cycle |
| Google adds native batch generation | Core value proposition reduced | Differentiate on AI, project management, notifications — features Google won't add |
| **Google shuts down Flow** (Labs experiment) | **Existential** | Monitor Google Labs status; if Flow graduates to stable product, risk decreases. If deprecated, pivot to other AI tools (Midjourney, Runway, etc.) |
| License key cracking | Revenue loss | Accept for V1; upgrade to server-side verification in V2 if needed |
| LLM API costs exceed expectations | Pro+ unprofitable | Hard quota (500/mo), cheapest models (mini/flash), monitoring |
| **CWS policy rejection** | **Launch blocked** | See Section 5.1 for detailed compliance checklist and contingency plan |
| **MV3 service worker suspension** | Queue stops mid-run | Use `chrome.alarms` API to periodically wake the service worker (every 25s) and check if runner should be active. This is especially critical with stealth mode's longer delays. |
| **Storage quota exhaustion** (10MB limit) | Data loss, extension failure | Monitor `getBytesInUse()`, truncate old task logs, archive completed tasks (see Section 3.4) |

---

## 8. Success Metrics

| Metric | Target (3mo post-launch) |
|---|---|
| CWS installs | 1,000+ |
| CWS rating | 4.5+ |
| Pro conversions | 5-10% of installs |
| Pro+ conversions | 1-3% of installs |
| Monthly recurring revenue | $500+ (Pro+ subscribers) |
| One-time revenue | $1,000+ (Pro licenses) |

---

## 9. Out of Scope (for now)

- Whisk-to-Flow pipeline (can add later)
- Multi-tool support (MusicFX, ImageFX — Flow only for now)
- Mobile support (Flow is desktop Chrome only)
- Team/enterprise tier
- Analytics dashboard
- Browser extension for non-Chrome browsers
