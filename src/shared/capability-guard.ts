import type { AspectRatio, TaskItem, VeoModel } from './types';

export interface CapabilityResolution {
  valid: boolean;
  corrected?: Partial<Pick<TaskItem, 'model' | 'aspectRatio'>>;
  reason?: string;
  warnings?: string[];
}

function isVeo2(model: TaskItem['model']): model is 'veo2-fast' | 'veo2-quality' {
  return model === 'veo2-fast' || model === 'veo2-quality';
}

function isVeo(model: TaskItem['model']): model is VeoModel {
  return (
    model === 'veo2-fast' ||
    model === 'veo2-quality' ||
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

  // Veo 2 → landscape only (official matrix)
  if (isVeo2(task.model) && task.aspectRatio === '9:16') {
    corrected.model = 'veo3.1-fast';
    warnings.push('Veo 2 仅支持横向 (16:9)，已自动切换到 Veo 3.1 - Fast 以支持 9:16。');
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

  // Extend → landscape only (official), Veo 2 Quality not supported
  if (task.mode === 'extend') {
    const landscape = requireLandscape(task.aspectRatio);
    if (!landscape.ok) {
      corrected.aspectRatio = landscape.corrected;
      warnings.push(landscape.warning);
    }
    if (task.model === 'veo2-quality') {
      corrected.model = 'veo2-fast';
      warnings.push('Extend 不支持 Veo 2 - Quality，已自动切换到 Veo 2 - Fast。');
    }
  }

  // Frames First+Last → Veo 2 Quality not supported
  if (task.mode === 'frames-first-last' && task.model === 'veo2-quality') {
    corrected.model = task.aspectRatio === '9:16' ? 'veo3.1-fast' : 'veo2-fast';
    warnings.push('首+尾帧不支持 Veo 2 - Quality，已自动切换为可用模型。');
  }

  // Camera Control (special) → Veo 2 Fast + landscape + frames
  if (task.mode === 'camera-control') {
    const landscape = requireLandscape(task.aspectRatio);
    if (!landscape.ok) {
      corrected.aspectRatio = landscape.corrected;
      warnings.push(landscape.warning);
    }
    if (task.model !== 'veo2-fast') {
      corrected.model = 'veo2-fast';
      warnings.push('Camera Control 仅支持 Veo 2 - Fast，已自动切换模型。');
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

