import { chromium } from 'playwright-core';

const url = process.argv[2] || 'https://www.sakura.work.gd/robot-arm-structure-workbench/';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const external = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
const response = await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.armDemo?.inspect().meshCount === 48, null, { timeout: 30000 });
await page.click('[data-mode="exploded"]');
await page.locator('#explosion').evaluate(el => { el.value = '65'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForFunction(() => window.armDemo.inspect().explodedOffset > 1.4);
const exploded = await page.evaluate(() => window.armDemo.inspect());
await page.click('[data-mode="shell"]');
await page.locator('#shell').evaluate(el => { el.value = '75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const shell = await page.evaluate(() => window.armDemo.inspect());
await page.click('[data-mode="section"]');
await page.click('[data-axis="y"]');
await page.locator('#clip-position').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const section = await page.evaluate(() => window.armDemo.inspect());
await page.click('#reset-view');
const reset = await page.evaluate(() => window.armDemo.inspect());
await page.screenshot({ path: 'preview-live.png', fullPage: true });
console.log(JSON.stringify({
  status: response.status(),
  meshCount: exploded.meshCount,
  explodedOffset: exploded.explodedOffset,
  shellOpacity: shell.shellOpacity,
  internalOpacity: shell.internalOpacity,
  activeClipAxis: section.activeClipAxis,
  resetMode: reset.mode,
  selectedPart: reset.selectedPart,
  errors,
  externalRequests: external.filter(u => !u.startsWith(url))
}, null, 2));
await browser.close();
