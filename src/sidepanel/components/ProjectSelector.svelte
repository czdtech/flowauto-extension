<script lang="ts">
  import type { Project } from '../../shared/types';

  interface Props {
    projects: Project[];
    activeProjectId: string;
    onSwitch: (projectId: string) => void;
    onCreate: (name: string) => void;
    onRename: (projectId: string, newName: string) => void;
    onDelete: (projectId: string) => void;
  }

  let {
    projects,
    activeProjectId,
    onSwitch,
    onCreate,
    onRename,
    onDelete,
  }: Props = $props();

  let showMenu = $state(false);
  let menuProjectId = $state('');

  function handleSelectChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === '__new__') {
      const name = prompt('项目名称:');
      if (name?.trim()) onCreate(name.trim());
      // Reset select to current active
      (e.target as HTMLSelectElement).value = activeProjectId;
      return;
    }
    onSwitch(val);
  }

  function handleRename(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const name = prompt('新名称:', project.name);
    if (name?.trim() && name.trim() !== project.name) {
      onRename(projectId, name.trim());
    }
    showMenu = false;
  }

  function handleDelete(projectId: string) {
    if (projects.length <= 1) return;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    if (confirm(`确定删除项目 "${project.name}"？所有任务数据将丢失。`)) {
      onDelete(projectId);
    }
    showMenu = false;
  }

  function toggleMenu(projectId: string) {
    if (showMenu && menuProjectId === projectId) {
      showMenu = false;
    } else {
      menuProjectId = projectId;
      showMenu = true;
    }
  }
</script>

<div class="project-bar">
  <select class="project-select" value={activeProjectId} onchange={handleSelectChange}>
    {#each projects as p (p.id)}
      <option value={p.id}>{p.name}</option>
    {/each}
    <option value="__new__">+ 新建项目</option>
  </select>

  <div class="menu-wrap">
    <button
      class="btn menu-btn"
      title="项目操作"
      onclick={() => toggleMenu(activeProjectId)}
      aria-label="项目操作菜单"
    >
      ···
    </button>

    {#if showMenu}
      <div class="menu-popup" role="menu">
        <button class="menu-item" role="menuitem" onclick={() => handleRename(menuProjectId)}>
          重命名
        </button>
        <button
          class="menu-item danger"
          role="menuitem"
          disabled={projects.length <= 1}
          onclick={() => handleDelete(menuProjectId)}
        >
          删除项目
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .project-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .project-select {
    flex: 1;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    border-radius: 10px;
    padding: 6px 8px;
    outline: none;
    font-size: 12px;
  }
  .project-select option {
    background: #1e1e1e;
    color: #fff;
  }
  .project-select:focus {
    border-color: rgba(126, 231, 135, 0.45);
  }
  .menu-wrap {
    position: relative;
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .menu-popup {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    background: #2a2a2a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 4px 0;
    z-index: 10;
    min-width: 120px;
  }
  .menu-item {
    display: block;
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    padding: 6px 12px;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .menu-item.danger {
    color: #ff7b72;
  }
  .menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
