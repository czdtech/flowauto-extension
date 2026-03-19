import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBackingStore } from "./chrome-mock";
import { STORAGE_KEYS } from "../shared/config";
import type { QueueState, UserSettings, Project } from "../shared/types";
import { DEFAULT_QUEUE_STATE, DEFAULT_SETTINGS } from "../shared/types";

async function loadFreshModule() {
  vi.resetModules();
  return await import("../background/queue-engine");
}

describe("project management", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── CRUD ──

  describe("createProject", () => {
    it("creates a project with a unique id and name", async () => {
      const qe = await loadFreshModule();
      const project = await qe.createProject("My Project");
      expect(project.id).toBeTruthy();
      expect(project.name).toBe("My Project");
      expect(project.createdAt).toBeGreaterThan(0);
    });

    it("adds the project to the projects list in storage", async () => {
      const qe = await loadFreshModule();
      await qe.createProject("Alpha");
      await qe.createProject("Beta");
      const projects = await qe.listProjects();
      expect(projects.length).toBe(3); // default + Alpha + Beta
      expect(projects.map((p: Project) => p.name)).toContain("Alpha");
      expect(projects.map((p: Project) => p.name)).toContain("Beta");
    });
  });

  describe("listProjects", () => {
    it("returns at least the default project after initialization", async () => {
      const qe = await loadFreshModule();
      const projects = await qe.listProjects();
      expect(projects.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("renameProject", () => {
    it("renames an existing project", async () => {
      const qe = await loadFreshModule();
      const project = await qe.createProject("Old Name");
      await qe.renameProject(project.id, "New Name");
      const projects = await qe.listProjects();
      const found = projects.find((p: Project) => p.id === project.id);
      expect(found?.name).toBe("New Name");
    });

    it("throws if project does not exist", async () => {
      const qe = await loadFreshModule();
      await expect(qe.renameProject("nonexistent", "X")).rejects.toThrow();
    });
  });

  describe("deleteProject", () => {
    it("removes project from the list", async () => {
      const qe = await loadFreshModule();
      const project = await qe.createProject("Temp");
      const beforeCount = (await qe.listProjects()).length;
      await qe.deleteProject(project.id);
      const afterCount = (await qe.listProjects()).length;
      expect(afterCount).toBe(beforeCount - 1);
    });

    it("cleans up project-scoped storage keys", async () => {
      const qe = await loadFreshModule();
      const project = await qe.createProject("Temp");
      // Switch to it so it gets queue/settings keys written
      await qe.switchProject(project.id);
      await qe.addPrompts([{ prompt: "test task" }]);
      // Delete it
      await qe.deleteProject(project.id);
      const store = getBackingStore();
      expect(store[STORAGE_KEYS.projectQueue(project.id)]).toBeUndefined();
      expect(store[STORAGE_KEYS.projectSettings(project.id)]).toBeUndefined();
    });

    it("cannot delete the last project", async () => {
      const qe = await loadFreshModule();
      const projects = await qe.listProjects();
      // Should have exactly one (default)
      expect(projects.length).toBe(1);
      await expect(qe.deleteProject(projects[0].id)).rejects.toThrow();
    });

    it("switches to another project if active project is deleted", async () => {
      const qe = await loadFreshModule();
      const p2 = await qe.createProject("Second");
      await qe.switchProject(p2.id);
      const activeBeforeDelete = await qe.getActiveProjectId();
      expect(activeBeforeDelete).toBe(p2.id);
      await qe.deleteProject(p2.id);
      const activeAfterDelete = await qe.getActiveProjectId();
      expect(activeAfterDelete).not.toBe(p2.id);
    });
  });

  // ── Migration ──

  describe("migration from legacy keys", () => {
    it("migrates legacy flat keys into a default project", async () => {
      const store = getBackingStore();
      const legacyQueue: QueueState = {
        tasks: [
          {
            id: "legacy-1",
            prompt: "legacy prompt",
            mode: "create-image",
            model: "nano-banana-2",
            aspectRatio: "9:16",
            outputCount: 1,
            status: "waiting",
            retries: 0,
            maxRetries: 0,
            createdAt: Date.now(),
          },
        ],
        isRunning: false,
        projectName: "My Old Project",
      };
      const legacySettings: UserSettings = {
        ...DEFAULT_SETTINGS,
        interTaskDelayMs: 9999,
      };
      store[STORAGE_KEYS.LEGACY_QUEUE] = legacyQueue;
      store[STORAGE_KEYS.LEGACY_SETTINGS] = legacySettings;

      const qe = await loadFreshModule();
      // ensureInitialized is called by getAppState
      const state = await qe.getAppState();
      // Legacy data should be migrated
      expect(state.queue.tasks.length).toBe(1);
      expect(state.queue.tasks[0].prompt).toBe("legacy prompt");
      expect(state.settings.interTaskDelayMs).toBe(9999);
      // Legacy keys should be removed
      expect(store[STORAGE_KEYS.LEGACY_QUEUE]).toBeUndefined();
      expect(store[STORAGE_KEYS.LEGACY_SETTINGS]).toBeUndefined();
    });

    it("creates a default project named from legacy projectName", async () => {
      const store = getBackingStore();
      store[STORAGE_KEYS.LEGACY_QUEUE] = {
        ...DEFAULT_QUEUE_STATE,
        projectName: "My Legacy Name",
      };
      store[STORAGE_KEYS.LEGACY_SETTINGS] = DEFAULT_SETTINGS;

      const qe = await loadFreshModule();
      await qe.ensureInitialized();
      const projects = await qe.listProjects();
      expect(projects.some((p: Project) => p.name === "My Legacy Name")).toBe(true);
    });

    it("works cleanly when no legacy data exists (fresh install)", async () => {
      const qe = await loadFreshModule();
      const state = await qe.getAppState();
      expect(state.queue.tasks).toEqual([]);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      const projects = await qe.listProjects();
      expect(projects.length).toBe(1);
      expect(projects[0].name).toBe("默认项目");
    });
  });

  // ── Project switching ──

  describe("switchProject", () => {
    it("preserves independent queues per project", async () => {
      const qe = await loadFreshModule();

      // Get default project
      const defaultId = await qe.getActiveProjectId();

      // Add tasks to default project
      await qe.addPrompts([{ prompt: "default task" }]);
      let state = await qe.getAppState();
      expect(state.queue.tasks.length).toBe(1);

      // Create and switch to new project
      const p2 = await qe.createProject("Project 2");
      await qe.switchProject(p2.id);

      // New project should have empty queue
      state = await qe.getAppState();
      expect(state.queue.tasks.length).toBe(0);

      // Add tasks to project 2
      await qe.addPrompts([{ prompt: "p2 task 1" }, { prompt: "p2 task 2" }]);
      state = await qe.getAppState();
      expect(state.queue.tasks.length).toBe(2);

      // Switch back to default
      await qe.switchProject(defaultId);
      state = await qe.getAppState();
      expect(state.queue.tasks.length).toBe(1);
      expect(state.queue.tasks[0].prompt).toBe("default task");
    });

    it("preserves independent settings per project", async () => {
      const qe = await loadFreshModule();
      const defaultId = await qe.getActiveProjectId();

      // Modify default project settings
      await qe.updateSettings({ interTaskDelayMs: 1234 });

      // Create and switch to new project
      const p2 = await qe.createProject("Project 2");
      await qe.switchProject(p2.id);

      // New project should have default settings
      let state = await qe.getAppState();
      expect(state.settings.interTaskDelayMs).toBe(DEFAULT_SETTINGS.interTaskDelayMs);

      // Modify p2 settings
      await qe.updateSettings({ interTaskDelayMs: 5678 });

      // Switch back to default
      await qe.switchProject(defaultId);
      state = await qe.getAppState();
      expect(state.settings.interTaskDelayMs).toBe(1234);
    });

    it("refuses to switch while queue is running", async () => {
      const qe = await loadFreshModule();
      const p2 = await qe.createProject("Project 2");
      await qe.setRunning(true);
      await expect(qe.switchProject(p2.id)).rejects.toThrow();
      await qe.setRunning(false); // cleanup
    });
  });

  // ── Storage quota ──

  describe("storage quota monitoring", () => {
    it("getStorageUsage returns bytes used", async () => {
      const qe = await loadFreshModule();
      const usage = await qe.getStorageUsage();
      expect(typeof usage.bytesUsed).toBe("number");
      expect(typeof usage.quota).toBe("number");
      expect(usage.quota).toBe(10 * 1024 * 1024);
    });

    it("isQuotaWarning returns false when usage is low", async () => {
      const qe = await loadFreshModule();
      const usage = await qe.getStorageUsage();
      expect(usage.warning).toBe(false);
    });
  });

  // ── getActiveProjectId ──

  describe("getActiveProjectId", () => {
    it("returns the active project id", async () => {
      const qe = await loadFreshModule();
      const id = await qe.getActiveProjectId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });
});
