/* 冒烟 pass7：验证 TAR 沙脊 + 多边形裂纹改造后的运行时正确性。
   检查项：① 无 JS 报错 ② 无资源 4xx ③ 真实 DEM 资源全部加载 ④ FPS ⑤ 多角度截图 */
const { chromium } = require('C:\\Users\\86159\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://127.0.0.1:8642/';
const DIR = 'C:/Users/86159/Desktop/solar-voyager/tools/';
const LOG = DIR + '_smoke7.txt';

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
    const bad = [], loaded = [];
    page.on('response', (r) => {
      const u = r.url();
      if (r.status() >= 400) bad.push(r.status() + ' ' + u.replace(URL_, '/'));
      else loaded.push(u.replace(URL_, '/'));
    });

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
    await page.waitForTimeout(20000);
    await page.screenshot({ path: DIR + '_v1_spawn.png' });
    say('shot v1 (spawn)');

    const key = ['/textures/mars_dem_meta.json', '/textures/mars_dem_h.bin',
      '/textures/mars_dem_albedo.jpg', '/textures/mars_dem_normal.png', '/textures/mars_dem_orm.png'];
    say('--- DEM 资源加载 ---');
    for (const k of key) say((loaded.includes(k) ? '200 ' : 'MISS ') + k);
    say('--- 4xx ---');
    say(bad.length ? bad.join('\n') : '(none)');

    const fps = await page.evaluate(() => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); };
      requestAnimationFrame(tick);
    }));
    say('FPS ~ ' + fps);

    await page.mouse.click(720, 450);
    await page.waitForTimeout(500);
    for (let k = 0; k < 3; k++) {
      await page.mouse.move(720, 450);
      await page.mouse.down();
      await page.mouse.move(1438, 450, { steps: 24 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: DIR + '_v' + (k + 2) + '.png' });
      say('shot v' + (k + 2));
    }
    say('OK');
  } catch (e) {
    say('FATAL ' + String(e).slice(0, 600));
  } finally {
    if (browser) await browser.close();
  }
  fs.writeFileSync(LOG, lines.join('\n'), 'utf8');
  console.log('done');
})();
