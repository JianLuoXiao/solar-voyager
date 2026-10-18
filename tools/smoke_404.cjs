/* 精确抓 404：用 CDP Network 域，避免 playwright response 事件漏掉 favicon 之类的请求 */
const { chromium } = require('C:\\Users\\86159\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = 'C:/Users/86159/Desktop/solar-voyager/tools/';

(async () => {
  const lines = [];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true,
      args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const ALL = {};
    cdp.on('Network.responseReceived', (e) => {
      ALL[e.response.url] = e.response.status;
    });
    await page.goto('http://127.0.0.1:8642/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    // 进入火星地表
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button,div'))
        .find(e => e.textContent && e.textContent.replace(/\s/g, '') === '启程');
      if (el) el.click();
    });
    await page.waitForTimeout(6000);
    await page.evaluate(() => { const it = document.querySelector('.cat-item[data-id="mars"]'); if (it) it.click(); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('#btn-land'); if (b && !b.disabled) b.click(); });
    await page.waitForTimeout(16000);
    const bad = Object.entries(ALL).filter(([, s]) => s >= 400);
    lines.push('总请求 ' + Object.keys(ALL).length + ' 条');
    lines.push('非 2xx/3xx：');
    for (const [u, s] of bad) lines.push('  ' + s + '  ' + u.replace('http://127.0.0.1:8642/', '/'));
    if (!bad.length) lines.push('  (none)');
  } catch (e) { lines.push('FATAL ' + String(e).slice(0, 400)); }
  finally { if (browser) await browser.close(); }
  fs.writeFileSync(DIR + '_r404.txt', lines.join('\n'), 'utf8');
  console.log('done');
})();
