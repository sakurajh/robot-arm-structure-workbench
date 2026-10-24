import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outDir = resolve('demo/frames');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1',
    '--hide-scrollbars'
  ]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve('index.html')).href);
await page.waitForFunction(() => window.armDemo?.inspect().meshCount === 48, null, { timeout: 30000 });
await page.waitForTimeout(900);

await page.addStyleTag({
  content: `
    #demo-cursor{position:fixed;left:720px;top:450px;width:18px;height:18px;border:2px solid #ff8a2a;
      border-radius:50%;background:rgba(255,255,255,.18);box-shadow:0 2px 10px rgba(0,0,0,.5);
      transform:translate(-50%,-50%);pointer-events:none;z-index:10000;opacity:0;
      transition:transform .08s ease, opacity .15s ease}
    #demo-cursor.is-down{transform:translate(-50%,-50%) scale(.72)}
    #demo-caption{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9999;
      max-width:820px;padding:12px 22px 13px;border:1px solid rgba(240,123,34,.38);
      border-left:3px solid #f07b22;border-radius:4px;background:rgba(8,12,14,.93);
      color:#f2f4f3;font:20px/1.45 "Microsoft YaHei","PingFang SC",sans-serif;
      letter-spacing:.02em;pointer-events:none;opacity:0;box-shadow:0 10px 30px rgba(0,0,0,.45)}
    #demo-caption b{color:#ff9a4d;font-weight:600}
  `
});

await page.evaluate(() => {
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  document.body.append(cursor, caption);
  addEventListener('pointermove', event => {
    cursor.style.opacity = '1';
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
  }, { capture: true });
  addEventListener('pointerdown', () => {
    cursor.classList.add('is-down');
    cursor.animate([
      { boxShadow: '0 0 0 0 rgba(240,123,34,.55)' },
      { boxShadow: '0 0 0 20px rgba(240,123,34,0)' }
    ], { duration: 480, easing: 'ease-out' });
  }, { capture: true });
  addEventListener('pointerup', () => cursor.classList.remove('is-down'), { capture: true });
  window.__caption = text => {
    caption.innerHTML = text;
    caption.animate([
      { opacity: 0, transform: 'translate(-50%, 8px)' },
      { opacity: 1, transform: 'translate(-50%, 0)' }
    ], { duration: 260, easing: 'ease-out', fill: 'forwards' });
  };
});

const frames = [];
let frameCount = 0;
const session = await page.context().newCDPSession(page);
await session.send('Page.enable');
session.on('Page.screencastFrame', event => {
  const name = `f${String(++frameCount).padStart(5, '0')}.jpg`;
  frames.push({ file: name, ts: event.metadata.timestamp });
  writeFile(resolve(outDir, name), Buffer.from(event.data, 'base64')).catch(() => {});
  session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
});
await session.send('Page.startScreencast', {
  format: 'jpeg', quality: 92, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1
});

const caption = async text => { await page.evaluate(value => window.__caption(value), text); };
const wait = ms => page.waitForTimeout(ms);

async function orbit(dx, dy, steps = 34) {
  const cx = 720, cy = 470;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
    await wait(26);
  }
  await page.mouse.up();
}

async function dragRange(selector, fromRatio, toRatio, steps = 22) {
  const box = await page.locator(selector).boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * fromRatio;
  const x1 = box.x + box.width * toRatio;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    await wait(48);
  }
  await page.mouse.up();
}

try {
  await caption('<b>完整装配</b> · 拖拽旋转，滚轮缩放，点击零件查看结构说明');
  await orbit(190, 26);
  await wait(500);

  await caption('<b>零件拾取</b> · 点击任意零件高亮，左下角显示所属总成与用途');
  const point = await page.evaluate(() => window.armDemo.getPartScreenPosition('shoulder-motor'));
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await wait(1600);

  await caption('<b>总成聚焦</b> · 左侧八个总成可一键定位观察');
  await page.click('[data-assembly="wrist"]');
  await wait(1500);
  await page.click('#reset-view');
  await wait(900);

  await caption('<b>爆炸图</b> · 各总成沿装配方向分离，距离 0–100% 可调');
  await page.click('[data-mode="exploded"]');
  await wait(420);
  await dragRange('#explosion', 0.02, 0.65);
  await wait(1100);

  await caption('<b>透明外壳</b> · 只有外壳透明，内部电机与减速器保持不透明');
  await page.click('[data-mode="shell"]');
  await wait(420);
  await dragRange('#shell', 0.02, 0.75);
  await wait(1500);

  await caption('<b>剖面图</b> · X / Y / Z 三向裁剪，实时暴露内部结构');
  await page.click('[data-mode="section"]');
  await wait(420);
  await page.click('[data-axis="z"]');
  await wait(420);
  await dragRange('#clip-position', 0.5, 0.6, 18);
  await wait(1400);

  await caption('<b>一键复位</b> · 模式、参数、选中状态和相机同时还原');
  await page.click('#reset-view');
  await wait(1500);

  await caption('在线体验与完整源码：文末链接');
  await wait(1800);
} finally {
  await session.send('Page.stopScreencast').catch(() => {});
  await wait(400);
  await writeFile(resolve('demo/frames.json'), JSON.stringify(frames, null, 2));
  console.log(`captured ${frames.length} frames`);
  await browser.close();
}
