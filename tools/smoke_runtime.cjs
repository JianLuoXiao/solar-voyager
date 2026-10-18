/* 冒烟 pass6：落地后用鼠标拖动转视角（背对太阳），多角度截图确认真实 DEM 地貌。 */
const { chromium } = require('C:\\Users\\86159\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://127.0.0.1:8642/';
const DIR = 'C:/Users/86159/Desktop/solar-voyager/tools/';
const LOG = DIR + '_smoke6.txt';

(async () => {
  const lines = [];
  const say = (s) => lines.push(s);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => say('[pageerror] ' + String(e).slice(0, 400)));
    page.on('console', (m) => { if (m.type() === 'error') say('[console.error] ' + m.text().slice(0, 200)); });

    await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button,div'))
      .some(e => e.textContent && e.textContent.replace(/\s/g, '') === '启程' && e.offsetParent !== null), { timeout: 90000 });
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button,div'))
        .find(e => e.textContent && e.textContent.replace(/\s/g, '') === '启程');
      if (el) el.click();
    });
    await page.waitForTimeout(6000);
    await page.evaluate(() => { const it = document.querySelector('.cat-item[data-id="mars"]'); if (it) it.click(); });
    await page.waitForTimeout(1800);
    await page.evaluate(() => { const b = document.querySelector('#btn-land'); if (b && !b.disabled) b.click(); });
    await page.waitForTimeout(18000);
    await page.screenshot({ path: DIR + '_view1_spawn.png' });
    say('shot view1 (spawn)');

    // 指针锁定 + 拖动转视角：往右拖 720px ≈ 转 90~180 度
    await page.mouse.click(720, 450);
    await page.waitForTimeout(500);
    for (let k = 0; k < 3; k++) {
      await page.mouse.move(720, 450);
      await page.mouse.down();
      await page.mouse.move(1440 - 2, 450, { steps: 24 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: DIR + '_view' + (k + 2) + '.png' });
      say('shot view' + (k + 2));
    }
  } catch (e) {
    say('FATAL ' + String(e).slice(0, 600));
  } finally {
    if (browser) await browser.close();
  }
  require('fs').writeFileSync(LOG, lines.join('\n'), 'utf8');
  console.log('done');
})();
