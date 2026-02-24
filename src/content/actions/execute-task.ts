import { MSG } from '../../shared/constants';
import type { TaskItem } from '../../shared/types';
import { buildProjectDir, buildTaskBaseName } from '../../shared/filename-utils';
import { downloadTopNLatestWithNaming, type MediaType } from './download';
import { createAndWaitForGeneration } from './generate';
import { setPromptText } from './prompt';
import { setAspectRatio, setMode, setModel, setOutputCount } from './settings';
import { getProjectName } from '../page-state';
import { sleep } from '../utils/dom';
import { selectTab } from './navigate';

function mediaTypeForTask(task: TaskItem): MediaType {
  return task.mode === 'create-image' ? 'image' : 'video';
}

function timeoutForTask(task: TaskItem): number {
  return task.mode === 'create-image' ? 120_000 : 900_000;
}

function taskLog(taskId: string, msg: string): void {
  console.log(`[FlowAuto] ${msg}`);
  try {
    const maybe = chrome.runtime.sendMessage({ type: MSG.TASK_LOG, taskId, msg } as any);
    // In MV3 this may return a Promise; avoid "Uncaught (in promise)" noise.
    if (maybe && typeof (maybe as any).catch === 'function') (maybe as any).catch(() => {});
  } catch { /* best effort */ }
}

export async function executeTask(task: TaskItem): Promise<{ downloadedCount: number }> {
  const mediaType = mediaTypeForTask(task);
  const log = (msg: string) => taskLog(task.id, msg);

  log(`开始执行任务`);

  log(`切换到 ${mediaType === 'image' ? '图片' : '视频'} 标签页`);
  await selectTab(mediaType === 'image' ? 'image' : 'video');
  await sleep(800);

  log(`设置生成模式: ${task.mode}`);
  await setMode(task.mode);
  await sleep(600);

  log(`设置画幅 ${task.aspectRatio}, 数量 ${task.outputCount}, 模型 ${task.model}`);
  await setAspectRatio(task.aspectRatio);
  await setOutputCount(task.outputCount);
  await setModel(task.model);
  await sleep(200);

  log(`输入提示词`);
  setPromptText(task.prompt);
  await sleep(300);

  log(`点击创建，等待生成...`);
  const result = await createAndWaitForGeneration({
    expectedCount: task.outputCount,
    timeoutMs: timeoutForTask(task),
  });

  const newCount = result.newCount;
  if (newCount <= 0) {
    throw new Error(`生成失败（无新产出）`);
  }

  log(`生成完成，下载 ${newCount} 个文件...`);
  const projectName = getProjectName() ?? 'Flow';
  const dir = buildProjectDir(projectName);

  await downloadTopNLatestWithNaming(mediaType, newCount, (outputIndex) => {
    const baseCore = buildTaskBaseName(task, outputIndex);
    const idTail = task.id.slice(-6);
    return {
      dir,
      baseName: `${baseCore}__${idTail}`,
      taskId: task.id,
      outputIndex,
    };
  }, result.baselineUrls);

  log(`任务完成`);
  return { downloadedCount: newCount };
}
