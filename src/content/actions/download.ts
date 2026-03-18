import { MSG } from '../../shared/constants';
import { TIMING, DOWNLOAD } from '../../shared/config';
import { logger } from '../../shared/logger';
import { isVisible, randomSleep } from '../utils/dom';
import { querySelectorAllDeep } from '../finders';
import type { TaskItem } from '../../shared/types';
import { SELECTORS, KEYWORDS } from '../selectors';

export interface DownloadNamingHint {
  dir: string;
  baseName: string;
  taskId: string;
  outputIndex: number;
}

function isLikelyResultThumbnail(img: HTMLImageElement): boolean {
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (nw >= DOWNLOAD.MIN_RESULT_DIMENSION_PX && nh >= DOWNLOAD.MIN_RESULT_DIMENSION_PX) return true;

  const w = img.clientWidth || img.width || 0;
  const h = img.clientHeight || img.height || 0;
  return w >= DOWNLOAD.MIN_RESULT_DIMENSION_PX && h >= DOWNLOAD.MIN_RESULT_DIMENSION_PX;
}

function getTrackableUrl(img: HTMLImageElement): string | null {
  const src = img.currentSrc || img.src;
  if (!src || src.startsWith('data:')) return null;
  return src;
}

// Find cards by just grabbing the images. We'll find their buttons later by crawling up.
function getNewGenerationImages(baselineUrls: Set<string>): HTMLImageElement[] {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
  const newImgs: HTMLImageElement[] = [];
  const seenUrls = new Set<string>();

  for (const img of imgs) {
    if (!img.isConnected) continue;
    const src = getTrackableUrl(img);
    if (!src) continue;
    if (!isLikelyResultThumbnail(img)) continue;
    if (seenUrls.has(src)) continue;
    seenUrls.add(src);

    if (baselineUrls.has(src)) continue;

    newImgs.push(img);
  }

  return newImgs;
}

// Extract download buttons from specific cards, or fallback to all download buttons.
async function getGridDownloadButtons(baselineUrls?: Set<string>): Promise<{btn: HTMLButtonElement, img: HTMLImageElement}[]> {
  const results: {btn: HTMLButtonElement, img: HTMLImageElement}[] = [];

  if (baselineUrls && baselineUrls.size > 0) {
    const newImgs = getNewGenerationImages(baselineUrls);
    if (newImgs.length > 0) {
      for (const img of newImgs) {
        // Trigger hover on img and its first 4 ancestors to ensure buttons render in React
        let current: HTMLElement | null = img;
        for (let i = 0; i < 4; i++) {
            if (!current || current === document.body) break;
            current.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            current.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            current = current.parentElement;
        }
        await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);

        // Find the card container (the highest ancestor we hovered, or just search up to 4 levels)
        let searchRoot: HTMLElement | null = img;
        for (let i = 0; i < 4; i++) {
           if (searchRoot?.parentElement && searchRoot.parentElement !== document.body) {
               searchRoot = searchRoot.parentElement;
           }
        }
        
        if (!searchRoot) searchRoot = document.body;
        
        logger.debug(`searchRoot tag: ${searchRoot.tagName}, class: ${searchRoot.className}`);
        const allMenuBtns = querySelectorAllDeep<HTMLButtonElement>('button[aria-haspopup="menu"]', searchRoot);
        logger.debug(`Found ${allMenuBtns.length} menu buttons in searchRoot.`);

        // First try: standard direct download button (might not have aria-haspopup, so just search button)
        let btn = querySelectorAllDeep<HTMLButtonElement>('button', searchRoot).find((b: HTMLButtonElement) => {
          if (!isVisible(b)) return false;
          const name = (b.getAttribute('name') ?? '').toLowerCase();
          const text = (b.textContent || '').toLowerCase();
          return name.includes('下载') || name.includes('download') || text === '下载' || text === 'download';
        });
        
        // Follow-up: For models like Nano Banana Pro, there is no direct download button.
        // It's hidden behind the "更多" (more_vert) button.
        if (!btn) {
           btn = allMenuBtns.find((b: HTMLButtonElement) => {
             const vis = isVisible(b);
             const text = (b.textContent || '').toLowerCase();
             logger.debug(`Checking button: visible=${vis}, text=${text}`);
             if (!vis) return false;
             return text.includes('更多') || text.includes('more');
           });
        }

        if (btn) results.push({btn, img});
      }
      if (results.length > 0) return results;
    }
  }

  // Fallback: grab all visible download buttons
  const buttons = querySelectorAllDeep<HTMLButtonElement>(SELECTORS.downloadButtons);
  const fallbackResults = buttons.filter((b: HTMLButtonElement) => {
    if (!isVisible(b)) return false;
    const name = (b.getAttribute('name') ?? '').toLowerCase();
    const keywords = KEYWORDS.download || ['下载', 'download'];
    return keywords.some((k: string) => name.includes(k.toLowerCase()));
  });
  
  return fallbackResults.map(btn => ({ btn, img: btn as unknown as HTMLImageElement })); // img is fake here, fallback path doesn't strictly need it in identical way
}

export async function downloadTopNLatestWithNaming(
  task: TaskItem,
  n: number,
  naming: (outputIndex: number) => DownloadNamingHint,
  baselineUrls?: Set<string>
): Promise<void> {
  logger.debug(`downloadTopNLatestWithNaming started for task: ${task.id}, n=${n}, mode=${task.mode}, dl_res=${task.downloadResolution}`);
  const isImage = task.mode === 'create-image';

  // Resolve the unified DownloadResolution into the correct keyword for the menu
  let targetRes: string;
  const dl = task.downloadResolution ?? '2K/1080p';
  if (dl === '4K') {
    targetRes = '4K';
  } else if (isImage) {
    targetRes = dl === '1K/720p' ? '1K' : '2K';
  } else {
    targetRes = dl === '1K/720p' ? '720p' : '1080p';
  }

  let buttonPairs = await getGridDownloadButtons(baselineUrls);
  logger.debug(`Target Resolution: ${targetRes}, Found Buttons at start: ${buttonPairs.length}`);

  // Flow grid displays newest items first. Take the first `n` buttons.
  if (buttonPairs.length > n) {
    buttonPairs = buttonPairs.slice(0, n);
  }

  if (buttonPairs.length === 0) {
    if (baselineUrls && baselineUrls.size > 0) {
      const newImgs = getNewGenerationImages(baselineUrls);
      if (newImgs.length > 0) {
        logger.warn(`未找到包含 '下载/download' 的按钮。尝试直接通过新卡片的图片URL下载...`);
        const imgsToDownload = newImgs.length > n ? newImgs.slice(0, n) : newImgs;
        let downloadedCount = 0;

        for (let i = 0; i < imgsToDownload.length; i++) {
          const img = imgsToDownload[i];
          const hint = naming(i + 1);
          const src = getTrackableUrl(img);

          if (src) {
            logger.debug(`提取到图片URL: ${src}，发起 DOWNLOAD_BY_URL`);
            await chrome.runtime.sendMessage({
              type: MSG.DOWNLOAD_BY_URL,
              url: src,
              dir: hint.dir,
              baseName: hint.baseName,
            });
            downloadedCount++;
            await randomSleep(TIMING.URL_DOWNLOAD_MIN, TIMING.URL_DOWNLOAD_MAX);
          }
        }
        
        if (downloadedCount > 0) {
          logger.info(`成功回退通过URL下载 ${downloadedCount}/${imgsToDownload.length} 项`);
          return;
        }
      }
    }

    logger.warn(`无可用下载按钮且未能提取到图片URL，跳过下载。`);
    return;
  }

  logger.debug(`准备下载 ${buttonPairs.length} 项，目标分辨率: ${targetRes}`);

  let downloadedCount = 0;
  for (let i = 0; i < buttonPairs.length; i++) {
    const { btn, img } = buttonPairs[i];
    // outputIndex starts from 1. 1 is usually the first generated output variant.
    const hint = naming(i + 1);

    logger.debug(`下载第 ${i + 1}/${buttonPairs.length} 项 (任务ID: ${hint.taskId}) - 触发 btn.click()`);

    // 1. Tell the background script to expect a download and rename it.
    await chrome.runtime.sendMessage({
      type: MSG.EXPECT_DOWNLOAD,
      dir: hint.dir,
      baseName: hint.baseName,
    });

    // 2. Click the card's "More" button to open the popup menu.
    //    btn.click() alone doesn't open Radix UI popups — they need pointerdown/mousedown.
    //    But forceClick() bubbles those events to the card container, which navigates
    //    to the Detail/Editor view (breaking subsequent tasks).
    //    Fix: temporarily block propagation on the card container during our click.
    {
      const cardContainer = btn.closest('[class*="eUdvpI"], [class*="sc-"]') || btn.parentElement?.parentElement;
      const blocker = (e: Event) => { e.stopPropagation(); };
      if (cardContainer && cardContainer !== btn) {
        // Add capturing listeners that prevent the card from seeing our events
        cardContainer.addEventListener('pointerdown', blocker, true);
        cardContainer.addEventListener('mousedown', blocker, true);
        cardContainer.addEventListener('click', blocker, true);
      }
      
      // Dispatch the minimum events needed for Radix UI to open the popup
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const common = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
      
      btn.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      btn.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
      btn.dispatchEvent(new MouseEvent('mousedown', { ...common, button: 0, buttons: 1 }));
      btn.dispatchEvent(new MouseEvent('mouseup', { ...common, button: 0, buttons: 0 }));
      btn.dispatchEvent(new MouseEvent('click', { ...common, button: 0 }));
      
      // Remove blockers after a tick so they don't interfere with future interactions
      setTimeout(() => {
        if (cardContainer && cardContainer !== btn) {
          cardContainer.removeEventListener('pointerdown', blocker, true);
          cardContainer.removeEventListener('mousedown', blocker, true);
          cardContainer.removeEventListener('click', blocker, true);
        }
      }, 100);
    }
    await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);
    
    // 3. Find the menu items
    let menuItems = querySelectorAllDeep<HTMLElement>('[role="menuitem"]').filter(isVisible);
    
    // Check if we just opened the "更多" (More) root menu, which contains a "下载" entry that we must click to see resolutions
    const isMoreMenu = menuItems.some(item => {
      const txt = (item.textContent || '').toLowerCase();
      return txt.includes('添加动画效果') || txt.includes('添加到提示') || (txt.includes('下载') && !txt.includes('1k'));
    });

    if (isMoreMenu) {
       logger.debug(`进入了 "更多" 根菜单，正在展开 "下载" 分辨率子菜单...`);
       const dlItem = menuItems.find(el => (el.textContent || '').includes('下载') && !(el.textContent || '').toLowerCase().includes('1k'));
       if (dlItem) {
           // Phase 1: Hover to try expanding submenu (Radix submenus use hover)
           const rect = dlItem.getBoundingClientRect();
           const cx = rect.left + rect.width / 2;
           const cy = rect.top + rect.height / 2;
           const evtOpts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
           
           dlItem.dispatchEvent(new PointerEvent('pointerenter', { ...evtOpts, pointerType: 'mouse' }));
           dlItem.dispatchEvent(new PointerEvent('pointermove', { ...evtOpts, pointerType: 'mouse' }));
           dlItem.dispatchEvent(new MouseEvent('mouseenter', evtOpts));
           dlItem.dispatchEvent(new MouseEvent('mouseover', evtOpts));
           dlItem.dispatchEvent(new MouseEvent('mousemove', evtOpts));
           
           await randomSleep(TIMING.MEDIUM_MIN, TIMING.MEDIUM_MAX);
           
           // Check if submenu appeared (look for resolution items like 1K/2K/4K)
           let subItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'))
             .filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el));
           const hasResolution = subItems.some(el => {
             const t = (el.textContent || '').toLowerCase();
             return t.includes('1k') || t.includes('2k') || t.includes('4k') || t.includes('original');
           });
           
           if (!hasResolution) {
             // Phase 2: Hover didn't expand submenu - try click as fallback
             logger.debug(`悬浮未展开子菜单，尝试 click()...`);
             dlItem.click();
             await randomSleep(TIMING.LONG_MIN, TIMING.LONG_MAX);
             subItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'))
               .filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el));
           }
           
           menuItems = subItems;
           logger.debug(`展开后找到 ${menuItems.length} 个菜单项`);
       }
    }

    logger.debug(`找到了 ${menuItems.length} 个可见的 menuitem`);
    if (menuItems.length === 0) {
      logger.warn(`未找到下载菜单项，可能是单分辨率模型(如Nano Banana Pro)。尝试直接通过URL下载...`);
      
      let imgSrc: string | null = getTrackableUrl(img);

      if (!imgSrc) {
          // fallback if img is somehow invalid, search around button
          let el: HTMLElement | null = btn;
          while (el && el !== document.body && !imgSrc) {
            // Find the generated image, skipping avatars (googleusercontent.com)
            const foundImg = Array.from(el.querySelectorAll('img')).find((elImg) => {
              const src = elImg.currentSrc || elImg.src;
              return src && !src.startsWith('data:') && !src.includes('googleusercontent.com');
            });
            
            if (foundImg) {
              imgSrc = foundImg.currentSrc || foundImg.src;
            }
            el = el.parentElement;
          }
      }

      if (imgSrc) {
        logger.debug(`提取到图片URL: ${imgSrc}，通过 BACKGROUND 发起 DOWNLOAD_BY_URL`);
        await chrome.runtime.sendMessage({
          type: MSG.DOWNLOAD_BY_URL,
          url: imgSrc,
          dir: hint.dir,
          baseName: hint.baseName,
        });
        downloadedCount++;
        await randomSleep(TIMING.URL_DOWNLOAD_MIN, TIMING.URL_DOWNLOAD_MAX);
      } else {
        logger.warn(`未能提取到图片的URL`);
      }
      
      continue;
    }

    // 4. Try to find the exact resolution requested
    let targetMenuItem = menuItems.find((item: HTMLElement) => {
      const text = (item.textContent || '').toLowerCase() + (item.getAttribute('name') || '').toLowerCase();
      logger.debug(`检查菜单项: "${text}"`);
      if (targetRes === '4K') return text.includes('4k');
      if (targetRes === '2K') return text.includes('2k');
      if (targetRes === '1K') return text.includes('1k');
      if (targetRes === '1080p') return text.includes('1080') || text.includes('高分辨率') || text.includes('high');
      if (targetRes === '720p') return text.includes('720') || text.includes('原始') || text.includes('original');
      return false;
    });

    // 5. Fallback logic: Auto-downgrade if exact resolution (like 4K) is unavailable.
    if (!targetMenuItem) {
      logger.warn(`下载菜单中没有找到请求的分辨率 (${targetRes})，正在自动降级选择...`);
      targetMenuItem = menuItems.find((item: HTMLElement) => {
        const text = (item.textContent || '').toLowerCase();
        return text.includes('2k') || text.includes('1080') || text.includes('高分辨率') || text.includes('high');
      }) || menuItems.find((item: HTMLElement) => {
        const text = (item.textContent || '').toLowerCase();
        return text.includes('1k') || text.includes('720') || text.includes('原始') || text.includes('original');
      }) || menuItems[0]; 
    }

    if (targetMenuItem) {
      logger.info(`点击下载项: "${targetMenuItem.textContent?.trim()}"`);
      
      // Use native click — the reference ac15 project proves this is all React needs
      targetMenuItem.click();
      
      downloadedCount++;
      await randomSleep(TIMING.BETWEEN_DOWNLOADS_MIN, TIMING.BETWEEN_DOWNLOADS_MAX);
    } else {
        logger.warn(`最终未能找到任何可用的下载菜单项。`);
    }
  }

  logger.info(`成功发起 ${downloadedCount}/${buttonPairs.length} 个下载请求`);

}
