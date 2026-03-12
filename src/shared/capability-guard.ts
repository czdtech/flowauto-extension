import type { AspectRatio, TaskItem, VeoModel } from './types';

export interface CapabilityResolution {
  valid: boolean;
  corrected?: Partial<Pick<TaskItem, 'model' | 'aspectRatio'>>;
  reason?: string;
  warnings?: string[];
}



function isVeo(model: TaskItem['model']): model is VeoModel {
  return (
    model === 'veo3.1-fast' ||
    model === 'veo3.1-quality'
  );
}

function requireLandscape(
  current: AspectRatio
): { ok: true } | { ok: false; corrected: AspectRatio; warning: string } {
  if (current === '16:9') return { ok: true };
  return { ok: false, corrected: '16:9', warning: '该功能仅支持横向 (16:9)，已自动更正画幅。' };
}

export function resolveCapabilities(task: TaskItem): CapabilityResolution {
  const corrected: CapabilityResolution['corrected'] = {};
  const warnings: string[] = [];

  // Ingredients → only Veo 3.1 Fast (both aspect ratios)
  if (task.mode === 'ingredients') {
    if (task.model !== 'veo3.1-fast') {
      corrected.model = 'veo3.1-fast';
      warnings.push('Ingredients 模式仅支持 Veo 3.1 - Fast，已自动切换模型。');
    }
  }

  // Jump To → landscape only, and Veo 3.1 Fast not supported
  if (task.mode === 'jump-to') {
    const landscape = requireLandscape(task.aspectRatio);
    if (!landscape.ok) {
      corrected.aspectRatio = landscape.corrected;
      warnings.push(landscape.warning);
    }
    if (task.model === 'veo3.1-fast') {
      corrected.model = 'veo3.1-quality';
      warnings.push('Jump To 不支持 Veo 3.1 - Fast，已自动切换到 Veo 3.1 - Quality。');
    }
  }

  // Extend → landscape only (official)
  if (task.mode === 'extend') {
    const landscape = requireLandscape(task.aspectRatio);
    if (!landscape.ok) {
      corrected.aspectRatio = landscape.corrected;
      warnings.push(landscape.warning);
    }
  }

  // Camera Control (special) → Veo 3.1 Fast + landscape + frames
  if (task.mode === 'camera-control') {
    const landscape = requireLandscape(task.aspectRatio);
    if (!landscape.ok) {
      corrected.aspectRatio = landscape.corrected;
      warnings.push(landscape.warning);
    }
    if (task.model !== 'veo3.1-fast') {
      corrected.model = 'veo3.1-fast';
      warnings.push('Camera Control 仅支持 Veo 3.1 - Fast，已自动切换模型。');
    }
  }

  // If user set a non-video model for video modes, we cannot correct safely yet.
  if (
    (task.mode === 'text-to-video' ||
      task.mode === 'frames-first' ||
      task.mode === 'frames-first-last' ||
      task.mode === 'ingredients' ||
      task.mode === 'extend' ||
      task.mode === 'jump-to' ||
      task.mode === 'camera-control') &&
    !isVeo(task.model)
  ) {
    return {
      valid: false,
      reason: '当前任务是视频模式，但选择的是图片模型；请切换到 Veo 模型。',
    };
  }

  if (Object.keys(corrected).length === 0) return { valid: true };
  return { valid: true, corrected, warnings };
}

