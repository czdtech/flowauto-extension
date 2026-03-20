export const SELECTORS = {
  textarea: 'textarea',
  textbox: '[role="textbox"]',
  buttons: 'button',
  tab: '[role="tab"]',
  menuitem: '[role="menuitem"]',
  downloadButtons: 'button[aria-haspopup="menu"]',
} as const;

export const KEYWORDS = {
  mediaImage: ['image'] as readonly string[],
  mediaVideo: ['videocam', 'video'] as readonly string[],

  videoModeFrames: ['frames', 'crop_free'] as readonly string[],
  videoModeIngredients: ['ingredients', 'chrome_extension'] as readonly string[],

  aspect_16_9: ['16:9', 'crop_16_9'] as readonly string[],
  aspect_4_3: ['4:3', 'crop_landscape'] as readonly string[],
  aspect_1_1: ['1:1', 'crop_square'] as readonly string[],
  aspect_3_4: ['3:4', 'crop_portrait'] as readonly string[],
  aspect_9_16: ['9:16', 'crop_9_16'] as readonly string[],

  create: ['创建', 'create'] as readonly string[],
  download: ['下载', 'download'] as readonly string[],

  prompt: ['您希望创作什么内容', 'what would you like to create'] as readonly string[],
} as const;
