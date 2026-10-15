// Stone structures: the shrine clearing where you spawn, a ruined keep to the
// west, path lamps, and scattered rocks. Returns spots where torches burn.

import * as THREE from 'three';
import { MAT, makeLitMaterial } from '../render/lighting.js';
import { terrainHeight, pathDist, mulberry32, LAKE, RUINS } from './terrainMath.js';

const pathZ = (x) => Math.sin(x * 0.03) * 14 + Math.sin(x * 0.011 + 1) * 22 - Math.sin(1) * 22;

export function createRuins(shared, colliders) {
  const rand = mulberry32(42);
  const boxes = [], cyls = [], rocks = [];
  const torches = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const mat4 = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

  // ---------- Shrine clearing (spawn) ----------
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(7.4, 7.8, 0.4, 48),
    makeLitMaterial(shared, { color: [0.21, 0.21, 0.23], id: MAT.STONE, detail: 0.6, flagstone: true }),
  );
  floor.position.set(0, -0.05, 0);

  const pillarHeights = [3.6, 2.2, 3.8, 1.1, 3.5, 0.8, 3.4, 2.7];
  pillarHeights.forEach((h, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 6.3, z = Math.sin(a) * 6.3;
    cyls.push(mat4(x, h / 2, z, 0.55, h, 0.55, (rand() - 0.5) * 0.06, rand() * 3, (rand() - 0.5) * 0.06));
    boxes.push(mat4(x, 0.15, z, 1.3, 0.3, 1.3, 0, a));
    colliders.push({ x, z, r: 0.7 });
  });
  // fallen pillar
  cyls.push(mat4(9.5, 0.45, 3.5, 0.5, 3.4, 0.5, Math.PI / 2, 0, 0.4));
  colliders.push({ x: 9.5, z: 3.5, r: 0.9 }, { x: 8.6, z: 4.8, r: 0.7 }, { x: 10.4, z: 2.2, r: 0.7 });
  // altar
  boxes.push(mat4(0, 0.5, -2.5, 2.2, 1.0, 1.1));
  boxes.push(mat4(0, 1.05, -2.5, 2.5, 0.12, 1.35));
  colliders.push({ x: -0.7, z: -2.5, r: 0.8 }, { x: 0.7, z: -2.5, r: 0.8 });
  // archway behind the altar
  cyls.push(mat4(-2.4, 2.4, -6.0, 0.5, 4.8, 0.5));
  cyls.push(mat4(2.4, 2.4, -6.0, 0.5, 4.8, 0.5));
  boxes.push(mat4(0, 5.0, -6.0, 6.0, 0.6, 0.9, 0, 0, 0.03));
  colliders.push({ x: -2.4, z: -6, r: 0.6 }, { x: 2.4, z: -6, r: 0.6 });

  // braziers around the altar
  [[-3.8, 2.6], [3.8, 2.6], [-3.6, -3.8], [3.6, -3.8]].forEach(([x, z]) => {
    cyls.push(mat4(x, 0.6, z, 0.28, 1.2, 0.28));
    cyls.push(mat4(x, 1.25, z, 0.55, 0.25, 0.55));
    torches.push({ x, y: 1.55, z, radius: 9, intensity: 0.75 });
    colliders.push({ x, z, r: 0.45 });
  });

  // ---------- Ruined keep ----------
  const hx = 10, hz = 8, gateZ = RUINS.z + 2;
  const wallRun = (x0, z0, x1, z1, gate) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const segs = Math.round(len / 2);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (gate && Math.abs(z - gateZ) < 2.4) continue;
      if (rand() < 0.14) { // collapsed section: rubble only
        for (let k = 0; k < 3; k++) rocks.push(mat4(x + (rand() - 0.5) * 2, 0.2, z + (rand() - 0.5) * 2, 0.5 + rand() * 0.4, 0.35, 0.5 + rand() * 0.4, rand(), rand() * 6, rand()));
        continue;
      }
      const h = 1.4 + rand() * 3.4;
      boxes.push(mat4(x, h / 2, z, len / segs + 0.05, h, 1.1, 0, -ang, (rand() - 0.5) * 0.05));
      if (rand() < 0.5) boxes.push(mat4(x + (rand() - 0.5), h + 0.3, z, 0.7, 0.6, 1.0, 0, -ang + 0.2));
      colliders.push({ x, z, r: 1.15 });
    }
  };
  const X0 = RUINS.x - hx, X1 = RUINS.x + hx, Z0 = RUINS.z - hz, Z1 = RUINS.z + hz;
  wallRun(X0, Z0, X1, Z0);
  wallRun(X0, Z1, X1, Z1);
  wallRun(X0, Z0, X0, Z1);
  wallRun(X1, Z0, X1, Z1, true);
  [[X0, Z0, 6.5], [X1, Z0, 4.2], [X0, Z1, 3.1], [X1, Z1, 5.6]].forEach(([x, z, h]) => {
    cyls.push(mat4(x, h / 2, z, 1.9, h, 1.9));
    colliders.push({ x, z, r: 2.0 });
  });
  // gate pillars with torches
  [gateZ - 2.7, gateZ + 2.7].forEach((z) => {
    cyls.push(mat4(X1, 1.6, z, 0.6, 3.2, 0.6));
    torches.push({ x: X1 + 0.7, y: 2.6, z, radius: 10, intensity: 0.95 });
    colliders.push({ x: X1, z, r: 0.7 });
  });
  // courtyard: broken stairs + rubble
  for (let i = 0; i < 4; i++) boxes.push(mat4(RUINS.x - 4, 0.2 + i * 0.35, RUINS.z - 3 + i * 0.8, 4, 0.4 + i * 0.7, 0.8));
  colliders.push({ x: RUINS.x - 5, z: RUINS.z - 1, r: 1.6 }, { x: RUINS.x - 3, z: RUINS.z - 1, r: 1.6 });
  torches.push({ x: RUINS.x - 4, y: 3.2, z: RUINS.z - 0.6, radius: 9, intensity: 0.9 });
  for (let i = 0; i < 26; i++) {
    const x = RUINS.x + (rand() - 0.5) * hx * 1.7, z = RUINS.z + (rand() - 0.5) * hz * 1.7;
    const s = 0.25 + rand() * 0.5;
    rocks.push(mat4(x, 0.1, z, s * 1.4, s, s * 1.2, rand(), rand() * 6, rand()));
  }

  // ---------- path lamps & lakeside torch ----------
  [-26, 24, 62].forEach((x) => {
    const z = pathZ(x) + 2.6, y = terrainHeight(x, z);
    cyls.push(mat4(x, y + 1.0, z, 0.18, 2.4, 0.18));
    torches.push({ x, y: y + 2.4, z, radius: 10, intensity: 0.9 });
    colliders.push({ x, z, r: 0.35 });
  });
  {
    const x = LAKE.x - LAKE.r * 0.82, z = LAKE.z + 4, y = terrainHeight(x, z);
    cyls.push(mat4(x, y + 1.0, z, 0.18, 2.4, 0.18));
    torches.push({ x, y: y + 2.4, z, radius: 12, intensity: 1.0 });
    colliders.push({ x, z, r: 0.35 });
  }

  // ---------- scattered rocks ----------
  for (let i = 0; i < 320; i++) {
    const x = (rand() - 0.5) * 360, z = (rand() - 0.5) * 360;
    if (pathDist(x, z) < 2.5 || Math.hypot(x, z) < 9) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 0.6) continue;
    const s = 0.25 + Math.pow(rand(), 3) * 1.6;
    const y = terrainHeight(x, z);
    rocks.push(mat4(x, y + s * 0.2, z, s * (1 + rand() * 0.5), s * (0.6 + rand() * 0.4), s * (1 + rand() * 0.4), rand(), rand() * 6, rand()));
    if (s > 0.8) colliders.push({ x, z, r: s * 1.1 });
  }

  // ---------- build instanced meshes ----------
  const stone = makeLitMaterial(shared, { color: [0.31, 0.31, 0.34], id: MAT.STONE, detail: 0.9, variance: 0.35 });
  const rockMat = makeLitMaterial(shared, { color: [0.26, 0.27, 0.28], id: MAT.STONE, detail: 0.8, variance: 0.4 });
  const make = (geo, list, material) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    im.layers.enable(1); // casts moon shadows
    return im;
  };
  const group = new THREE.Group();
  group.add(
    floor,
    make(new THREE.BoxGeometry(1, 1, 1), boxes, stone),
    make(new THREE.CylinderGeometry(1, 1.08, 1, 10), cyls, stone),
    make(new THREE.DodecahedronGeometry(1, 0), rocks, rockMat),
  );
  return { group, torches };
}
