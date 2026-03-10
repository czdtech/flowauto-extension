# FlowAuto Extension - Image-to-Image / Image-to-Video Batch Generation Task

## Objective
Implement a "Resource Pool + Drag/Link (Option B)" UI in a new tab to support complex M×N (Multi-Image × Multi-Prompt) batch generation workflows.

## Checklist

- [x] **Phase 1: Planning and Architecture**
  - [x] Draft implementation plan for Option B UI and underlying architecture.
  - [x] Get user consensus on the plan.
- [ ] **Phase 2: UI Implementation (SidePanel)**
  - [ ] Add new tab "参考图生图/视频" (Image-to-Image/Video) in the SidePanel.
  - [ ] Build the "Resource Pool" component (upload, preview, delete images).
  - [ ] Build the "Prompt List" component (add rows, input prompt text).
  - [ ] Implement the linking mechanism (attach specific images from the pool to specific prompts).
- [ ] **Phase 3: State Management & Storage**
  - [ ] Integrate IndexedDB (e.g., localforage) to store image Blobs.
  - [ ] Generate unique references (refIds) for stored images.
- [ ] **Phase 4: Execution Engine Update**
  - [ ] Update background/queue-engine to accept `assets` in TaskItems.
  - [ ] Content Script logic to fetch Blob via IDB/Background just-in-time.
  - [ ] Implement DOM Injection (Action Simulator) to drop/upload the image `File` object into the target webpage.
- [ ] **Phase 5: Verification & Cleanup**
  - [ ] Test various M×N mapping scenarios.
  - [ ] Implement garbage collection to clear IndexedDB when tasks finish or history is cleared.
