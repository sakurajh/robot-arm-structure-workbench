import * as THREE from 'three';

const axisNormals = {
  x: [-1, 0, 0],
  y: [0, -1, 0],
  z: [0, 0, -1]
};

const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));

function materialList(object) {
  if (!object.material) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
}

function materialSnapshot(material) {
  return {
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    clipShadows: material.clipShadows
  };
}

export function createDisplayController(model) {
  const parts = Array.from(model.parts.values(), part => ({
    part,
    basePosition: part.object.position.clone()
  }));
  const shellMaterials = model.shellMeshes.flatMap(materialList);
  const shellMaterialSet = new Set(shellMaterials);
  const materials = [];
  model.root.traverse(object => {
    if (object.isMesh) materials.push(...materialList(object));
  });
  const internalMaterials = materials.filter(material => !shellMaterialSet.has(material));

  const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const clippingPlanes = [plane];
  const noClippingPlanes = [];
  const clipHelper = new THREE.PlaneHelper(plane, 8, 0x65d9e8);
  clipHelper.name = 'section-plane-helper';
  clipHelper.visible = false;
  clipHelper.traverse(object => {
    object.raycast = () => {};
    for (const material of materialList(object)) material.clippingPlanes = [];
  });
  model.root.add(clipHelper);

  let activeClipAxis = null;

  function applyMaterials(state) {
    const shellMode = state.mode === 'shell';
    const transparent = shellMode && clamp01(state.shellTransparency) > 0;
    const shellOpacity = shellMode ? 1 - clamp01(state.shellTransparency) : 1;

    for (const material of shellMaterials) {
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = Math.min(1, Math.max(0, shellOpacity));
      material.depthWrite = !transparent;
    }
    for (const material of internalMaterials) material.opacity = 1;

    activeClipAxis = state.mode === 'section' ? state.clipAxis : null;
    const normal = axisNormals[activeClipAxis] || axisNormals.x;
    plane.normal.set(...normal);
    plane.constant = (Number(state.clipPosition) || 0) * 4;
    const assignedPlanes = activeClipAxis ? clippingPlanes : noClippingPlanes;
    for (const material of materials) {
      material.clippingPlanes = assignedPlanes;
      if (material.clipShadows !== Boolean(activeClipAxis)) {
        material.clipShadows = Boolean(activeClipAxis);
        material.needsUpdate = true;
      }
    }
    clipHelper.visible = Boolean(activeClipAxis);
  }

  function moveParts(state, damping) {
    const explosion = clamp01(state.explosion);
    let moving = false;
    for (const { part, basePosition } of parts) {
      const target = basePosition.clone();
      if (state.mode === 'exploded') target.addScaledVector(part.explodeVector, explosion);
      part.object.position.lerp(target, damping);
      if (part.object.position.distanceToSquared(target) > 1e-10) {
        moving = true;
      } else {
        part.object.position.copy(target);
      }
    }
    return moving;
  }

  function update(state, delta) {
    applyMaterials(state);
    const safeDelta = Math.max(0, Number(delta) || 0);
    return moveParts(state, 1 - Math.exp(-12 * safeDelta));
  }

  function snap(state) {
    applyMaterials(state);
    moveParts(state, 1);
  }

  function inspect() {
    let explodedOffset = 0;
    const partDisplacements = {};
    for (const { part, basePosition } of parts) {
      const displacement = part.object.position.clone().sub(basePosition);
      explodedOffset = Math.max(explodedOffset, displacement.length());
      partDisplacements[part.id] = displacement.toArray();
    }
    return {
      shellOpacity: shellMaterials[0]?.opacity ?? 1,
      internalOpacity: internalMaterials[0]?.opacity ?? 1,
      activeClipAxis,
      explodedOffset,
      clipNormal: plane.normal.toArray(),
      clipConstant: plane.constant,
      clippedMaterialCount: materials.filter(material => material.clippingPlanes?.[0] === plane).length,
      clipHelperVisible: clipHelper.visible,
      shellMaterials: shellMaterials.map(materialSnapshot),
      internalMaterials: internalMaterials.map(materialSnapshot),
      partDisplacements
    };
  }

  return { update, snap, inspect };
}
