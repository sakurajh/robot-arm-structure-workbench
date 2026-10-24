import { buildRobotArm } from './model.js';
import { createViewState, reduceViewState } from './state.js';
import { createDisplayController } from './display.js';
import { createViewer } from './viewer.js';
import { createUI } from './ui.js';

const HIGHLIGHT_COLOR = 0xff7a1a;

document.documentElement.dataset.ready = 'shell';

const model = buildRobotArm();
const display = createDisplayController(model);
let viewState = createViewState();
let focusedAssembly = null;
let viewer;
let ui;
let homeView;
let disposed = false;
let animationFrameId = null;
let renderCount = 0;
let previousFrameTime = null;
let frameHandler = null;
const originalEmissives = [];
display.snap(viewState);

function restoreHighlight() {
  for (const original of originalEmissives) {
    original.material.emissive.setHex(original.color);
    original.material.emissiveIntensity = original.intensity;
  }
  originalEmissives.length = 0;
}

function updateHighlight(partId) {
  restoreHighlight();
  const part = partId ? model.parts.get(partId) : null;
  if (!part) return;
  const touched = new Set();
  part.object.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material?.emissive || touched.has(material)) continue;
      touched.add(material);
      originalEmissives.push({
        material,
        color: material.emissive.getHex(),
        intensity: material.emissiveIntensity
      });
      material.emissive.setHex(HIGHLIGHT_COLOR);
      material.emissiveIntensity = 1;
    }
  });
}

function resetCamera() {
  if (!viewer || !homeView) return;
  const { camera, controls } = viewer;
  controls.enableDamping = false;
  controls.update();
  camera.position.fromArray(homeView.position);
  controls.target.fromArray(homeView.target);
  camera.near = homeView.near;
  camera.far = homeView.far;
  camera.zoom = homeView.zoom;
  camera.updateProjectionMatrix();
  controls.maxDistance = homeView.maxDistance;
  controls.update();
  controls.enableDamping = homeView.enableDamping;
}

function inspect() {
  let meshCount = 0;
  const highlightedMeshes = [];
  model.root.traverse(object => {
    if (!object.isMesh) return;
    if (object.userData.partId) meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const highlighted = materials.find(material => material?.emissive?.getHex() === HIGHLIGHT_COLOR);
    if (highlighted) {
      highlightedMeshes.push({
        partId: object.userData.partId ?? null,
        name: object.name,
        emissive: highlighted.emissive.getHex()
      });
    }
  });
  return {
    meshCount,
    ...viewState,
    ...display.inspect(),
    focusedAssembly,
    highlightedMeshes,
    canvasWidth: viewer.canvas.width,
    canvasHeight: viewer.canvas.height,
    cameraAspect: viewer.camera.aspect,
    cameraPosition: viewer.camera.position.toArray(),
    cameraTarget: viewer.controls.target.toArray(),
    renderCount,
    rafPending: animationFrameId !== null,
    disposed,
    canvasConnected: viewer.canvas.isConnected
  };
}

function renderUI() {
  ui?.render({ ...viewState, focusedAssembly });
}

function invalidate() {
  if (disposed || !viewer || !frameHandler || animationFrameId !== null) return;
  animationFrameId = requestAnimationFrame(frameHandler);
}

function dispatch(action) {
  if (disposed) return viewer ? inspect() : { ...viewState, focusedAssembly };
  viewState = reduceViewState(viewState, action);
  if (action.type === 'RESET') {
    focusedAssembly = null;
    display.snap(viewState);
    resetCamera();
  } else {
    display.update(viewState, 0);
  }
  updateHighlight(viewState.selectedPart);
  renderUI();
  invalidate();
  return viewer ? inspect() : { ...viewState, focusedAssembly };
}

function focusAssembly(id) {
  if (!viewer || disposed) return false;
  const focused = viewer.focusAssembly(id);
  if (focused) {
    focusedAssembly = id;
    renderUI();
  }
  return focused;
}

try {
  viewer = createViewer(document.querySelector('#viewport'), model, {
    onInvalidate: invalidate,
    onSelect(partId) {
      dispatch({ type: 'SELECT_PART', partId });
    }
  });
  homeView = {
    position: viewer.camera.position.toArray(),
    target: viewer.controls.target.toArray(),
    near: viewer.camera.near,
    far: viewer.camera.far,
    zoom: viewer.camera.zoom,
    maxDistance: viewer.controls.maxDistance,
    enableDamping: viewer.controls.enableDamping
  };
} catch (error) {
  if (error instanceof Error && error.message === 'WEBGL2_UNAVAILABLE') {
    document.querySelector('#webgl-error').hidden = false;
    document.documentElement.dataset.ready = 'error';
  } else {
    throw error;
  }
}

ui = createUI(model, dispatch, { focusAssembly });
renderUI();

if (viewer) {
  function renderFrame(delta = 0) {
    if (disposed) return false;
    const moving = display.update(viewState, delta);
    const controlsChanged = viewer.render();
    renderCount += 1;
    return moving || controlsChanged;
  }

  function frame(time) {
    if (disposed) return;
    animationFrameId = null;
    const delta = previousFrameTime === null ? 0 : Math.max(0, (time - previousFrameTime) / 1000);
    previousFrameTime = time;
    const moving = renderFrame(delta);
    if (moving) {
      invalidate();
    } else {
      previousFrameTime = null;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    restoreHighlight();
    ui?.dispose();
    viewer.dispose();
  }

  window.armDemo = {
    inspect,
    dispatch,
    getPartScreenPosition: viewer.getPartScreenPosition,
    getAssemblyProjection: viewer.getAssemblyProjection,
    getPartProjection: viewer.getPartProjection,
    focusAssembly,
    focusPart: viewer.focusPart,
    resize: viewer.resize,
    setView(position, target) {
      if (disposed) return false;
      viewer.camera.position.fromArray(position);
      viewer.controls.target.fromArray(target);
      viewer.controls.update();
      return true;
    },
    dispose
  };

  document.documentElement.dataset.ready = 'viewer';
  frameHandler = frame;
  renderFrame();
}
