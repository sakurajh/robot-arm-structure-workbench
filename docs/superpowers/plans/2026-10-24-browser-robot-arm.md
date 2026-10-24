# Browser Robot Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based 3D robot-arm teaching demo with exploded, transparent-shell, and sectional views, delivered as one offline double-clickable HTML file.

**Architecture:** Procedural Three.js parts are grouped by assembly and tracked in a part registry. A pure state reducer drives a display controller for explosion, shell transparency, clipping, selection, and reset; esbuild embeds the complete application and all runtime dependencies into `index.html`.

**Tech Stack:** JavaScript ES modules, Three.js 0.180.0, OrbitControls, esbuild 0.25.10, Node.js 24 built-in test runner, playwright-core 1.56.0 with the installed Chrome executable.

**Spec:** `docs/superpowers/specs/2026-10-24-browser-robot-arm-design.md`

## Global Constraints

- The final artifact is one double-clickable, offline `index.html`; users do not install Node.js or start a server.
- Use the built-in procedural teaching model; do not claim engineering-grade CAD accuracy.
- Bundle Three.js, OrbitControls, JavaScript, and CSS into the HTML; runtime CDN requests are forbidden.
- Include complete assembly, exploded view, transparent shell, X/Y/Z section, part picking, assembly focus, camera controls, and reset.
- Do not add joint-motion simulation, physics, accounts, backend services, or deployment.
- Desktop Chrome and Edge with WebGL2 are the target; narrow-screen controls must remain usable.
- Do not initialize Git or create commits in this non-Git workspace.
- Every completed task must run its listed tests; final delivery requires the complete unit and browser suites plus screenshot review.

---

## File Structure

- `package.json`: pinned build/test dependencies and npm scripts; not needed at runtime.
- `src/template.html`: semantic UI shell with inline-resource placeholders.
- `src/styles.css`: industrial theme, responsive panels, range controls, fallback message.
- `src/main.js`: application composition, state dispatch, render loop, public inspection API.
- `src/state.js`: pure view-state creation, reducer, clamping, and reset behavior.
- `src/model.js`: procedural geometry, assembly hierarchy, part metadata, and explosion vectors.
- `src/viewer.js`: renderer, camera, lights, controls, raycasting, focus, and resize handling.
- `src/display.js`: application of explosion, shell transparency, clipping planes, and selection state.
- `src/ui.js`: mode buttons, sliders, numeric readouts, assembly tree, part details, and panel toggles.
- `scripts/build.mjs`: bundle and inline all runtime resources into `index.html`.
- `tests/build.test.mjs`: standalone package and external-reference checks.
- `tests/state.test.mjs`: reducer and boundary tests.
- `tests/model.test.mjs`: model hierarchy and metadata tests.
- `tests/browser.test.mjs`: real Chrome `file://` interaction, rendering, offline, and fallback tests.
- `index.html`: generated final artifact.
- `preview*.png`: generated verification screenshots; not required at runtime.

### Task 1: Offline Application Shell and Build

**Files:**
- Create: `package.json`
- Create: `src/template.html`
- Create: `src/styles.css`
- Create: `src/main.js`
- Create: `scripts/build.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: no prior modules.
- Produces: `npm run build`, which writes a self-contained `index.html`; DOM IDs `viewport`, `assembly-tree`, `part-details`, `mode-controls`, `explosion-control`, `shell-control`, `section-control`, `reset-view`, and `webgl-error` for later tasks.

- [ ] **Step 1: Create the pinned toolchain and install dependencies**

```json
{
  "name": "offline-robot-arm-demo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "test:unit": "node --test tests/build.test.mjs tests/state.test.mjs tests/model.test.mjs",
    "test:browser": "node --test tests/browser.test.mjs",
    "test": "npm run build && npm run test:unit && npm run test:browser"
  },
  "devDependencies": {
    "esbuild": "0.25.10",
    "playwright-core": "1.56.0",
    "three": "0.180.0"
  }
}
```

Run: `npm install`
Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 2: Write the failing offline-package test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index.html is a self-contained application shell', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['viewport', 'assembly-tree', 'part-details', 'mode-controls', 'reset-view', 'webgl-error']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.doesNotMatch(html, /\/\* INLINE_(?:CSS|JS) \*\//);
});
```

Run: `node --test tests/build.test.mjs`
Expected: FAIL because `index.html` does not exist.

- [ ] **Step 3: Implement the semantic template and responsive industrial theme**

Use buttons with `data-mode="assembly|exploded|shell|section"`, three range panels, and these initial controls:

```html
<main id="app">
  <section id="viewport" aria-label="3D 机械臂视口"></section>
  <aside id="assembly-panel"><h2>总成层级</h2><nav id="assembly-tree"></nav></aside>
  <aside id="control-panel">
    <div id="mode-controls" aria-label="展示模式">
      <button data-mode="assembly">完整装配</button>
      <button data-mode="exploded">爆炸图</button>
      <button data-mode="shell">透明外壳</button>
      <button data-mode="section">剖面图</button>
    </div>
    <label id="explosion-control">爆炸距离 <output id="explosion-value">0%</output>
      <input id="explosion" type="range" min="0" max="100" value="0">
    </label>
    <label id="shell-control">外壳透明度 <output id="shell-value">0%</output>
      <input id="shell" type="range" min="0" max="100" value="0">
    </label>
    <section id="section-control">
      <div id="clip-axes"><button data-axis="x">X</button><button data-axis="y">Y</button><button data-axis="z">Z</button></div>
      <label>剖切位置 <output id="clip-value">0.00</output>
        <input id="clip-position" type="range" min="-100" max="100" value="0">
      </label>
    </section>
    <button id="reset-view">一键复位</button>
  </aside>
  <section id="part-details" aria-live="polite">点击零件查看结构说明</section>
  <div id="webgl-error" hidden>无法初始化 WebGL2，请使用支持硬件加速的新版 Chrome 或 Edge。</div>
</main>
```

Define `src/styles.css` with a dark full-viewport grid, absolute/floating desktop panels, visible focus rings, orange selected mode, and an `@media (max-width: 760px)` rule that docks controls at the bottom with `max-height: 42vh; overflow: auto`. Keep `#viewport` at `position: fixed; inset: 0` and canvas at `width: 100%; height: 100%; display: block`.

- [ ] **Step 4: Implement the single-file build**

```js
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

export async function buildOffline() {
  const result = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    write: false
  });
  const [template, css] = await Promise.all([
    readFile('src/template.html', 'utf8'),
    readFile('src/styles.css', 'utf8')
  ]);
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = template
    .replace('/* INLINE_CSS */', () => css)
    .replace('/* INLINE_JS */', () => js);
  await writeFile('index.html', html);
}

await buildOffline();
```

Place `<style>/* INLINE_CSS */</style>` before `</head>` and `<script>/* INLINE_JS */</script>` before `</body>`. Initially `src/main.js` only sets `document.documentElement.dataset.ready = 'shell'`; later tasks replace this entry composition.

- [ ] **Step 5: Build and verify the shell**

Run: `npm run build && node --test tests/build.test.mjs`
Expected: PASS, and `index.html` opens without a server or network dependency.

### Task 2: Pure View State

**Files:**
- Create: `src/state.js`
- Test: `tests/state.test.mjs`

**Interfaces:**
- Consumes: no DOM or Three.js objects.
- Produces: `createViewState()`, `reduceViewState(state, action)`, `clipPlaneDefinition(state)`, and `initialViewState`. State shape is `{mode, explosion, shellTransparency, clipAxis, clipPosition, selectedPart}`.

- [ ] **Step 1: Write failing reducer tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewState, reduceViewState, clipPlaneDefinition } from '../src/state.js';

test('mode actions and numeric controls clamp to documented ranges', () => {
  let s = createViewState();
  s = reduceViewState(s, { type: 'SET_MODE', mode: 'exploded' });
  s = reduceViewState(s, { type: 'SET_EXPLOSION', value: 2 });
  s = reduceViewState(s, { type: 'SET_SHELL_TRANSPARENCY', value: -1 });
  s = reduceViewState(s, { type: 'SET_CLIP_POSITION', value: -3 });
  assert.equal(s.mode, 'exploded');
  assert.equal(s.explosion, 1);
  assert.equal(s.shellTransparency, 0);
  assert.equal(s.clipPosition, -1);
});

test('section axis and reset are deterministic', () => {
  let s = reduceViewState(createViewState(), { type: 'SET_CLIP_AXIS', axis: 'z' });
  s = reduceViewState(s, { type: 'SELECT_PART', partId: 'elbow-motor' });
  assert.deepEqual(clipPlaneDefinition(s), { axis: 'z', position: 0 });
  assert.equal(reduceViewState(s, { type: 'RESET' }).selectedPart, null);
  assert.equal(reduceViewState(s, { type: 'SET_MODE', mode: 'invalid' }).mode, 'assembly');
});
```

Run: `node --test tests/state.test.mjs`
Expected: FAIL because `src/state.js` is missing.

- [ ] **Step 2: Implement the reducer and clipping definition**

```js
const modes = new Set(['assembly', 'exploded', 'shell', 'section']);
const axes = new Set(['x', 'y', 'z']);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

export const initialViewState = Object.freeze({
  mode: 'assembly', explosion: 0, shellTransparency: 0,
  clipAxis: 'x', clipPosition: 0, selectedPart: null
});
export const createViewState = () => ({ ...initialViewState });

export function reduceViewState(state, action) {
  switch (action.type) {
    case 'SET_MODE': return { ...state, mode: modes.has(action.mode) ? action.mode : 'assembly' };
    case 'SET_EXPLOSION': return { ...state, explosion: clamp(action.value) };
    case 'SET_SHELL_TRANSPARENCY': return { ...state, shellTransparency: clamp(action.value) };
    case 'SET_CLIP_AXIS': return { ...state, clipAxis: axes.has(action.axis) ? action.axis : 'x' };
    case 'SET_CLIP_POSITION': return { ...state, clipPosition: clamp(action.value, -1, 1) };
    case 'SELECT_PART': return { ...state, selectedPart: action.partId ?? null };
    case 'RESET': return createViewState();
    default: return state;
  }
}

export function clipPlaneDefinition(state) {
  return { axis: state.clipAxis, position: state.clipPosition };
}
```

- [ ] **Step 3: Run state tests**

Run: `node --test tests/state.test.mjs`
Expected: PASS for valid modes, invalid values, all numeric limits, selection, and reset.

### Task 3: Procedural Six-Axis Teaching Model

**Files:**
- Create: `src/model.js`
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: Three.js geometry and materials.
- Produces: `buildRobotArm()` returning `{root, parts, assemblies, shellMeshes, bounds}`. `parts` is a `Map<string, {id,name,assembly,description,object,basePosition,explodeVector,isShell}>`; every selectable mesh has `userData.partId`.

- [ ] **Step 1: Write failing model-contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRobotArm } from '../src/model.js';

test('model exposes six joints, teaching metadata, and selectable parts', () => {
  const model = buildRobotArm();
  assert.equal(model.assemblies.size, 8);
  assert.ok(model.parts.size >= 30);
  assert.equal(model.shellMeshes.length >= 8, true);
  for (const part of model.parts.values()) {
    assert.ok(part.name && part.description && part.assembly);
    assert.ok(part.explodeVector.isVector3);
    part.object.traverse(node => {
      if (node.isMesh) assert.equal(node.userData.partId, part.id);
    });
  }
  model.root.traverse(node => {
    if (node.userData.jointAxis) assert.ok(['x', 'y', 'z'].includes(node.userData.jointAxis));
  });
});
```

Run: `node --test tests/model.test.mjs`
Expected: FAIL because `buildRobotArm` is not defined.

- [ ] **Step 2: Implement part registration and reusable geometry helpers**

```js
import * as THREE from 'three';

export function buildRobotArm() {
  const root = new THREE.Group();
  const parts = new Map();
  const assemblies = new Map();
  const shellMeshes = [];

  function assembly(id, name, explodeVector) {
    const object = new THREE.Group();
    object.name = id;
    root.add(object);
    assemblies.set(id, { id, name, object, explodeVector: new THREE.Vector3(...explodeVector) });
    return object;
  }

  function part(parent, data, geometry, material, position = [0, 0, 0]) {
    const object = new THREE.Group();
    object.position.set(...position);
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = data.id;
    object.add(mesh);
    parent.add(object);
    const record = { ...data, object, basePosition: object.position.clone(),
      explodeVector: new THREE.Vector3(...data.explodeVector), isShell: Boolean(data.isShell) };
    parts.set(data.id, record);
    if (record.isShell) shellMeshes.push(mesh);
    return object;
  }
```

Use reusable `cylinder`, `box`, `torus`, and `sphere` geometry factories. Create eight assemblies with exact IDs `base`, `turntable`, `shoulder`, `upper-arm`, `elbow`, `forearm`, `wrist`, `gripper`. Give every assembly a distinct explosion direction in model units. Add six visible joint housings and set `object.userData.jointAxis` on their groups. Use separate shell and internal materials; never share a shell material instance with internal parts.

- [ ] **Step 3: Build the complete arm from named parts**

Construct at least 30 registered parts: base plate, anchor bolts, slew bearing, rotary table, shoulder motor, shoulder reducer, upper-arm left/right shells, upper-arm shaft, elbow motor, elbow reducer, forearm shells, forearm shaft, wrist motors, wrist rings, flange, gripper body, two fingers, and visible fasteners. Use ivory shells, orange joint rings, dark metal shafts, and silver motors. Set `root.position.y = 0`, compute `bounds = new THREE.Box3().setFromObject(root)`, and return `{root, parts, assemblies, shellMeshes, bounds}`. Every part record includes a concise Chinese teaching description and a stable ID such as `shoulder-motor` or `elbow-reducer`.

- [ ] **Step 4: Run model tests and rebuild**

Run: `node --test tests/model.test.mjs && npm run build`
Expected: model tests PASS and the bundle compiles without browser globals in `model.js`.

### Task 4: 3D Viewer, Camera, Lighting, and Picking

**Files:**
- Create: `src/viewer.js`
- Modify: `src/main.js`
- Test: `tests/browser.test.mjs`

**Interfaces:**
- Consumes: `buildRobotArm()` and the `viewport` element.
- Produces: `createViewer(container, model, {onSelect})` returning `{canvas, controls, camera, renderer, focusAssembly, focusPart, getPartScreenPosition, resize, render, dispose}`.

- [ ] **Step 1: Write the failing real-browser smoke test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('file:// page creates a nonempty WebGL scene', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30);
  const snapshot = await page.evaluate(() => window.armDemo.inspect());
  assert.ok(snapshot.meshCount >= 30);
  assert.ok(snapshot.canvasWidth > 0 && snapshot.canvasHeight > 0);
  assert.deepEqual(errors, []);
  await browser.close();
});
```

Run: `npm run build && node --test tests/browser.test.mjs`
Expected: FAIL because no rendered model or `armDemo` API exists.

- [ ] **Step 2: Implement the WebGL2 viewer**

Create a canvas and explicitly obtain `webgl2`; throw `Error('WEBGL2_UNAVAILABLE')` when unavailable. Configure `THREE.WebGLRenderer` with antialiasing, ACES tone mapping, sRGB output, soft shadows, `localClippingEnabled = true`, and pixel ratio `Math.min(devicePixelRatio, 2)`. Add a dark scene, hemisphere light, key/rim directional lights, ground plane, and subtle grid. Fit the perspective camera to `model.bounds`; configure OrbitControls with damping and `zoomToCursor = true`.

Implement `focusAssembly(id)` and `focusPart(id)` by computing a `Box3`, then moving the controls target and camera while preserving viewing direction. Implement `getPartScreenPosition(id)` by projecting the part's world-space center into CSS pixel coordinates. Implement `resize()` with `ResizeObserver` and `render()` with controls update and renderer render.

- [ ] **Step 3: Implement raycast picking and application composition**

On pointer up, ignore gestures moved more than five pixels. Raycast `model.root` descendants, find `intersections[0].object.userData.partId`, and call `onSelect(partId)`. In `src/main.js`, create state and model, instantiate viewer/UI, dispatch actions through `reduceViewState`, and expose:

```js
window.armDemo = {
  inspect: () => ({ meshCount: model.parts.size, ...viewState,
    canvasWidth: viewer.canvas.width, canvasHeight: viewer.canvas.height }),
  getPartScreenPosition: viewer.getPartScreenPosition
};
```

Catch `WEBGL2_UNAVAILABLE`, unhide `#webgl-error`, and keep the error readable without throwing an uncaught page error. Start rendering only after successful viewer initialization.

- [ ] **Step 4: Run the browser smoke test**

Run: `npm run build && node --test tests/browser.test.mjs`
Expected: PASS with at least 30 registered parts, a positive canvas size, and no page errors.

### Task 5: Exploded, Transparent-Shell, and Sectional Rendering

**Files:**
- Create: `src/display.js`
- Modify: `src/main.js`
- Modify: `src/viewer.js`
- Test: `tests/browser.test.mjs`

**Interfaces:**
- Consumes: `createViewState`, `reduceViewState`, and the model registry.
- Produces: `createDisplayController(model)` returning `{update(state, delta), snap(state), inspect()}`; `inspect()` reports `shellOpacity`, `internalOpacity`, `activeClipAxis`, and `explodedOffset`.

- [ ] **Step 1: Add failing mode-state browser tests**

```js
test('display modes alter actual scene state', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30);
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'exploded' }));
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_EXPLOSION', value: 1 }));
  await page.waitForFunction(() => window.armDemo.inspect().explodedOffset > 0.5);
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'shell' }));
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_SHELL_TRANSPARENCY', value: 0.75 }));
  const shell = await page.evaluate(() => window.armDemo.inspect());
  assert.equal(shell.shellOpacity, 0.25);
  assert.equal(shell.internalOpacity, 1);
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_MODE', mode: 'section' }));
  await page.evaluate(() => window.armDemo.dispatch({ type: 'SET_CLIP_AXIS', axis: 'z' }));
  assert.equal(await page.evaluate(() => window.armDemo.inspect().activeClipAxis), 'z');
  await browser.close();
});
```

Run: `node --test tests/browser.test.mjs`
Expected: FAIL because mode rendering and dispatch inspection are not implemented.

- [ ] **Step 2: Implement display transformations**

`createDisplayController(model)` stores each part's base position. For `exploded`, target position is `basePosition + explodeVector * explosion`; otherwise target is `basePosition`. `update` damps positions with `1 - Math.exp(-12 * delta)`; `snap` assigns targets directly. Set `inspect().explodedOffset` to the maximum current displacement length.

For every shell mesh, set `material.transparent = state.mode === 'shell' && state.shellTransparency > 0`, `material.opacity = 1 - state.shellTransparency`, `material.depthWrite = !material.transparent`, and update `needsUpdate` only when transparency mode changes. Internal materials retain opacity 1. Clamp opacity to [0, 1].

For `section`, create one `THREE.Plane`; use a unit normal opposite the selected positive axis and `constant = state.clipPosition * 4`. Assign `[plane]` to every model material's `clippingPlanes`; otherwise assign `[]`. Expose `activeClipAxis` as the selected axis or `null` through `display.inspect()`, and merge those fields into `armDemo.inspect()`. Add a non-clipped plane helper only in section mode.

- [ ] **Step 3: Connect state dispatch to real rendering**

Add `window.armDemo.dispatch(action)`, which reduces state, updates UI, and returns `inspect()`. Drive `display.update(viewState, delta)` in the render loop. On mode switches to assembly or on reset, clear clipping and restore shell opacity; do not mutate base positions. Keep selection independent of display mode.

- [ ] **Step 4: Run all mode tests**

Run: `npm run build && node --test tests/browser.test.mjs`
Expected: exploded offset exceeds 0.5, shell opacity is 0.25 while internal opacity remains 1, and Z clipping is active.

### Task 6: Complete Teaching UI and Interaction

**Files:**
- Create: `src/ui.js`
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Test: `tests/browser.test.mjs`

**Interfaces:**
- Consumes: model assemblies/parts, `reduceViewState`, and `window.armDemo.dispatch` equivalent internal dispatch.
- Produces: `createUI(model, dispatch)` returning `{render(state), showPart(partId)}`; UI emits only documented reducer actions.

- [ ] **Step 1: Add failing interaction tests**

Add browser tests that perform these exact operations and assertions:

```js
await page.click('[data-mode="exploded"]');
await page.locator('#explosion').evaluate(el => { el.value = '65'; el.dispatchEvent(new Event('input', { bubbles: true })); });
assert.equal(await page.locator('#explosion-value').textContent(), '65%');
assert.equal(await page.evaluate(() => window.armDemo.inspect().explosion), 0.65);
await page.click('[data-mode="section"]');
await page.click('[data-axis="y"]');
assert.equal(await page.evaluate(() => window.armDemo.inspect().activeClipAxis), 'y');
await page.click('[data-mode="assembly"]');
await page.waitForFunction(() => window.armDemo.inspect().explodedOffset < 0.01);
const point = await page.evaluate(() => window.armDemo.getPartScreenPosition('shoulder-motor'));
await page.mouse.click(point.x, point.y);
assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), 'shoulder-motor');
assert.match(await page.locator('#part-details').textContent(), /肩部|电机/);
await page.click('#reset-view');
assert.equal(await page.evaluate(() => window.armDemo.inspect().mode), 'assembly');
assert.equal(await page.evaluate(() => window.armDemo.inspect().selectedPart), null);
```

Also click each assembly-tree button and assert that `inspect().focusedAssembly` matches its `data-assembly` value. Set viewport to `390 x 844`, open the controls, and assert `#reset-view` is visible within the viewport after scrolling its panel.

- [ ] **Step 2: Implement bindings and readable feedback**

`createUI` generates assembly buttons from `model.assemblies`, binds mode and axis buttons, converts range values between percentages and reducer fractions, and sets `aria-pressed` on active controls. `render(state)` updates numeric outputs, active classes, visible mode panels, and selection details. `showPart` displays the part name, assembly, and teaching description. Assembly buttons call `viewer.focusAssembly(id)` through an explicit UI callback and record `focusedAssembly` in application status.

Highlight the selected part by storing its original emissive color and applying orange emissive to its meshes; restore the previous selection before highlighting a new one. Clicking empty space clears selection. Reset restores state, camera, display, and focused assembly.

- [ ] **Step 3: Add responsive and keyboard-accessible behavior**

Use native buttons/ranges, visible `:focus-visible` outlines, labeled outputs, and panel-toggle buttons with `aria-expanded`. At widths at most 760 px, panels become collapsible bottom sheets and the 3D viewport remains visible. Do not use hover-only information or external fonts.

- [ ] **Step 4: Run unit and interaction suites**

Run: `npm run build && npm run test:unit && npm run test:browser`
Expected: all tests PASS, including sliders, readouts, all axes, part picking, assembly focus, reset, and narrow-screen controls.

### Task 7: Standalone Offline Verification and Visual Review

**Files:**
- Modify: `tests/browser.test.mjs`
- Create: `preview.png`
- Create: `preview-exploded.png`
- Create: `preview-shell.png`
- Create: `preview-section.png`
- Create: `preview-narrow.png`
- Verify: `index.html`

**Interfaces:**
- Consumes: the complete built application and all previous public interfaces.
- Produces: evidence that the HTML works alone offline and screenshots for final delivery.

- [ ] **Step 1: Add a copied-file offline test and request monitoring**

```js
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('copied HTML works alone without external requests', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'robot-arm-offline-'));
  await copyFile('index.html', join(temporary, 'index.html'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const externalRequests = [];
  const errors = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(pathToFileURL(join(temporary, 'index.html')).href);
  await page.waitForFunction(() => window.armDemo?.inspect().meshCount >= 30);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  await browser.close();
});
```

The test must copy only `index.html`, not source files or `node_modules`. Capture `pageerror` and console messages of type `error`; fail on application errors.

- [ ] **Step 2: Test the WebGL2-unavailable path**

Use `page.addInitScript` to wrap `HTMLCanvasElement.prototype.getContext` and return `null` for `webgl2` while delegating other context types. Navigate to the copied HTML, assert `#webgl-error` is visible, assert its text mentions Chrome or Edge, and assert no uncaught page error occurs.

- [ ] **Step 3: Capture all required screenshots**

Using a `1440 x 900` viewport, save the default view as `preview.png`, 65% exploded view as `preview-exploded.png`, 75% transparent shell as `preview-shell.png`, and a Y-axis section as `preview-section.png`. Save `390 x 844` with controls expanded as `preview-narrow.png`. Wait for explosion animation to settle before capturing. Use `page.screenshot({path, fullPage: true})`.

- [ ] **Step 4: Review screenshots and fix observable defects**

Open every PNG with the image-reading tool. Confirm the whole arm is visible, internal parts are distinguishable, exploded parts do not disappear off-screen, transparency does not make the arm unreadable, section mode visibly cuts geometry, text is legible, and narrow controls do not cover the entire model. If a defect is visible, fix the relevant source, rebuild, rerun the complete suite, and recapture all affected screenshots.

- [ ] **Step 5: Run the final verification command**

Run: `npm test`
Expected: build succeeds; all unit and browser tests PASS; zero external requests; zero uncaught application errors; all screenshots regenerate successfully.

Final delivery links `index.html` and `preview.png`, with concise instructions: download or locate `index.html`, double-click it, then use the right panel to switch modes. Do not claim success until this command and screenshot review have completed.

---

## Plan Self-Review

- Spec coverage: Tasks 3–6 cover the procedural model, assembly tree, picking, camera, all display modes, numeric feedback, reset, and responsive panels. Task 7 covers standalone `file://` use, no external requests, WebGL failure, and visual review.
- Type consistency: reducer actions, `buildRobotArm` records, viewer methods, display controller methods, and `armDemo.inspect()` fields use the same names across tests and implementation steps.
- Scope control: no backend, deployment, CAD import, joint simulation, physics, accounts, or runtime package installation is included.
- Git constraint: no task initializes Git or creates commits because this workspace is not a repository and the user did not request Git operations.
