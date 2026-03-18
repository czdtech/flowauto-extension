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
  it("accepts valid video task", () => {
    const res = resolveCapabilities(makeTask());
    expect(res.valid).toBe(true);
  });

  it("accepts valid image task", () => {
    const task = makeTask({ mode: "create-image", model: "imagen4" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
  });

  it("corrects Ingredients mode to Veo 3.1 Fast", () => {
    const task = makeTask({ mode: "ingredients", model: "veo3.1-quality" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
    expect(res.corrected?.model).toBe("veo3.1-fast");
  });

  it("corrects Jump To with 9:16 to 16:9", () => {
    const task = makeTask({ mode: "jump-to", aspectRatio: "9:16" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(true);
    expect(res.corrected?.aspectRatio).toBe("16:9");
  });

  it("corrects Jump To with Veo 3.1 Fast to Quality", () => {
    const task = makeTask({ mode: "jump-to", model: "veo3.1-fast" });
    const res = resolveCapabilities(task);
    expect(res.corrected?.model).toBe("veo3.1-quality");
  });

  it("rejects video mode with image model", () => {
    const task = makeTask({ mode: "text-to-video", model: "imagen4" });
    const res = resolveCapabilities(task);
    expect(res.valid).toBe(false);
    expect(res.reason).toBeDefined();
  });

  it("corrects Extend with 9:16 to 16:9", () => {
    const task = makeTask({ mode: "extend", aspectRatio: "9:16" });
    const res = resolveCapabilities(task);
    expect(res.corrected?.aspectRatio).toBe("16:9");
  });

  it("corrects Camera Control to Veo 3.1 Fast", () => {
    const task = makeTask({
      mode: "camera-control",
      model: "veo3.1-quality",
    });
    const res = resolveCapabilities(task);
    expect(res.corrected?.model).toBe("veo3.1-fast");
  });

  it("returns no corrected field when no correction needed", () => {
    const res = resolveCapabilities(makeTask());
    expect(res.corrected).toBeUndefined();
  });

  it("provides warnings when corrections are made", () => {
    const task = makeTask({ mode: "ingredients", model: "veo3.1-quality" });
    const res = resolveCapabilities(task);
    expect(res.warnings).toBeDefined();
    expect(res.warnings!.length).toBeGreaterThan(0);
  });
});
