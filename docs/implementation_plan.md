# Image-to-X (Option B: Resource Pool + Linking) Implementation Plan

## Goal Description
Implement the new "Resource Pool + Linking" UI (Option B) to support complex 1-to-N, M-to-1, and M-to-N image-to-image/video generation scenarios. This provides maximum flexibility without compromising the minimal UI.

## User Review Required
> [!IMPORTANT]
> The DOM Injection viability (Phase 0 in the original doc) is fundamentally critical. Before spending heavy effort on the UI, we must ensure we can actually inject synthesized `File`/`Blob` objects into Flow's web interface via `DataTransfer` / Drop events or input hijacking.

## Proposed Changes

### 1. SidePanel UI Updates
We will introduce a new Tab structure in the SidePanel.

#### [NEW] `src/sidepanel/components/ImageToImageTab.svelte` (or equivalent)
- **Top Section: Resource Pool**: A drag-and-drop zone to upload images. Uploaded images are displayed as small thumbnails. Each thumbnail gets an internal short ID/UUID.
- **Bottom Section: Task Configurator**: A dynamic list of prompt input rows.
    - Each row contains a text input for the prompt.
    - Each row contains an attachment button (`📎`). Clicking it opens a small popover/modal to select which images from the Resource Pool should be linked to this specific prompt.
- **Action**: "Generate N Tasks" button at the bottom.

#### [MODIFY] `src/sidepanel/App.svelte` (or similar main container)
- Implement tab navigation: [Text-to-Image] | [Image-to-Image/Video] | [History]

### 2. Storage & State Management
#### [NEW] `src/utils/indexedDB.ts` (or use `localforage`)
- Functions to `saveImageBlob(id: string, blob: Blob)` and `getImageBlob(id: string)`.

#### [MODIFY] `src/background/queue-engine.ts`
- Extend TaskItem type to include `assets?: { refId: string, filename: string }[]`.

### 3. Content Script / DOM Injection
#### [MODIFY] `src/content/actions/generate.ts`
- When processing a task with `assets`, send a message to background to fetch the image Blob via `refId`.
- Reconstruct the `File` object.
- Locate the dropzone/upload input on the Flow page.
- Dispatch synthetic drag/drop events or set `HTMLInputElement.files` to inject the image before triggering the generate button.

## Verification Plan

### Automated/Unit Tests
- Verify IndexedDB wrappers successfully store and retrieve Blob data without memory leaks.

### Manual Verification
- **Scenario 1 (1 图 × N 词)**: Upload 1 image to pool, create 3 prompts, link the image to all 3. Verify exactly 3 tasks are queued and correctly inject the image on the web page.
- **Scenario 2 (M 图 × 1 词)**: Upload 3 images, create 1 prompt, link all 3 images. 
- **DOM Injection Test**: Provide a sample image blob to the content script locally and verify it successfully attaches to the Flow native UI.
