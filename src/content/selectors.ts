// Centralized selectors and text keywords.
// Prefer ARIA roles + accessible-ish names over unstable hashed classnames.

export const SELECTORS = {
  textarea: 'textarea',
  buttons: 'button',
  combobox: '[role="combobox"]',
  listbox: '[role="listbox"]',
  option: '[role="option"]',
  menuitem: '[role="menuitem"]',
  downloadButtons: 'button[aria-haspopup="menu"]',
} as const;

export const KEYWORDS = {
  // Mode options
  modeTextToVideo: ['文生视频', 'text-to-video', 'text to video', 'text_analysis'],
  modeFramesToVideo: ['图帧生视频', 'frames', 'photo_spark'],
  modeIngredients: ['素材生视频', 'ingredients', 'photo_merge_auto'],
  modeCreateImage: ['制作图片', 'create image', 'add_photo'],

  // Settings controls
  settings: ['设置', 'tune', 'settings'],
  aspectRatio: ['宽高比', 'aspect', 'crop_'],
  outputCount: ['输出次数', 'outputs', '每个提示', '每组输出', '输出数', '输出'],
  model: ['模型', 'model', '图片模型', '视频模型'],

  // Common actions
  create: ['创建', 'create'],
  expand: ['展开', 'expander'],
  download: ['下载', 'download'],
} as const;

