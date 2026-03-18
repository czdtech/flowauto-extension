import { describe, it, expect, vi, beforeEach } from "vitest";

async function loadFreshModule() {
  vi.resetModules();
  return await import("../background/queue-engine");
}

describe("queue-engine", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("addPrompts adds tasks to the queue", async () => {
    const qe = await loadFreshModule();
    const result = await qe.addPrompts([
      { prompt: "test prompt" },
    ]);
    expect(result.queue.tasks.length).toBe(1);
    expect(result.queue.tasks[0].status).toBe("waiting");
    expect(result.queue.tasks[0].prompt).toBe("test prompt");
  });

  it("addPrompts skips tasks rejected by capability guard", async () => {
    const qe = await loadFreshModule();
    // imagen4 model + text-to-video mode should be rejected
    const result = await qe.addPrompts(
      [{ prompt: "test" }],
      "text-to-video",
    );
    // Default model is nano-banana-2 (image model), which conflicts with video mode
    const task = result.queue.tasks[0];
    expect(task.status).toBe("skipped");
    expect(task.errorMessage).toBeDefined();
  });

  it("markTaskRunning changes status", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    const result = await qe.markTaskRunning(taskId);
    const task = result.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task?.status).toBe("running");
    expect(task?.startedAt).toBeDefined();
  });

  it("markTaskSuccess sets completedAt", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    await qe.markTaskRunning(taskId);
    const result = await qe.markTaskSuccess(taskId);
    const task = result.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task?.status).toBe("success");
    expect(task?.completedAt).toBeDefined();
  });

  it("markTaskError sets error message", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    await qe.markTaskRunning(taskId);
    const result = await qe.markTaskError(taskId, "something broke");
    const task = result.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task?.status).toBe("error");
    expect(task?.errorMessage).toBe("something broke");
  });

  it("retryErrors resets errored tasks to waiting", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    await qe.markTaskRunning(taskId);
    await qe.markTaskError(taskId, "fail");
    const result = await qe.retryErrors();
    const task = result.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task?.status).toBe("waiting");
    expect(task?.errorMessage).toBeUndefined();
  });

  it("appendTaskLog adds log entries", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    await qe.appendTaskLog(taskId, "hello");
    const state = await qe.getAppState();
    const task = state.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    // Should have creation log + our log
    expect(task?.logs?.length).toBeGreaterThanOrEqual(2);
    expect(task?.logs?.at(-1)?.msg).toBe("hello");
  });

  it("appendTaskLog caps at MAX_LOGS_PER_TASK", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([{ prompt: "test" }]);
    const taskId = added.queue.tasks[0].id;
    for (let i = 0; i < 35; i++) {
      await qe.appendTaskLog(taskId, `log ${i}`);
    }
    const state = await qe.getAppState();
    const task = state.queue.tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task?.logs?.length).toBeLessThanOrEqual(30);
  });

  it("clearHistory removes completed tasks", async () => {
    const qe = await loadFreshModule();
    const added = await qe.addPrompts([
      { prompt: "task1" },
      { prompt: "task2" },
    ]);
    const id1 = added.queue.tasks[0].id;
    await qe.markTaskRunning(id1);
    await qe.markTaskSuccess(id1);
    const result = await qe.clearHistory();
    // task1 (success) should be removed, task2 (waiting) should remain
    expect(result.queue.tasks.length).toBe(1);
    expect(result.queue.tasks[0].prompt).toBe("task2");
  });

  it("clearQueue removes all tasks", async () => {
    const qe = await loadFreshModule();
    await qe.addPrompts([
      { prompt: "task1" },
      { prompt: "task2" },
    ]);
    const result = await qe.clearQueue();
    // clearQueue wipes everything
    expect(result.queue.tasks.length).toBe(0);
  });
});
