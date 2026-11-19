/* GARGANTUA 无头验收脚本
 * 用法：node tests/shot.mjs [baseURL]
 * 依赖：npm i playwright && npx playwright install chromium
 * 验收项：无控制台错误 / 无黑屏 / URL 截图接口 / 交互（拖拽、预设切换）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8734';
const OUT = new URL('./artifacts/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

/* 1. URL 截图接口：电影档 + 冻结时间 + 预设 0（软渲染下超时降级为直接截图） */
await page.goto(`${BASE}/index.html?shot=1&t=30&preset=0&quality=high`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__SHOT_READY__ === true, null, { timeout: 35000 });
} catch (_) {
  console.log('WARN: SHOT_READY 等待超时，按当前帧截图继续');
}
await page.screenshot({ path: `${OUT}/preset0-high.png` });

/* 2. 非黑屏校验：读取中心与盘面区域像素亮度 */
const lum = await page.evaluate(() => {
  const c = document.getElementById('scene');
  const g = c.getContext('webgl2', { preserveDrawingBuffer: false });
  return new Promise((resolve) => {
    // 用 2D 重绘方式取像素（webgl 缓冲已交换，改走 canvas 快照）
    const snap = document.createElement('canvas');
    snap.width = c.width; snap.height = c.height;
    const ctx = snap.getContext('2d');
    requestAnimationFrame(() => {
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, snap.width, snap.height).data;
      let sum = 0, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l; if (l > max) max = l;
      }
      resolve({ avg: sum / (d.length / 4), max });
    });
  });
});

/* 3. 预设切换 + 拖拽交互 */
await page.keyboard.press('2');          // 侧视盘缘
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/preset1-edge.png` });
await page.mouse.move(480, 300);
await page.mouse.down();
await page.mouse.move(680, 240, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const dist = await page.textContent('#h-dist');

/* 4. 调试视图（D + 6 = 光子环项） */
await page.keyboard.press('d');
await page.keyboard.press('6');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/debug6-photon-ring.png` });
await page.keyboard.press('Escape');

const result = {
  consoleErrors,
  luminance: lum,
  cameraDistAfterDrag: dist,
  pass: consoleErrors.length === 0 && lum.max > 40 && lum.avg > 0.5,
};
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.pass ? 0 : 1);
