import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const pageUrl = pathToFileURL(resolve('index.html')).href;

async function launchBrowser() {
  return chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
}

async function openScene(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  await page.goto(pageUrl);
  await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30, null, { timeout: 10000 });
  return { page, errors, externalRequests };
}

async function waitForExplosionToSettle(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    let previous = window.armDemo.inspect().explodedOffset;
    let hasMoved = previous > 0;
    let stableFrames = 0;
    const startedAt = performance.now();

    function checkFrame() {
      const offset = window.armDemo.inspect().explodedOffset;
      const delta = Math.abs(offset - previous);
      if (delta >= 0.001) hasMoved = true;
      stableFrames = hasMoved && delta < 0.001 ? stableFrames + 1 : 0;
      previous = offset;

      if (stableFrames >= 3) {
        resolve({ offset, delta, stableFrames });
        return;
      }
      if (performance.now() - startedAt > 10000) {
        reject(new Error(`Explosion did not settle; offset=${offset}, delta=${delta}`));
        return;
      }
      requestAnimationFrame(checkFrame);
    }
    requestAnimationFrame(checkFrame);
  }));
}

test('copied HTML works alone without external requests or application errors', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'robot-arm-offline-'));
  let browser;
  try {
    await copyFile('index.html', join(temporary, 'index.html'));
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', request => {
      if (/^https?:/.test(request.url())) externalRequests.push(request.url());
    });
    await page.goto(pathToFileURL(join(temporary, 'index.html')).href);
    await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    t.diagnostic(`isolated file scene: ${JSON.stringify(await page.evaluate(() => window.armDemo.inspect()))}`);
  } finally {
    await browser?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

function assertProjectionContained(projection) {
  const verticalHalfFov = projection.fov * Math.PI / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * projection.aspect);
  const conservativeDistance = projection.radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
  assert.ok(
    projection.distance >= conservativeDistance,
    `camera distance ${projection.distance} must contain bounding sphere at ${conservativeDistance}`
  );
  for (const corner of projection.corners) {
    assert.ok(Number.isFinite(corner.x) && Number.isFinite(corner.y) && Number.isFinite(corner.z));
    assert.ok(Math.abs(corner.x) <= 1, `projected corner x ${corner.x} must be visible`);
    assert.ok(Math.abs(corner.y) <= 1, `projected corner y ${corner.y} must be visible`);
    assert.ok(corner.z >= -1 && corner.z <= 1, `projected corner z ${corner.z} must be inside clipping planes`);
  }
}

function assertViewDirection(actual, position, target) {
  const expected = position.map((value, index) => value - target[index]);
  const length = Math.hypot(...expected);
  const dot = actual.reduce((sum, value, index) => sum + value * expected[index] / length, 0);
  assert.ok(dot > 0.999999, `view direction must be preserved; dot product was ${dot}`);
}

test('file:// page creates a nonempty WebGL scene', async t => {
  const browser = await launchBrowser();
  try {
    const { page, errors, externalRequests } = await openScene(browser);
    const snapshot = await page.evaluate(() => window.armDemo.inspect());
    assert.ok(snapshot.meshCount >= 30);
    assert.ok(snapshot.canvasWidth > 0 && snapshot.canvasHeight > 0);
    t.diagnostic(`scene inspect: ${JSON.stringify(snapshot)}`);

    const screenshot = await page.screenshot({
      clip: { x: 400, y: 100, width: 640, height: 700 }
    });
    const pixels = await page.evaluate(async dataUrl => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let litPixels = 0;
      let colorfulPixels = 0;
      const colors = new Set();
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const high = Math.max(red, green, blue);
        const low = Math.min(red, green, blue);
        if (high > 100) litPixels += 1;
        if (high > 100 && high - low > 35) colorfulPixels += 1;
        colors.add(`${red >> 4},${green >> 4},${blue >> 4}`);
      }
      return { litPixels, colorfulPixels, quantizedColors: colors.size };
    }, `data:image/png;base64,${screenshot.toString('base64')}`);
    t.diagnostic(`central viewport pixels: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.litPixels > 1000, 'rendered model must contribute lit pixels');
    assert.ok(pixels.colorfulPixels > 100, 'orange model accents must be visible');
    assert.ok(pixels.quantizedColors > 20, 'scene must contain shaded color variation');
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('central viewport decoration allows real pointer events to reach the canvas', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    const hitCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('#viewport canvas');
      window.centerEvents = [];
      canvas.addEventListener('pointerdown', () => window.centerEvents.push('pointerdown'));
      canvas.addEventListener('pointerup', () => window.centerEvents.push('pointerup'));
      return document.elementFromPoint(720, 450) === canvas;
    });
    assert.equal(hitCanvas, true, 'the central pseudo-element must not intercept hit testing');
    await page.mouse.click(720, 450);
    assert.deepEqual(await page.evaluate(() => window.centerEvents), ['pointerdown', 'pointerup']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('focus APIs contain assembly and part bounds after rotation, zoom, and resize', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.setViewportSize({ width: 420, height: 900 });
    const assembly = await page.evaluate(() => {
      window.armDemo.resize();
      window.armDemo.setView([10, 7, 4], [0.7, 2.4, 0]);
      const focused = window.armDemo.focusAssembly('upper-arm');
      return {
        focused,
        projection: window.armDemo.getAssemblyProjection('upper-arm'),
        inspect: window.armDemo.inspect()
      };
    });
    assert.equal(assembly.focused, true);
    assert.equal(assembly.inspect.canvasWidth, 420);
    assert.equal(assembly.inspect.canvasHeight, 900);
    assert.ok(Math.abs(assembly.inspect.cameraAspect - 420 / 900) < 1e-9);
    assertViewDirection(assembly.projection.direction, [10, 7, 4], [0.7, 2.4, 0]);
    assertProjectionContained(assembly.projection);

    const partPosition = [-6, 5, -8];
    const partTarget = [0.8, 3, 0];
    const part = await page.evaluate(({ position, target }) => {
      window.armDemo.setView(position, target);
      const focused = window.armDemo.focusPart('upper-arm-left-shell');
      return {
        focused,
        projection: window.armDemo.getPartProjection('upper-arm-left-shell')
      };
    }, { position: partPosition, target: partTarget });
    assert.equal(part.focused, true);
    assertViewDirection(part.projection.direction, partPosition, partTarget);
    assertProjectionContained(part.projection);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('projection and picking stay current after view changes and observe the exact 5px drag threshold', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    const current = await page.evaluate(() => {
      window.armDemo.setView([5, 4.5, 6], [0.7, 2.5, 0]);
      const { getPartScreenPosition } = window.armDemo;
      const point = getPartScreenPosition('elbow-right-shell');
      const projection = window.armDemo.getPartProjection('elbow-right-shell');
      const rect = document.querySelector('#viewport canvas').getBoundingClientRect();
      return {
        point,
        center: projection.center,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      };
    });
    assert.ok(Number.isFinite(current.point.x) && Number.isFinite(current.point.y));
    assert.ok(Math.abs(current.point.x - (current.rect.left + (current.center.x + 1) * current.rect.width * 0.5)) < 0.001,
      'screen projection must use the current camera matrix immediately after a view change');
    assert.ok(Math.abs(current.point.y - (current.rect.top + (1 - current.center.y) * current.rect.height * 0.5)) < 0.001,
      'screen projection must use the current camera matrix immediately after a view change');
    const point = current.point;
    assert.ok(point.x >= 0 && point.x <= 1440 && point.y >= 0 && point.y <= 900);

    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'elbow-right-shell');
    await page.mouse.click(1400, 850);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 5, point.y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'elbow-right-shell',
      'a gesture of exactly 5px remains a click');
    await page.mouse.click(1400, 850);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null);

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 5.01, point.y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null,
      'a gesture just over 5px is a drag and must not pick');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('rendering stops when idle and resumes for state, resize, focus, controls, and explosion damping', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.waitForFunction(() => window.armDemo.inspect().rafPending === false, null, { timeout: 2000 });
    const idle = await page.evaluate(() => window.armDemo.inspect().renderCount);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.armDemo.inspect().renderCount), idle,
      'an unchanged scene must not keep rendering');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().rafPending), false);

    async function expectRenderAfter(action) {
      const before = await page.evaluate(() => window.armDemo.inspect().renderCount);
      await action();
      await page.waitForFunction(count => window.armDemo.inspect().renderCount > count, before);
      await page.waitForFunction(() => window.armDemo.inspect().rafPending === false);
    }

    await expectRenderAfter(() => page.evaluate(() => {
      window.armDemo.dispatch({ type: 'SET_MODE', mode: 'shell' });
      window.armDemo.dispatch({ type: 'SET_SHELL_TRANSPARENCY', value: 0.5 });
    }));
    await expectRenderAfter(() => page.setViewportSize({ width: 1200, height: 800 }));
    assert.equal(await page.evaluate(() => window.armDemo.inspect().canvasWidth), 1200);
    await expectRenderAfter(() => page.evaluate(() => window.armDemo.focusAssembly('elbow')));

    const beforeControls = await page.evaluate(() => window.armDemo.inspect().renderCount);
    await page.mouse.move(720, 400);
    await page.mouse.down();
    await page.mouse.move(820, 450, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(count => window.armDemo.inspect().renderCount > count, beforeControls);
    await page.waitForFunction(() => window.armDemo.inspect().rafPending === false);

    await expectRenderAfter(() => page.evaluate(() => {
      window.armDemo.dispatch({ type: 'SET_MODE', mode: 'exploded' });
      window.armDemo.dispatch({ type: 'SET_EXPLOSION', value: 1 });
    }));
    const settled = await page.evaluate(() => window.armDemo.inspect().renderCount);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.armDemo.inspect().renderCount), settled,
      'rendering must stop after explosion damping settles');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('main dispose removes UI DOM and media listeners idempotently', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.uiListenerCalls = { mode: 0, media: 0 };
      const addEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        const isMode = type === 'click' && this instanceof HTMLButtonElement && this.matches('[data-mode]');
        const isMedia = type === 'change' && this instanceof MediaQueryList;
        if ((isMode || isMedia) && typeof listener === 'function') {
          const key = isMode ? 'mode' : 'media';
          const wrapped = function(event) {
            window.uiListenerCalls[key] += 1;
            return listener.call(this, event);
          };
          return addEventListener.call(this, type, wrapped, options);
        }
        return addEventListener.call(this, type, listener, options);
      };
    });
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30);
    await page.click('[data-mode="exploded"]');
    const before = await page.evaluate(() => ({
      calls: { ...window.uiListenerCalls },
      expanded: document.querySelector('#control-panel .panel-toggle').getAttribute('aria-expanded')
    }));
    assert.equal(before.calls.mode, 1);

    await page.evaluate(() => {
      window.armDemo.dispose();
      window.armDemo.dispose();
    });
    await page.click('[data-mode="section"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const after = await page.evaluate(() => ({
      calls: { ...window.uiListenerCalls },
      expanded: document.querySelector('#control-panel .panel-toggle').getAttribute('aria-expanded')
    }));
    assert.deepEqual(after.calls, before.calls, 'disposed UI listeners must not run again');
    assert.equal(after.expanded, before.expanded, 'disposed media listener must not mutate panel state');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('dispose is idempotent, removes the canvas, and stops rendering and RAF', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.waitForFunction(() => window.armDemo.inspect().rafPending === false);
    const before = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(before.disposed, false);
    assert.equal(before.rafPending, false);
    assert.equal(before.canvasConnected, true);

    const disposed = await page.evaluate(() => {
      window.armDemo.dispose();
      window.armDemo.dispose();
      return window.armDemo.inspect();
    });
    assert.equal(disposed.disposed, true);
    assert.equal(disposed.rafPending, false);
    assert.equal(disposed.canvasConnected, false);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(after.renderCount, disposed.renderCount, 'no frame may render after dispose');
    assert.equal(after.rafPending, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('copied HTML shows the WebGL2-unavailable fallback without errors', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'robot-arm-fallback-'));
  let browser;
  try {
    await copyFile('index.html', join(temporary, 'index.html'));
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2') return null;
        return getContext.call(this, type, ...args);
      };
    });
    await page.goto(pathToFileURL(join(temporary, 'index.html')).href);
    const fallback = page.locator('#webgl-error');
    await fallback.waitFor({ state: 'visible' });
    assert.match(await fallback.textContent(), /Chrome|Edge/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('display modes alter actual scene state', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    const initial = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(initial.meshCount, 48, 'the PlaneHelper child must not count as a selectable model Mesh');
    assert.equal(initial.shellOpacity, 1);
    assert.equal(initial.internalOpacity, 1);
    assert.equal(initial.activeClipAxis, null);
    assert.equal(initial.explodedOffset, 0);
    assert.equal(initial.clippedMaterialCount, 0);
    assert.equal(initial.clipHelperVisible, false);
    for (const material of [...initial.shellMaterials, ...initial.internalMaterials]) {
      assert.equal(material.clipShadows, false, 'clipping must not affect shadows outside section mode');
    }

    await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'exploded' }));
    await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_EXPLOSION', value: 1 }));
    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset > 0.5);
    const exploded = await page.evaluate(() => window.armDemo.inspect());
    const basePartIds = [
      'base-plate', 'base-shell', 'base-service-cover',
      'anchor-bolt-1', 'anchor-bolt-2', 'anchor-bolt-3', 'anchor-bolt-4'
    ];
    for (const partId of basePartIds) {
      assert.deepEqual(exploded.partDisplacements[partId], [0, 0, 0],
        `${partId} must remain fixed instead of moving below ground`);
    }
    assert.ok(exploded.partDisplacements['turntable-motor'][1] < -0.1,
      'non-base assemblies must still separate from the fixed base');

    await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'shell' }));
    await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_SHELL_TRANSPARENCY', value: 0.75 }));
    const shell = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(shell.shellOpacity, 0.25);
    assert.equal(shell.internalOpacity, 1);
    assert.ok(shell.shellMaterials.length > 0);
    for (const material of shell.shellMaterials) {
      assert.equal(material.opacity, 0.25);
      assert.equal(material.transparent, true);
      assert.equal(material.depthWrite, false);
    }
    assert.ok(shell.internalMaterials.length > 0);
    for (const material of shell.internalMaterials) {
      assert.equal(material.opacity, 1);
    }

    await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'section' }));
    const clipCases = [
      { axis: 'x', position: 0.25, normal: [-1, 0, 0], constant: 1 },
      { axis: 'y', position: -0.5, normal: [0, -1, 0], constant: -2 },
      { axis: 'z', position: 0.75, normal: [0, 0, -1], constant: 3 }
    ];
    for (const clipCase of clipCases) {
      await page.evaluate(({ axis, position }) => {
        window.armDemo.dispatch({ type: 'SET_CLIP_AXIS', axis });
        window.armDemo.dispatch({ type: 'SET_CLIP_POSITION', value: position });
      }, clipCase);
      const section = await page.evaluate(() => window.armDemo.inspect());
      assert.equal(section.activeClipAxis, clipCase.axis);
      assert.deepEqual(section.clipNormal, clipCase.normal);
      assert.equal(section.clipConstant, clipCase.constant);
      assert.equal(section.clipHelperVisible, true);
      assert.equal(section.clippedMaterialCount, section.shellMaterials.length + section.internalMaterials.length,
        'the one real plane must be assigned to every model material');
      for (const material of [...section.shellMaterials, ...section.internalMaterials]) {
        assert.equal(material.clipShadows, true, 'clipped geometry must not cast a full ghost shadow');
      }
      assert.equal(section.meshCount, initial.meshCount, 'the PlaneHelper must not become a model Mesh');
    }

    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.001);
    const clippedPicking = await page.evaluate(() => {
      window.armDemo.dispatch({ type: 'SET_CLIP_AXIS', axis: 'y' });
      window.armDemo.dispatch({ type: 'SET_CLIP_POSITION', value: 0.5 });
      return {
        elbow: window.armDemo.getPartScreenPosition('elbow-right-shell'),
        base: window.armDemo.getPartScreenPosition('base-service-cover')
      };
    });
    await page.mouse.click(clippedPicking.base.x, clippedPicking.base.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'base-service-cover',
      'a retained base part must remain selectable in section mode');
    await page.mouse.click(clippedPicking.elbow.x, clippedPicking.elbow.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null,
      'clicking the clipped elbow at its original position must clear selection instead of picking invisible geometry');
    await page.mouse.click(clippedPicking.base.x, clippedPicking.base.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'base-service-cover',
      'picking must resume at the first visible base hit after an empty clipped hit');

    await page.evaluate(() => window.armDemo.dispatch({ type: 'RESET' }));
    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.001);
    const reset = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(reset.shellOpacity, 1);
    assert.equal(reset.internalOpacity, 1);
    assert.equal(reset.activeClipAxis, null);
    assert.equal(reset.clippedMaterialCount, 0);
    assert.equal(reset.clipHelperVisible, false);
    for (const material of [...reset.shellMaterials, ...reset.internalMaterials]) {
      assert.equal(material.clipShadows, false, 'leaving section mode must restore unclipped shadows');
    }
    for (const material of reset.shellMaterials) {
      assert.equal(material.opacity, 1);
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
    }
    for (const displacement of Object.values(reset.partDisplacements)) {
      assert.ok(Math.hypot(...displacement) < 0.001, 'reset must restore every real part position');
    }

    await page.evaluate(() => {
      window.armDemo.dispatch({ type: 'SET_SHELL_TRANSPARENCY', value: 0.75 });
      window.armDemo.dispatch({ type: 'SET_MODE', mode: 'shell' });
      window.armDemo.dispatch({ type: 'SET_MODE', mode: 'assembly' });
    });
    const assembly = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(assembly.shellOpacity, 1, 'assembly mode must restore real shell opacity');
    assert.equal(assembly.activeClipAxis, null);
    assert.equal(assembly.clippedMaterialCount, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('teaching controls update real scene state, focus every assembly, and fully reset', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    const home = await page.evaluate(() => {
      const state = window.armDemo.inspect();
      return { position: state.cameraPosition, target: state.cameraTarget };
    });

    await page.click('[data-mode="exploded"]');
    assert.equal(await page.locator('#explosion-control').isVisible(), true);
    assert.equal(await page.locator('#shell-control').isVisible(), false);
    assert.equal(await page.locator('#section-control').isVisible(), false);
    await page.locator('#explosion').evaluate(el => {
      el.value = '65';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#explosion-value').textContent(), '65%');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().explosion), 0.65);
    assert.equal(await page.locator('[data-mode="exploded"]').getAttribute('aria-pressed'), 'true');

    await page.click('[data-mode="shell"]');
    assert.equal(await page.locator('#explosion-control').isVisible(), false);
    assert.equal(await page.locator('#shell-control').isVisible(), true);
    await page.locator('#shell').evaluate(el => {
      el.value = '42';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#shell-value').textContent(), '42%');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().shellTransparency), 0.42);
    assert.ok(Math.abs(await page.evaluate(() => window.armDemo.inspect().shellOpacity) - 0.58) < 1e-12);

    await page.click('[data-mode="section"]');
    assert.equal(await page.locator('#section-control').isVisible(), true);
    assert.equal(await page.locator('#shell-control').isVisible(), false);
    for (const axis of ['x', 'y', 'z']) {
      await page.click(`[data-axis="${axis}"]`);
      assert.equal(await page.evaluate(() => window.armDemo.inspect().activeClipAxis), axis);
      assert.equal(await page.locator(`[data-axis="${axis}"]`).getAttribute('aria-pressed'), 'true');
    }
    await page.click('[data-axis="y"]');
    await page.locator('#clip-position').evaluate(el => {
      el.value = '-37';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#clip-value').textContent(), '-0.37');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().clipPosition), -0.37);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().clipConstant), -1.48);

    await page.click('[data-mode="assembly"]');
    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.01);
    for (const selector of ['#explosion-control', '#shell-control', '#section-control']) {
      assert.equal(await page.locator(selector).isVisible(), false);
    }
    for (const mode of ['assembly', 'exploded', 'shell', 'section']) {
      assert.equal(await page.locator(`[data-mode="${mode}"]`).isVisible(), true);
      assert.equal(await page.locator(`[data-mode="${mode}"]`).isEnabled(), true);
    }

    const assemblyButtons = page.locator('[data-assembly]');
    assert.equal(await assemblyButtons.count(), 8, 'all model assemblies must have native focus buttons');
    for (let index = 0; index < await assemblyButtons.count(); index += 1) {
      const button = assemblyButtons.nth(index);
      const id = await button.getAttribute('data-assembly');
      assert.equal(await button.evaluate(el => el.tagName), 'BUTTON');
      await button.click();
      assert.equal(await page.evaluate(() => window.armDemo.inspect().focusedAssembly), id);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assertProjectionContained(await page.evaluate(id => window.armDemo.getAssemblyProjection(id), id));
    }

    await page.evaluate(() => window.armDemo.setView([12, 9, 14], [1, 3, 0]));
    await page.click('#reset-view');
    const reset = await page.evaluate(() => window.armDemo.inspect());
    assert.equal(reset.mode, 'assembly');
    assert.equal(reset.explosion, 0);
    assert.equal(reset.shellTransparency, 0);
    assert.equal(reset.clipAxis, 'x');
    assert.equal(reset.clipPosition, 0);
    assert.equal(reset.selectedPart, null);
    assert.equal(reset.focusedAssembly, null);
    assert.equal(reset.activeClipAxis, null);
    assert.equal(reset.shellOpacity, 1);
    assert.equal(reset.explodedOffset, 0);
    assert.equal(await page.locator('#explosion').inputValue(), '0');
    assert.equal(await page.locator('#shell').inputValue(), '0');
    assert.equal(await page.locator('#clip-position').inputValue(), '0');
    assert.equal(await page.locator('#explosion-value').textContent(), '0%');
    assert.equal(await page.locator('#shell-value').textContent(), '0%');
    assert.equal(await page.locator('#clip-value').textContent(), '0.00');
    assert.equal(await page.locator('[data-mode="assembly"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-axis="x"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-assembly][aria-pressed="true"]').count(), 0);
    for (let index = 0; index < 3; index += 1) {
      assert.ok(Math.abs(reset.cameraPosition[index] - home.position[index]) < 1e-6);
      assert.ok(Math.abs(reset.cameraTarget[index] - home.target[index]) < 1e-6);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('real part picking shows Chinese teaching details and restores highlights and selection', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.click('[data-mode="exploded"]');
    await page.locator('#explosion').evaluate(el => {
      el.value = '65';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#explosion-value').textContent(), '65%');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().explosion), 0.65);
    await page.click('[data-mode="section"]');
    await page.click('[data-axis="y"]');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().activeClipAxis), 'y');
    await page.click('[data-mode="assembly"]');
    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.01);

    const point = await page.evaluate(() => window.armDemo.getPartScreenPosition('shoulder-right-shell'));
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'shoulder-right-shell');
    assert.match(await page.locator('#part-details').textContent(), /肩关节|电机/);
    assert.match(await page.locator('#part-details').textContent(), /二轴肩关节/);
    assert.match(await page.locator('#part-details').textContent(), /减速器/);
    let highlights = await page.evaluate(() => window.armDemo.inspect().highlightedMeshes);
    assert.deepEqual(highlights.map(mesh => mesh.partId), ['shoulder-right-shell']);
    assert.equal(highlights[0].emissive, 0xff7a1a);

    const nextPoint = await page.evaluate(() => window.armDemo.getPartScreenPosition('elbow-right-shell'));
    await page.mouse.click(nextPoint.x, nextPoint.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'elbow-right-shell');
    highlights = await page.evaluate(() => window.armDemo.inspect().highlightedMeshes);
    assert.deepEqual(highlights.map(mesh => mesh.partId), ['elbow-right-shell'], 'previous emissive must be restored');

    await page.mouse.click(1400, 850);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().highlightedMeshes.length), 0);
    assert.match(await page.locator('#part-details').textContent(), /点击零件查看结构说明/);

    await page.click('[data-mode="exploded"]');
    await page.locator('#explosion').evaluate(el => {
      el.value = '100';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.armDemo.inspect().partDisplacements['shoulder-right-shell'][2] > 0.37);
    await page.evaluate(() => window.armDemo.setView([-1.5, 10, 0.001], [-1.5, 1.52, 0]));
    const motorPoint = await page.evaluate(() => window.armDemo.getPartScreenPosition('shoulder-motor'));
    await page.mouse.click(motorPoint.x, motorPoint.y);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'shoulder-motor');
    assert.match(await page.locator('#part-details').textContent(), /肩部伺服电机/);
    assert.match(await page.locator('#part-details').textContent(), /驱动力矩/);
    highlights = await page.evaluate(() => window.armDemo.inspect().highlightedMeshes);
    assert.deepEqual(highlights.map(mesh => mesh.partId), ['shoulder-motor']);

    await page.click('#reset-view');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().mode), 'assembly');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().focusedAssembly), null);
    assert.equal(await page.evaluate(() => window.armDemo.inspect().highlightedMeshes.length), 0);
    assert.match(await page.locator('#part-details').textContent(), /点击零件查看结构说明/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('narrow bottom sheets and all teaching controls remain keyboard accessible', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.setViewportSize({ width: 390, height: 844 });
    const controlToggle = page.locator('#control-panel .panel-toggle');
    const assemblyToggle = page.locator('#assembly-panel .panel-toggle');
    await controlToggle.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#control-panel .panel-toggle').getAttribute('aria-expanded') === 'false');
    assert.equal(await controlToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#viewport canvas').isVisible(), true);

    await controlToggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await controlToggle.getAttribute('aria-expanded'), 'true');
    await page.locator('#reset-view').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#reset-view').isVisible(), true);
    const resetBox = await page.locator('#reset-view').boundingBox();
    assert.ok(resetBox.x >= 0 && resetBox.y >= 0);
    assert.ok(resetBox.x + resetBox.width <= 390 && resetBox.y + resetBox.height <= 844,
      'reset must be reachable inside the narrow viewport after scrolling its panel');

    await page.locator('[data-mode="exploded"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().mode), 'exploded');
    await page.locator('#explosion').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().explosion), 0.01);
    assert.equal(await page.locator('#explosion-value').textContent(), '1%');

    await assemblyToggle.focus();
    await page.keyboard.press('Space');
    assert.equal(await assemblyToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await controlToggle.getAttribute('aria-expanded'), 'false', 'opening one sheet closes the other');
    const firstAssembly = page.locator('[data-assembly]').first();
    const assemblyId = await firstAssembly.getAttribute('data-assembly');
    await firstAssembly.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.armDemo.inspect().focusedAssembly), assemblyId);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('short viewports keep expanded part details clear and assembly focus reachable', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    await page.evaluate(() => window.armDemo.dispatch({ type: 'SELECT_PART', partId: 'shoulder-right-shell' }));
    await page.waitForFunction(() => document.querySelector('#part-details').dataset.partId === 'shoulder-right-shell');

    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 360 }]) {
      await page.setViewportSize(viewport);
      const assemblyToggle = page.locator('#assembly-panel .panel-toggle');
      if (await assemblyToggle.isVisible()) {
        await page.waitForFunction(() => document.querySelector('#assembly-panel .panel-toggle').getAttribute('aria-expanded') === 'false');
        await assemblyToggle.click();
        assert.equal(await assemblyToggle.getAttribute('aria-expanded'), 'true');
      }

      const layout = await page.evaluate(() => {
        const rect = selector => {
          const { left, top, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { left, top, right, bottom, width, height };
        };
        const panel = document.querySelector('#assembly-panel');
        return {
          assembly: rect('#assembly-panel'),
          controls: rect('#control-panel'),
          details: rect('#part-details'),
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight
        };
      });
      for (const panelName of ['assembly', 'controls']) {
        const panel = layout[panelName];
        const details = layout.details;
        const overlaps = details.left < panel.right && details.right > panel.left &&
          details.top < panel.bottom && details.bottom > panel.top;
        assert.equal(overlaps, false,
          `expanded part details must not intersect ${panelName} at ${viewport.width}x${viewport.height}: ${JSON.stringify({ panel, details })}`);
      }
      assert.ok(layout.scrollHeight > layout.clientHeight,
        `assembly panel must scroll at ${viewport.width}x${viewport.height}`);

      const lastAssembly = page.locator('[data-assembly]').last();
      const assemblyId = await lastAssembly.getAttribute('data-assembly');
      await lastAssembly.scrollIntoViewIfNeeded();
      const buttonBox = await lastAssembly.boundingBox();
      assert.ok(buttonBox.x >= 0 && buttonBox.y >= 0);
      assert.ok(buttonBox.x + buttonBox.width <= viewport.width && buttonBox.y + buttonBox.height <= viewport.height,
        `last assembly button must be reachable at ${viewport.width}x${viewport.height}`);
      assert.ok(await page.locator('#assembly-panel').evaluate(panel => panel.scrollTop > 0),
        `reaching the last assembly button must scroll its panel at ${viewport.width}x${viewport.height}`);
      await lastAssembly.click();
      assert.equal(await page.evaluate(() => window.armDemo.inspect().focusedAssembly), assemblyId,
        `scrolled assembly focus must work at ${viewport.width}x${viewport.height}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('short viewports keep expanded controls scrollable and reset reachable', async () => {
  const browser = await launchBrowser();
  try {
    const { page, errors } = await openScene(browser);
    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 360 }]) {
      await page.setViewportSize(viewport);
      const toggle = page.locator('#control-panel .panel-toggle');
      if (await toggle.isVisible()) {
        await page.waitForFunction(() => document.querySelector('#control-panel .panel-toggle').getAttribute('aria-expanded') === 'false');
        const toggleBox = await toggle.boundingBox();
        assert.ok(toggleBox.y >= 0 && toggleBox.y + toggleBox.height <= viewport.height,
          `panel toggle must be visible at ${viewport.width}x${viewport.height}`);
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      }

      await page.click('[data-mode="exploded"]');
      const reset = page.locator('#reset-view');
      await reset.scrollIntoViewIfNeeded();
      const resetBox = await reset.boundingBox();
      assert.ok(resetBox.x >= 0 && resetBox.y >= 0);
      assert.ok(resetBox.x + resetBox.width <= viewport.width && resetBox.y + resetBox.height <= viewport.height,
        `reset must be reachable at ${viewport.width}x${viewport.height}`);
      const panelScroll = await page.locator('#control-panel').evaluate(panel => ({
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        scrollTop: panel.scrollTop
      }));
      assert.ok(panelScroll.scrollHeight > panelScroll.clientHeight,
        `expanded controls must use panel scrolling at ${viewport.width}x${viewport.height}`);
      assert.ok(panelScroll.scrollTop > 0, 'reaching reset must scroll the relevant panel');
      await reset.click();
      assert.equal(await page.evaluate(() => window.armDemo.inspect().mode), 'assembly');
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('required previews capture settled desktop modes and expanded narrow controls', async t => {
  const browser = await launchBrowser();
  try {
    const { page, errors, externalRequests } = await openScene(browser);
    await page.screenshot({ path: resolve('preview.png'), fullPage: true });

    await page.click('[data-mode="exploded"]');
    await page.locator('#explosion').evaluate(input => {
      input.value = '65';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const explosionSettlement = await waitForExplosionToSettle(page);
    t.diagnostic(`explosion frame settlement: ${JSON.stringify(explosionSettlement)}`);
    await page.screenshot({ path: resolve('preview-exploded.png'), fullPage: true });

    await page.click('[data-mode="shell"]');
    await page.locator('#shell').evaluate(input => {
      input.value = '75';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.001);
    await page.screenshot({ path: resolve('preview-shell.png'), fullPage: true });

    await page.click('[data-mode="section"]');
    await page.click('[data-axis="y"]');
    await page.locator('#clip-position').evaluate(input => {
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: resolve('preview-section.png'), fullPage: true });

    await page.click('#reset-view');
    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = page.locator('#control-panel .panel-toggle');
    await page.waitForFunction(() => document.querySelector('#control-panel .panel-toggle').getAttribute('aria-expanded') === 'false');
    await toggle.click();
    await page.locator('#reset-view').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('preview-narrow.png'), fullPage: true });

    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
