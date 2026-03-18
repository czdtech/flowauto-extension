<script lang="ts">
  type Status = 'checking' | 'connected' | 'disconnected';
  
  interface Props {
    status: Status;
    title: string;
    reason: string;
    onRefresh: () => void;
  }
  
  let { status, title, reason, onRefresh }: Props = $props();
  
  function reasonText(r: string): string {
    switch (r) {
      case 'no_active_tab':
        return '未找到当前活动标签页';
      case 'not_labs':
        return '当前标签页不是 labs.google';
      case 'not_flow_project':
        return '当前 labs 页面不是 Flow 项目页';
      case 'no_content_script':
        return '未检测到内容脚本（可先刷新 Flow 页面；或到扩展详情里允许访问 labs.google）';
      case 'timeout':
        return '页面响应超时';
      default:
        return '未知错误';
    }
  }
</script>

<header>
  <div class="title">FlowAuto</div>
  <div class="header-status">
    {#if status === 'connected'}
      <span class="status ok" title={title || 'Flow 项目页'}>已连接：{title || 'Flow 项目页'}</span>
    {:else if status === 'checking'}
      <span class="status warn">检测中…</span>
    {:else}
      <strong class="status bad">未连接</strong>
      <span class="header-meta">({reasonText(reason)})</span>
    {/if}
  </div>
  <button class="btn refresh-btn" onclick={onRefresh}>刷新连接</button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .title {
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }
  .header-status {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    min-width: 0;
  }
  .header-meta {
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .btn.refresh-btn {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .status {
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status.ok {
    color: #7ee787;
  }
  .status.warn {
    color: #f6d365;
  }
  .status.bad {
    color: #ff7b72;
  }
</style>