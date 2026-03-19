import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../__tests__/chrome-mock';
import { DEFAULT_SETTINGS } from '../shared/types';

// Reset queue-engine module state between tests
let QueueEngine: typeof import('../background/queue-engine');

describe('chain mode types', () => {
  it('should default chainMode to false', () => {
    expect(DEFAULT_SETTINGS.chainMode).toBe(false);
  });
});

describe('chain propagation in queue', () => {
  beforeEach(async () => {
    vi.resetModules();
    QueueEngine = await import('../background/queue-engine');
    await QueueEngine.clearQueue();
  });

  it('should set chainPreviousRefId on specified task', async () => {
    await QueueEngine.addPrompts([
      { prompt: 'task1' },
      { prompt: 'task2' },
    ]);
    const { queue } = await QueueEngine.getAppState();
    const task2 = queue.tasks[1];

    await QueueEngine.setChainRef(task2.id, 'chain-ref-123');

    const { queue: updated } = await QueueEngine.getAppState();
    expect(updated.tasks[1].chainPreviousRefId).toBe('chain-ref-123');
    expect(updated.tasks[0].chainPreviousRefId).toBeUndefined();
  });

  it('should not crash when setting chain ref on non-existent task', async () => {
    await QueueEngine.setChainRef('nonexistent', 'ref-abc');
    const { queue } = await QueueEngine.getAppState();
    expect(queue.tasks).toHaveLength(0);
  });

  it('should preserve chainPreviousRefId through getNextWaitingTask', async () => {
    await QueueEngine.addPrompts([{ prompt: 'task1' }]);
    const { queue } = await QueueEngine.getAppState();
    await QueueEngine.setChainRef(queue.tasks[0].id, 'chain-xyz');

    const next = await QueueEngine.getNextWaitingTask();
    expect(next?.chainPreviousRefId).toBe('chain-xyz');
  });
});
