import puppeteer from 'puppeteer-core';

(async () => {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('labs.google/fx/zh/tools/flow'));
    
    if (!page) {
      console.log('Flow page not found');
      process.exit(1);
    }

    const htmls = await page.evaluate(() => {
      // Find download buttons on the grid cards
      const imgParents = Array.from(document.querySelectorAll('img')).map(i => i.closest('div'));
      const buttons = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
      return {
        totalPopupButtons: buttons.length,
        items: buttons.map(b => ({
          html: b.outerHTML,
          name: b.getAttribute('name'),
          text: b.textContent,
          ariaLabel: b.getAttribute('aria-label')
        }))
      };
    });

    console.log("Found download buttons:", JSON.stringify(htmls, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
