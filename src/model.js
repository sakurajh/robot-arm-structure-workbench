import * as THREE from 'three';

const geometry = {
  box: (width, height, depth) => new THREE.BoxGeometry(width, height, depth),
  cylinder: (radius, length, segments = 32) => new THREE.CylinderGeometry(radius, radius, length, segments),
  torus: (radius, tube) => new THREE.TorusGeometry(radius, tube, 12, 40),
  sphere: radius => new THREE.SphereGeometry(radius, 24, 16),
};

export function buildRobotArm() {
  const root = new THREE.Group();
  root.name = 'six-axis-teaching-robot';
  root.position.y = 0;

  const parts = new Map();
  const assemblies = new Map();
  const shellMeshes = [];
  const materials = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xeee9dc, roughness: 0.42, metalness: 0.18 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xf07b22, roughness: 0.35, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x303942, roughness: 0.3, metalness: 0.82 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xaeb8c2, roughness: 0.26, metalness: 0.88 }),
    black: new THREE.MeshStandardMaterial({ color: 0x171d22, roughness: 0.5, metalness: 0.55 }),
  };

  const assemblySpecs = [
    ['base', '固定底座', [0, 0, 0]],
    ['turntable', '一轴回转台', [0, 0, -1.6]],
    ['shoulder', '二轴肩关节', [-1.5, 0, 0]],
    ['upper-arm', '大臂总成', [0, 1.6, 0]],
    ['elbow', '三轴肘关节', [0, 0, 1.7]],
    ['forearm', '四轴小臂总成', [1.5, 0.5, 0]],
    ['wrist', '五轴腕关节', [1.5, -0.8, 0]],
    ['gripper', '六轴末端夹具', [2.2, 0, 0]],
  ];

  for (const [id, name, explodeVector] of assemblySpecs) {
    const object = new THREE.Group();
    object.name = id;
    root.add(object);
    assemblies.set(id, { id, name, object, explodeVector: new THREE.Vector3(...explodeVector) });
  }

  const jointAxes = {
    turntable: 'y',
    shoulder: 'z',
    elbow: 'z',
    forearm: 'x',
    wrist: 'z',
    gripper: 'x',
  };
  for (const [id, axis] of Object.entries(jointAxes)) {
    assemblies.get(id).object.userData.jointAxis = axis;
  }

  function part(assembly, data, shape, material, position = [0, 0, 0], rotation = [0, 0, 0], explodeOffset = [0, 0, 0]) {
    const parent = assemblies.get(assembly).object;
    const object = new THREE.Group();
    object.name = data.id;
    object.position.set(...position);
    object.rotation.set(...rotation);

    const mesh = new THREE.Mesh(shape, material.clone());
    mesh.name = `${data.id}-mesh`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = data.id;
    object.add(mesh);
    parent.add(object);

    const record = {
      ...data,
      assembly,
      object,
      basePosition: object.position.clone(),
      explodeVector: assembly === 'base'
        ? new THREE.Vector3()
        : assemblies.get(assembly).explodeVector.clone().add(new THREE.Vector3(...explodeOffset)),
      isShell: Boolean(data.isShell),
    };
    parts.set(data.id, record);
    if (record.isShell) shellMeshes.push(mesh);
    return object;
  }

  const add = (assembly, id, name, description, shape, material, position, rotation, isShell = false, explodeOffset = [0, 0, 0]) =>
    part(assembly, { id, name, description, isShell }, shape, material, position, rotation, explodeOffset);

  // 底座：锚栓穿过底板，钟形壳体包围回转驱动。
  add('base', 'base-plate', '底座安装板', '承载整机并通过四颗锚栓固定到工作台。', geometry.box(2.15, 0.22, 1.85), materials.dark, [0, 0.11, 0]);
  add('base', 'base-shell', '底座外壳', '保护底部驱动与电缆入口的象牙色壳体。', geometry.cylinder(0.72, 0.65), materials.ivory, [0, 0.52, 0], undefined, true, [0, 0.3, 0]);
  add('base', 'base-service-cover', '底座检修盖', '打开后可观察底座内部驱动与布线。', geometry.box(0.62, 0.3, 0.08), materials.ivory, [0, 0.5, 0.7], undefined, true, [0, 0.1, 0.35]);
  for (const [index, x, z] of [[1, -0.84, -0.68], [2, 0.84, -0.68], [3, -0.84, 0.68], [4, 0.84, 0.68]]) {
    add('base', `anchor-bolt-${index}`, `地脚锚栓 ${index}`, '将安装板锁紧到工作台并承受倾覆力矩。', geometry.cylinder(0.09, 0.3, 12), materials.silver, [x, 0.28, z], undefined, false, [0, -0.12, 0]);
  }

  // J1：绕竖直轴回转，轴承与电机藏在台面下方。
  add('turntable', 'slew-bearing', '回转支承', '承受轴向与径向载荷，使上臂绕一轴平稳回转。', geometry.torus(0.55, 0.11), materials.dark, [0, 0.88, 0], [Math.PI / 2, 0, 0], false, [0, 0.12, 0]);
  add('turntable', 'turntable-motor', '一轴伺服电机', '驱动回转台改变整机朝向。', geometry.cylinder(0.27, 0.5), materials.silver, [0, 0.56, 0], undefined, false, [0, -0.25, 0]);
  add('turntable', 'rotary-table', '回转工作台', '连接回转支承与肩部支座的一轴输出件。', geometry.cylinder(0.69, 0.22), materials.ivory, [0, 1.0, 0], undefined, true, [0, 0.3, 0]);
  add('turntable', 'turntable-ring', '一轴橙色关节环', '标识绕竖直方向旋转的一轴位置。', geometry.torus(0.62, 0.055), materials.orange, [0, 1.08, 0], [Math.PI / 2, 0, 0], false, [0, 0.48, 0]);

  // J2：两侧肩壳夹持电机、减速器和横向输出轴。
  add('shoulder', 'shoulder-left-shell', '肩关节左壳', '与右壳共同封闭二轴驱动并形成肩部支座。', geometry.box(1.08, 1.08, 0.22), materials.ivory, [0, 1.52, -0.48], undefined, true, [0, 0, -0.38]);
  add('shoulder', 'shoulder-right-shell', '肩关节右壳', '保护二轴减速器并连接大臂两侧壳体。', geometry.box(1.08, 1.08, 0.22), materials.ivory, [0, 1.52, 0.48], undefined, true, [0, 0, 0.38]);
  add('shoulder', 'shoulder-motor', '肩部伺服电机', '提供大臂俯仰所需驱动力矩。', geometry.cylinder(0.27, 0.66), materials.silver, [0, 1.52, 0], [Math.PI / 2, 0, 0], false, [0, 0, -0.1]);
  add('shoulder', 'shoulder-reducer', '肩部减速器', '降低转速并放大二轴输出扭矩。', geometry.cylinder(0.36, 0.2), materials.dark, [0, 1.52, 0.23], [Math.PI / 2, 0, 0], false, [0, 0, 0.14]);
  add('shoulder', 'shoulder-shaft', '肩部输出轴', '把减速器扭矩传递给大臂。', geometry.cylinder(0.12, 0.92), materials.dark, [0, 1.52, 0], [Math.PI / 2, 0, 0]);
  add('shoulder', 'shoulder-ring', '二轴橙色关节环', '标识大臂俯仰的二轴旋转中心。', geometry.torus(0.44, 0.065), materials.orange, [0, 1.52, 0.61], undefined, false, [0, 0, 0.58]);

  // 大臂：长轴和加强脊位于左右壳体之间，上下分别连接肩与肘。
  add('upper-arm', 'upper-arm-left-shell', '大臂左壳', '大臂左侧承力外壳，内部容纳传动轴。', geometry.box(0.86, 2.15, 0.3), materials.ivory, [0, 2.83, -0.39], undefined, true, [0, 0, -0.42]);
  add('upper-arm', 'upper-arm-right-shell', '大臂右壳', '大臂右侧承力外壳，与肩肘关节连续连接。', geometry.box(0.86, 2.15, 0.3), materials.ivory, [0, 2.83, 0.39], undefined, true, [0, 0, 0.42]);
  add('upper-arm', 'upper-arm-spine', '大臂加强脊', '连接肩肘并提高大臂抗弯刚度。', geometry.box(0.26, 2.08, 0.38), materials.dark, [0, 2.83, 0], undefined, false, [0.16, 0, 0]);
  add('upper-arm', 'upper-arm-shaft', '大臂传动轴', '在大臂壳体内部传递和支撑关节载荷。', geometry.cylinder(0.11, 2.06), materials.dark, [0, 2.83, 0], undefined, false, [-0.16, 0, 0]);
  for (const side of [-1, 1]) {
    add('upper-arm', `upper-arm-fastener-${side < 0 ? 'left' : 'right'}`, '大臂壳体紧固件', '将左右壳体与内部支架夹紧。', geometry.cylinder(0.075, 0.1, 12), materials.silver, [0, 2.82, side * 0.59], [Math.PI / 2, 0, 0], false, [0, 0, side * 0.58]);
  }

  // J3：肘部连接竖直大臂与水平小臂。
  add('elbow', 'elbow-left-shell', '肘关节左壳', '包覆三轴驱动并与大臂左壳衔接。', geometry.cylinder(0.52, 0.2), materials.ivory, [0, 4.12, -0.47], [Math.PI / 2, 0, 0], true, [0, 0, -0.38]);
  add('elbow', 'elbow-right-shell', '肘关节右壳', '包覆三轴输出并支撑水平小臂。', geometry.cylinder(0.52, 0.2), materials.ivory, [0, 4.12, 0.47], [Math.PI / 2, 0, 0], true, [0, 0, 0.38]);
  add('elbow', 'elbow-motor', '肘部伺服电机', '驱动小臂绕三轴抬起或放下。', geometry.cylinder(0.25, 0.62), materials.silver, [0, 4.12, 0], [Math.PI / 2, 0, 0], false, [0, 0, -0.1]);
  add('elbow', 'elbow-reducer', '肘部减速器', '将电机转速转换为小臂的低速大扭矩运动。', geometry.cylinder(0.34, 0.18), materials.dark, [0, 4.12, 0.22], [Math.PI / 2, 0, 0], false, [0, 0, 0.14]);
  add('elbow', 'elbow-shaft', '肘部输出轴', '连接三轴减速器和小臂安装座。', geometry.cylinder(0.11, 0.9), materials.dark, [0, 4.12, 0], [Math.PI / 2, 0, 0]);
  add('elbow', 'elbow-ring', '三轴橙色关节环', '标识小臂俯仰的三轴旋转中心。', geometry.torus(0.43, 0.065), materials.orange, [0, 4.12, 0.59], undefined, false, [0, 0, 0.58]);

  // J4：水平小臂包覆纵向电机和滚转轴。
  add('forearm', 'forearm-upper-shell', '小臂上壳', '与下壳合围四轴传动组件并形成连续臂身。', geometry.box(1.95, 0.27, 0.82), materials.ivory, [1.05, 4.53, 0], undefined, true, [0, 0.38, 0]);
  add('forearm', 'forearm-lower-shell', '小臂下壳', '保护小臂内部传动轴并连接肘腕两端。', geometry.box(1.95, 0.27, 0.82), materials.ivory, [1.05, 3.71, 0], undefined, true, [0, -0.38, 0]);
  add('forearm', 'forearm-roll-motor', '四轴滚转电机', '驱动小臂绕自身纵轴滚转。', geometry.cylinder(0.24, 0.64), materials.silver, [0.7, 4.12, 0], [0, 0, Math.PI / 2], false, [0, 0, 0.28]);
  add('forearm', 'forearm-shaft', '小臂滚转轴', '沿小臂中心传递四轴滚转运动。', geometry.cylinder(0.11, 1.65), materials.dark, [1.12, 4.12, 0], [0, 0, Math.PI / 2], false, [0, 0, -0.28]);
  add('forearm', 'forearm-end-ring', '四轴橙色关节环', '标识小臂纵向滚转的四轴位置。', geometry.torus(0.37, 0.055), materials.orange, [1.91, 4.12, 0], [0, Math.PI / 2, 0], false, [0.28, 0, 0]);

  // J5：腕部俯仰，两个电机均置于同轴护壳内部。
  add('wrist', 'wrist-shell', '腕部护壳', '保护五轴俯仰驱动并衔接小臂末端。', geometry.cylinder(0.43, 0.64), materials.ivory, [2.18, 4.12, 0], [0, 0, Math.PI / 2], true, [0, 0, -0.35]);
  add('wrist', 'wrist-pitch-motor', '腕部俯仰电机', '驱动末端法兰绕五轴改变俯仰角。', geometry.cylinder(0.21, 0.42), materials.silver, [2.16, 4.12, 0], [Math.PI / 2, 0, 0], false, [0, 0, 0.2]);
  add('wrist', 'wrist-roll-motor', '末端滚转电机', '为六轴提供末端旋转驱动力。', geometry.cylinder(0.18, 0.36), materials.silver, [2.28, 4.12, 0], [0, 0, Math.PI / 2], false, [0.25, 0, -0.05]);
  add('wrist', 'wrist-pitch-ring', '五轴橙色关节环', '标识腕部俯仰的五轴旋转中心。', geometry.torus(0.36, 0.055), materials.orange, [2.37, 4.12, 0], undefined, false, [0, 0, 0.45]);
  add('wrist', 'tool-flange', '末端工具法兰', '提供夹具或教学工具的标准化连接界面。', geometry.cylinder(0.32, 0.16), materials.dark, [2.56, 4.12, 0], [0, 0, Math.PI / 2], false, [0.38, 0, 0]);

  // J6：夹具体随末端轴滚转，双指沿上下方向对中开合。
  add('gripper', 'gripper-roll-ring', '六轴橙色关节环', '标识工具绕末端纵轴旋转的六轴位置。', geometry.torus(0.27, 0.045), materials.orange, [2.68, 4.12, 0], [0, Math.PI / 2, 0], false, [-0.15, 0, 0]);
  add('gripper', 'gripper-body', '夹具本体', '安装六轴输出法兰并将旋转运动传给夹指机构。', geometry.box(0.48, 0.68, 0.62), materials.ivory, [2.91, 4.12, 0], undefined, true, [0, 0, -0.32]);
  add('gripper', 'gripper-actuator', '夹指驱动器', '在夹具内部驱动两指同步对中开合。', geometry.cylinder(0.15, 0.38), materials.silver, [2.91, 4.12, 0], [0, 0, Math.PI / 2], false, [0, 0, 0.25]);
  add('gripper', 'gripper-finger-left', '左夹指', '与右夹指配合夹持教学工件。', geometry.box(0.58, 0.13, 0.22), materials.dark, [3.34, 4.39, 0], undefined, false, [0, 0.18, 0]);
  add('gripper', 'gripper-finger-right', '右夹指', '与左夹指配合夹持教学工件。', geometry.box(0.58, 0.13, 0.22), materials.dark, [3.34, 3.85, 0], undefined, false, [0, -0.18, 0]);
  add('gripper', 'gripper-contact-left', '左防滑指垫', '增加接触摩擦并保护工件表面。', geometry.box(0.2, 0.1, 0.24), materials.black, [3.56, 4.29, 0], undefined, false, [0, 0.28, 0]);
  add('gripper', 'gripper-contact-right', '右防滑指垫', '增加接触摩擦并保护工件表面。', geometry.box(0.2, 0.1, 0.24), materials.black, [3.56, 3.95, 0], undefined, false, [0, -0.28, 0]);

  // 可见紧固件用于讲解壳体装配关系。
  for (const [id, x] of [['forearm-fastener-front', 0.45], ['forearm-fastener-rear', 1.62]]) {
    add('forearm', id, '小臂壳体紧固件', '锁紧上下小臂壳体，拆解后可观察内部滚转轴。', geometry.sphere(0.065), materials.silver, [x, 4.65, 0.25], undefined, false, [0, 0.52, 0]);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  return { root, parts, assemblies, shellMeshes, bounds };
}
