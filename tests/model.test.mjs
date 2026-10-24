import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildRobotArm } from '../src/model.js';

const EPSILON = 1e-6;

function partBox(model, id) {
  const part = model.parts.get(id);
  assert.ok(part, `missing part ${id}`);
  part.object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(part.object);
}

function assertBoxInside(inner, outer, message) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(inner.min[axis] >= outer.min[axis] - EPSILON, `${message}: ${axis} minimum escapes`);
    assert.ok(inner.max[axis] <= outer.max[axis] + EPSILON, `${message}: ${axis} maximum escapes`);
  }
}

function assertRelativeExplosion(model, firstId, secondId) {
  const first = model.parts.get(firstId);
  const second = model.parts.get(secondId);
  const assembledRelative = second.basePosition.clone().sub(first.basePosition);
  first.object.position.copy(first.basePosition).add(first.explodeVector);
  second.object.position.copy(second.basePosition).add(second.explodeVector);
  const explodedRelative = second.object.position.clone().sub(first.object.position);
  const localDisplacement = explodedRelative.sub(assembledRelative);
  assert.ok(localDisplacement.length() > 0.1, `${firstId} and ${secondId} need a local explosion offset`);
  assert.ok(localDisplacement.length() < 1.2, `${firstId} and ${secondId} must remain a controlled subassembly`);
}

test('model exposes eight assemblies, teaching metadata, and registered part parents', () => {
  const model = buildRobotArm();
  assert.equal(model.assemblies.size, 8);
  assert.deepEqual([...model.assemblies.keys()], [
    'base', 'turntable', 'shoulder', 'upper-arm', 'elbow', 'forearm', 'wrist', 'gripper',
  ]);
  assert.ok(model.parts.size >= 30);
  assert.equal(model.shellMeshes.length >= 8, true);
  assert.equal(model.root.position.y, 0);

  for (const assembly of model.assemblies.values()) {
    assert.ok(assembly.name && assembly.object);
    assert.equal(assembly.object.parent, model.root);
    if (assembly.id === 'base') {
      assert.deepEqual(assembly.explodeVector.toArray(), [0, 0, 0], 'fixed base assembly must not move');
    } else {
      assert.ok(assembly.explodeVector.lengthSq() > 0, `${assembly.id} needs an explosion direction`);
    }
  }
  const movableAssemblies = [...model.assemblies.values()].filter(assembly => assembly.id !== 'base');
  assert.equal(new Set(movableAssemblies.map(item => item.explodeVector.toArray().join(','))).size, 7);

  for (const [key, part] of model.parts) {
    assert.equal(key, part.id);
    assert.ok(part.name && part.description && part.assembly);
    assert.ok(model.assemblies.has(part.assembly));
    assert.equal(part.object.parent, model.assemblies.get(part.assembly).object);
    assert.ok(part.basePosition.isVector3);
    assert.notStrictEqual(part.basePosition, part.object.position);
    assert.deepEqual(part.basePosition.toArray(), part.object.position.toArray());
    assert.ok(part.explodeVector.isVector3);
    part.object.traverse(node => {
      if (node.isMesh) assert.equal(node.userData.partId, part.id);
    });
  }
});

test('basePosition is an independent snapshot of object.position', () => {
  const model = buildRobotArm();
  const part = model.parts.get('shoulder-motor');
  const original = part.basePosition.toArray();
  part.object.position.set(20, 30, 40);
  assert.deepEqual(part.basePosition.toArray(), original);
});

test('fixed base and all its parts stay above ground at full explosion', () => {
  const model = buildRobotArm();
  for (const part of model.parts.values()) {
    if (part.assembly !== 'base') {
      assert.ok(part.explodeVector.lengthSq() > 0, `${part.id} must still separate from the fixed base`);
      continue;
    }
    assert.deepEqual(part.explodeVector.toArray(), [0, 0, 0], `${part.id} belongs to the fixed base`);
    const assembled = partBox(model, part.id);
    part.object.position.copy(part.basePosition).add(part.explodeVector);
    assert.deepEqual(part.object.position.toArray(), part.basePosition.toArray());
    const exploded = partBox(model, part.id);
    assert.deepEqual(exploded.min.toArray(), assembled.min.toArray());
    assert.deepEqual(exploded.max.toArray(), assembled.max.toArray());
    assert.ok(exploded.min.y >= -EPSILON, `${part.id} must remain visible above the ground plane`);
  }
});

test('every root mesh is registered and shellMeshes matches isShell exactly', () => {
  const model = buildRobotArm();
  const rootMeshes = [];
  model.root.traverse(node => {
    if (!node.isMesh) return;
    rootMeshes.push(node);
    assert.ok(model.parts.has(node.userData.partId), `unregistered mesh ${node.name}`);
  });
  assert.ok(rootMeshes.length > 0);

  const expectedShells = [];
  for (const part of model.parts.values()) {
    part.object.traverse(node => {
      if (node.isMesh && part.isShell) expectedShells.push(node);
      if (node.isMesh && !part.isShell) assert.equal(model.shellMeshes.includes(node), false);
    });
  }
  assert.deepEqual(model.shellMeshes, expectedShells);
});

test('bounds equals the actual assembled world bounding box', () => {
  const model = buildRobotArm();
  model.root.updateMatrixWorld(true);
  const actual = new THREE.Box3().setFromObject(model.root);
  assert.equal(model.bounds.isEmpty(), false);
  assert.ok(model.bounds.equals(actual), `${model.bounds.min.toArray()}..${model.bounds.max.toArray()} != ${actual.min.toArray()}..${actual.max.toArray()}`);
});

test('model exposes exactly six functional joint-axis groups with visible meshes', () => {
  const model = buildRobotArm();
  const joints = [];
  model.root.traverse(node => {
    if (node.userData.jointAxis) joints.push(node);
  });
  assert.equal(joints.length, 6);
  for (const joint of joints) {
    assert.ok(['x', 'y', 'z'].includes(joint.userData.jointAxis));
    let visibleMeshes = 0;
    joint.traverse(node => {
      if (node.isMesh && node.visible) visibleMeshes += 1;
    });
    assert.ok(visibleMeshes > 0, `${joint.name} must contain visible geometry`);
  }
});

test('shell and internal components use separate materials', () => {
  const model = buildRobotArm();
  const shellMaterials = new Set(model.shellMeshes.map(mesh => mesh.material));
  assert.ok(shellMaterials.size >= 8);
  for (const part of model.parts.values()) {
    if (part.isShell) continue;
    part.object.traverse(node => {
      if (node.isMesh) assert.equal(shellMaterials.has(node.material), false, `${part.id} reuses a shell material`);
    });
  }
});

test('assembled motors, reducers, and shafts stay inside their shell envelopes', () => {
  const model = buildRobotArm();
  const containment = [
    ['turntable-motor', ['base-shell']],
    ['shoulder-motor', ['shoulder-left-shell', 'shoulder-right-shell']],
    ['shoulder-reducer', ['shoulder-left-shell', 'shoulder-right-shell']],
    ['shoulder-shaft', ['shoulder-left-shell', 'shoulder-right-shell']],
    ['upper-arm-spine', ['upper-arm-left-shell', 'upper-arm-right-shell']],
    ['upper-arm-shaft', ['upper-arm-left-shell', 'upper-arm-right-shell']],
    ['elbow-motor', ['elbow-left-shell', 'elbow-right-shell']],
    ['elbow-reducer', ['elbow-left-shell', 'elbow-right-shell']],
    ['elbow-shaft', ['elbow-left-shell', 'elbow-right-shell']],
    ['forearm-roll-motor', ['forearm-upper-shell', 'forearm-lower-shell']],
    ['forearm-shaft', ['forearm-upper-shell', 'forearm-lower-shell']],
    ['wrist-pitch-motor', ['wrist-shell']],
    ['wrist-roll-motor', ['wrist-shell']],
    ['gripper-actuator', ['gripper-body']],
  ];
  for (const [internalId, shellIds] of containment) {
    const envelope = partBox(model, shellIds[0]);
    for (const shellId of shellIds.slice(1)) envelope.union(partBox(model, shellId));
    assertBoxInside(partBox(model, internalId), envelope, `${internalId} must fit its shells`);
  }

  const upper = partBox(model, 'forearm-upper-shell');
  const lower = partBox(model, 'forearm-lower-shell');
  const motor = partBox(model, 'forearm-roll-motor');
  assert.ok(motor.min.y > lower.max.y, 'forearm motor must clear the lower shell');
  assert.ok(motor.max.y < upper.min.y, 'forearm motor must clear the upper shell');
});

test('explosion offsets separate shells from each other and reveal internal parts', () => {
  const model = buildRobotArm();
  const shellPairs = [
    ['shoulder-left-shell', 'shoulder-right-shell'],
    ['upper-arm-left-shell', 'upper-arm-right-shell'],
    ['elbow-left-shell', 'elbow-right-shell'],
    ['forearm-upper-shell', 'forearm-lower-shell'],
  ];
  const internalPairs = [
    ['shoulder-left-shell', 'shoulder-motor'],
    ['shoulder-right-shell', 'shoulder-reducer'],
    ['upper-arm-left-shell', 'upper-arm-shaft'],
    ['upper-arm-right-shell', 'upper-arm-spine'],
    ['elbow-left-shell', 'elbow-motor'],
    ['elbow-right-shell', 'elbow-reducer'],
    ['forearm-upper-shell', 'forearm-roll-motor'],
    ['forearm-lower-shell', 'forearm-shaft'],
    ['wrist-shell', 'wrist-pitch-motor'],
    ['wrist-shell', 'wrist-roll-motor'],
    ['gripper-body', 'gripper-actuator'],
  ];
  for (const pair of [...shellPairs, ...internalPairs]) assertRelativeExplosion(model, ...pair);
});

test('wrist pitch ring normal matches the z joint axis', () => {
  const model = buildRobotArm();
  const wrist = model.assemblies.get('wrist').object;
  const ring = model.parts.get('wrist-pitch-ring').object;
  assert.equal(wrist.userData.jointAxis, 'z');
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ring.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(normal.distanceTo(new THREE.Vector3(0, 0, 1)) < EPSILON, `pitch ring normal was ${normal.toArray()}`);
});
