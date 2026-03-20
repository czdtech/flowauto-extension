<script lang="ts">
  import type { QueueState, TaskItem, TaskStatus, GenerationMode } from '../../shared/types';
  
  interface Props {
    queue: QueueState | null;
    filter: 'all' | TaskStatus;
    activeTopTab: 'image' | 'video' | 'unknown';
    onFilterChange: (filter: 'all' | TaskStatus) => void;
    onSkip: (taskId: string) => void;
    onRemove: (taskId: string) => void;
  }
  
  let { 
    queue, 
    filter = $bindable(), 
    activeTopTab,
    onFilterChange,
    onSkip,
    onRemove
  }: Props = $props();
  
  function isImageMode(mode: GenerationMode): boolean {
    return mode === 'create-image';
  }
  
  function taskMatchesTab(t: { mode: GenerationMode }): boolean {
    if (activeTopTab === 'image') return isImageMode(t.mode);
    if (activeTopTab === 'video') return !isImageMode(t.mode);
    return true; // unknown tab: show all
  }
  
  function counts(q: QueueState): Record<string, number> {
    const visible = q.tasks.filter(taskMatchesTab);
    const c: Record<string, number> = {
      all: visible.length,
      waiting: 0,
      running: 0,
      downloading: 0,
      success: 0,
      error: 0,
      skipped: 0,
    };
    for (const t of visible) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }
  
  function taskAssetFilenames(t: TaskItem): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const a of t.assets ?? []) {
      const name = (a.filename || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
    return result;
  }
</script>

{#if queue}
  {@const c = counts(queue)}
  <div class="queue-top">
    <div class="sub sub-inline">共 {c.all} 条 · 成 {c.success} · 败 {c.error} · 跳 {c.skipped}</div>
    <div class="filter-inline">
      <div class="lab2">筛选</div>
      <select class="sel sel-tight" bind:value={filter} onchange={() => onFilterChange(filter)}>
        <option value="all">全部</option>
        <option value="waiting">waiting</option>
        <option value="running">running</option>
        <option value="success">success</option>
        <option value="error">error</option>
        <option value="skipped">skipped</option>
      </select>
    </div>
  </div>

  <div class="task-list">
    {#each queue.tasks.slice().reverse().filter((t) => taskMatchesTab(t) && (filter === 'all' || t.status === filter)) as t (t.id)}
      {@const assetNames = taskAssetFilenames(t)}
      <div class="task">
        <div class="task-top">
          <div class="task-status">{t.status}</div>
          <div class="task-model">{t.model}</div>
          <div class="spacer"></div>
          <button class="mini" onclick={() => onSkip(t.id)} disabled={t.status !== 'waiting'}>
            跳过
          </button>
          <button class="mini danger" onclick={() => onRemove(t.id)}>删除</button>
        </div>
        {#if t.filename}
          <div class="task-fn">{t.filename}</div>
        {/if}
        <div class="task-prompt">{t.prompt}</div>
        {#if assetNames.length > 0}
          <div class="task-refs">
            <span class="task-refs-label">参考图</span>
            <div class="task-refs-list">
              {#each assetNames as name}
                <span class="task-ref-tag">{name}</span>
              {/each}
            </div>
          </div>
        {/if}
        {#if t.errorMessage}
          <div class="task-err">{t.errorMessage}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .sub {
    opacity: 0.8;
    font-size: 12px;
    line-height: 1.35;
    margin-bottom: 10px;
  }
  .sub-inline {
    margin-bottom: 0;
    white-space: nowrap;
  }
  .queue-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: nowrap;
  }
  .filter-inline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .lab2 {
    opacity: 0.75;
    font-size: 12px;
  }
  .sel {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 10px;
    padding: 6px 8px;
    outline: none;
    font-size: 12px;
  }
  .sel-tight {
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .sel option {
    background: #1e1e1e;
    color: #fff;
  }
  .task-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow: auto;
    padding-right: 2px;
  }
  .task {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 10px;
  }
  .task-top {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 6px;
  }
  .spacer {
    flex: 1;
  }
  .mini {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .mini:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .mini:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .mini.danger {
    border-color: rgba(255, 123, 114, 0.35);
    background: rgba(255, 123, 114, 0.10);
  }
  .mini.danger:hover {
    background: rgba(255, 123, 114, 0.14);
  }
  .task-status {
    font-weight: 650;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
  }
  .task-model {
    opacity: 0.8;
    font-size: 12px;
  }
  .task-fn {
    font-size: 12px;
    opacity: 0.85;
    margin-bottom: 4px;
  }
  .task-prompt {
    font-size: 12px;
    opacity: 0.9;
    line-height: 1.35;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .task-refs {
    margin-top: 6px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .task-refs-label {
    font-size: 11px;
    opacity: 0.65;
    white-space: nowrap;
    margin-top: 1px;
  }
  .task-refs-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .task-ref-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(126, 231, 135, 0.28);
    background: rgba(126, 231, 135, 0.10);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-err {
    margin-top: 6px;
    font-size: 12px;
    color: #ff7b72;
    white-space: pre-wrap;
  }
</style>
