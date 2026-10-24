import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(container, model, { onSelect = () => {}, onInvalidate = () => {} } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', '可旋转和拾取的三维机械臂');
  const context = canvas.getContext('webgl2', { antialias: true });
  if (!context) throw new Error('WEBGL2_UNAVAILABLE');

  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f11);
  scene.add(model.root);
  let disposed = false;

  const hemisphere = new THREE.HemisphereLight(0xd9e7ed, 0x24251f, 1.8);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  keyLight.position.set(5, 9, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 8;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 30;
  keyLight.shadow.bias = -0.0003;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x8eb8d6, 2.1);
  rimLight.position.set(-6, 5, -5);
  scene.add(rimLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x11191b, roughness: 0.95, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(30, 60, 0x3a4947, 0x263230);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  grid.material.depthWrite = false;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomToCursor = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 50;
  controls.addEventListener('change', onInvalidate);

  function resize() {
    if (disposed) return;
    const { width, height } = container.getBoundingClientRect();
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    renderer.setSize(safeWidth, safeHeight, false);
    camera.aspect = safeWidth / safeHeight;
    camera.updateProjectionMatrix();
    onInvalidate();
  }

  function focusBox(box, padding = 1.35) {
    if (disposed || box.isEmpty()) return false;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(1.15, 0.72, 1.45);
    direction.normalize();

    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    const distance = Math.max(sphere.radius / Math.sin(limitingHalfFov) * padding, 0.35);
    controls.maxDistance = Math.max(50, distance);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(200, distance * 100);
    camera.updateProjectionMatrix();
    controls.update();
    camera.updateMatrixWorld();
    onInvalidate();
    return true;
  }

  function focusAssembly(id) {
    const assembly = model.assemblies.get(id);
    if (!assembly || disposed) return false;
    model.root.updateMatrixWorld(true);
    return focusBox(new THREE.Box3().setFromObject(assembly.object));
  }

  function focusPart(id) {
    const part = model.parts.get(id);
    if (!part || disposed) return false;
    model.root.updateMatrixWorld(true);
    return focusBox(new THREE.Box3().setFromObject(part.object), 1.8);
  }

  function getPartScreenPosition(id) {
    const part = model.parts.get(id);
    if (!part || disposed) return null;
    controls.update();
    model.root.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const center = new THREE.Box3().setFromObject(part.object).getCenter(new THREE.Vector3());
    center.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (center.x + 1) * rect.width * 0.5,
      y: rect.top + (1 - center.y) * rect.height * 0.5
    };
  }

  function getObjectProjection(object) {
    if (!object || disposed) return null;
    controls.update();
    model.root.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z).project(camera);
          corners.push({ x: corner.x, y: corner.y, z: corner.z });
        }
      }
    }
    const center = sphere.center.clone().project(camera);
    return {
      radius: sphere.radius,
      distance: camera.position.distanceTo(sphere.center),
      fov: camera.fov,
      aspect: camera.aspect,
      direction: camera.position.clone().sub(controls.target).normalize().toArray(),
      center: { x: center.x, y: center.y, z: center.z },
      corners
    };
  }

  function getAssemblyProjection(id) {
    return getObjectProjection(model.assemblies.get(id)?.object);
  }

  function getPartProjection(id) {
    return getObjectProjection(model.parts.get(id)?.object);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerStart = null;

  function onPointerDown(event) {
    if (disposed) return;
    pointerStart = event.button === 0 && event.isPrimary
      ? { x: event.clientX, y: event.clientY, id: event.pointerId }
      : null;
  }

  function onPointerUp(event) {
    if (disposed || !pointerStart || pointerStart.id !== event.pointerId || event.button !== 0) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (distance > 5) return;

    controls.update();
    model.root.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObject(model.root, true);
    const visibleHit = intersections.find(intersection => {
      const objectMaterials = Array.isArray(intersection.object.material)
        ? intersection.object.material
        : [intersection.object.material];
      return objectMaterials.every(material =>
        !material?.clippingPlanes?.length || material.clippingPlanes.every(plane => plane.distanceToPoint(intersection.point) >= 0)
      );
    });
    onSelect(visibleHit?.object.userData.partId ?? null);
  }

  function onPointerCancel() {
    pointerStart = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  camera.position.copy(model.bounds.getCenter(new THREE.Vector3())).add(new THREE.Vector3(8, 5, 10));
  focusBox(model.bounds);

  function render() {
    if (disposed) return false;
    const controlsChanged = controls.update();
    renderer.render(scene, camera);
    return controlsChanged;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointerStart = null;
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    controls.removeEventListener('change', onInvalidate);
    controls.dispose();

    const geometries = new Set();
    const materials = new Set();
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) materials.add(material);
      }
      if (object.isLight && typeof object.dispose === 'function') object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    scene.clear();
    scene.background = null;
    renderer.dispose();
    canvas.remove();
  }

  return {
    canvas,
    controls,
    camera,
    renderer,
    focusAssembly,
    focusPart,
    getPartScreenPosition,
    getAssemblyProjection,
    getPartProjection,
    resize,
    render,
    dispose
  };
}
