// Forest: instanced lumpy canopy blobs that sway in the wind, plus trunks.
// Canopies above the player dissolve so you never lose your character under a tree.

import * as THREE from 'three';
import { COMMON_GLSL, MAT, makeLitMaterial } from '../render/lighting.js';
import { terrainHeight, pathDist, vnoise, mulberry32, LAKE, RUINS, WORLD_HALF } from './terrainMath.js';

export function createTrees(shared, colliders) {
  const rand = mulberry32(1337);
  const trees = [];
  const step = 9.5;
  for (let x = -WORLD_HALF + 6; x < WORLD_HALF - 6; x += step) {
    for (let z = -WORLD_HALF + 6; z < WORLD_HALF - 6; z += step) {
      const px = x + (rand() - 0.5) * step * 0.9;
      const pz = z + (rand() - 0.5) * step * 0.9;
      const forest = vnoise(px * 0.025 + 5, pz * 0.025 + 9);
      if (rand() > forest * 1.15 - 0.05) continue;
      if (pathDist(px, pz) < 5) continue;
      if (Math.hypot(px, pz) < 19) continue;
      if (Math.hypot(px - LAKE.x, pz - LAKE.z) < LAKE.r * 0.82) continue;
      if (Math.hypot(px - RUINS.x, pz - RUINS.z) < 17) continue;
      trees.push({ x: px, z: pz, s: 0.8 + rand() * 0.6 });
    }
  }
  // a few hand-placed trees framing the shrine clearing
  [[-14, -12], [15, -13], [-16, 9], [13, 14], [-6, -17], [20, 4]].forEach(([x, z]) => trees.push({ x, z, s: 1.1 }));

  // ---- canopy blobs ----
  // Broadleaf trees: a dome of leaf clusters. Pines: stacked, flattened tiers.
  const blobs = []; // per instance: x,y,z,size | baseX,baseY,baseZ,seed | crownY,flatten,pine,0
  for (const t of trees) {
    const y0 = terrainHeight(t.x, t.z);
    const pine = rand() < 0.3;
    const seed = rand();
    t.y0 = y0;
    if (pine) {
      const trunkH = (1.4 + rand() * 0.8) * t.s;
      const height = (4.6 + rand() * 2.4) * t.s;
      t.trunkH = height * 0.85;
      const tiers = 5 + Math.floor(rand() * 2);
      for (let i = 0; i < tiers; i++) {
        const k = i / (tiers - 1);
        const r = (1.9 - k * 1.55) * t.s;
        blobs.push(t.x + (rand() - 0.5) * 0.2, y0 + trunkH + k * (height - trunkH), t.z + (rand() - 0.5) * 0.2, r,
          t.x, y0, t.z, seed, y0 + trunkH + (height - trunkH) * 0.5, 0.45, 1, 0);
      }
    } else {
      const trunkH = (2.4 + rand() * 1.6) * t.s;
      t.trunkH = trunkH;
      const crown = (2.2 + rand() * 1.3) * t.s;
      const cy = y0 + trunkH + crown * 0.55;
      const n = 8 + Math.floor(rand() * 4);
      // inner core keeps the crown solid
      blobs.push(t.x, cy, t.z, crown * 0.75, t.x, y0, t.z, seed, cy, 0.8, 0, 0);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const el = (rand() * 0.9 - 0.15) * Math.PI / 2;           // mostly upper hemisphere
        const d = crown * (0.55 + rand() * 0.35);
        blobs.push(
          t.x + Math.cos(a) * Math.cos(el) * d, cy + Math.sin(el) * d * 0.7, t.z + Math.sin(a) * Math.cos(el) * d,
          crown * (0.38 + rand() * 0.22),
          t.x, y0, t.z, seed, cy, 0.85, 0, 0,
        );
      }
    }
    colliders.push({ x: t.x, z: t.z, r: 0.5 * t.s });
  }
  // ---- split into chunks so trees outside the camera (or shadow) view are skipped ----
  const STRIDE = 12, CHUNK = 32;
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const chunks = new Map();
  for (let i = 0; i < blobs.length / STRIDE; i++) {
    const key = `${Math.floor(blobs[i * STRIDE + 4] / CHUNK)},${Math.floor(blobs[i * STRIDE + 6] / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(i);
  }
  const canopyGeos = [];
  for (const list of chunks.values()) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = sphere.index;
    geo.setAttribute('position', sphere.getAttribute('position'));
    geo.setAttribute('normal', sphere.getAttribute('normal'));
    const n = list.length;
    const ps = new Float32Array(n * 4), bs = new Float32Array(n * 4), xs = new Float32Array(n * 4);
    const box = new THREE.Box3();
    list.forEach((bi, j) => {
      for (let k = 0; k < 4; k++) {
        ps[j * 4 + k] = blobs[bi * STRIDE + k];
        bs[j * 4 + k] = blobs[bi * STRIDE + 4 + k];
        xs[j * 4 + k] = blobs[bi * STRIDE + 8 + k];
      }
      const r = blobs[bi * STRIDE + 3] * 1.4 + 1.0;
      box.expandByPoint(new THREE.Vector3(ps[j * 4] - r, ps[j * 4 + 1] - r, ps[j * 4 + 2] - r));
      box.expandByPoint(new THREE.Vector3(ps[j * 4] + r, ps[j * 4 + 1] + r, ps[j * 4 + 2] + r));
    });
    geo.setAttribute('iPS', new THREE.InstancedBufferAttribute(ps, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(bs, 4));
    geo.setAttribute('iX', new THREE.InstancedBufferAttribute(xs, 4));
    geo.instanceCount = n;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    geo.boundingBox = box;
    canopyGeos.push(geo);
  }

  const leafMat = new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */`
      ${COMMON_GLSL}
      attribute vec4 iPS; attribute vec4 iB; attribute vec4 iX;
      varying vec3 vP; varying vec3 vN; varying float vSeed; varying float vOcc; varying float vPine;
      void main(){
        float seed = iB.w;
        vec3 n = normal;
        float lump = sin(n.x*5.0 + seed*10.0 + iPS.x)*sin(n.y*4.0 + seed*7.0)*sin(n.z*5.0 + seed*3.0 + iPS.z);
        vec3 p = position*iPS.w*(1.0 + lump*0.22);
        p.y *= iX.y;
        if (iX.z > 0.5) p.y -= iPS.w*0.25*(1.0 - n.y); // drooping pine tiers
        vec3 W = iPS.xyz + p;
        // sway: higher = more, gusts roll through the forest
        float h = max(W.y - iB.y, 0.0);
        float g = gust(iB.xz);
        vec2 sway = uWindDir*(g*0.35 + 0.08*sin(uTime*1.4 + seed*20.0))*uWindStrength
                  + vec2(sin(uTime*0.9 + seed*13.0), cos(uTime*1.1 + seed*7.0))*0.04;
        W.xz += sway*h*0.12;
        // leaves flutter
        W += n*sin(uTime*6.0 + dot(W, vec3(3.1, 2.3, 2.7)))*0.03*uWindStrength;
        // ambient occlusion: clusters facing out of the crown and up are lit, the inside is dark
        vec3 axis = vec3(iB.x, iX.x, iB.z);
        vec3 out_ = W - axis;
        float outward = dot(normalize(n), normalize(out_ + vec3(0.0, 0.6, 0.0)))*0.5 + 0.5;
        float vertical = smoothstep(iX.x - iPS.w*2.0, iX.x + iPS.w*1.5, W.y);
        vOcc = (0.3 + 0.7*outward)*(0.5 + 0.5*vertical);
        vP = W; vN = normalize(n + vec3(0.0, 0.3, 0.0)); vSeed = seed; vPine = iX.z;
        gl_Position = projectionMatrix*viewMatrix*vec4(W, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vP; varying vec3 vN; varying float vSeed; varying float vOcc; varying float vPine;
      void main(){
        if (uShadowPass > 0.5){
          // gaps between leaves let moonlight through: dappled shadows
          if (vnoise(vP.xz*1.5 + vP.y*1.9) > 0.66) discard;
          gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
          return;
        }
        // dissolve any canopy between the camera and the hero, so you never lose sight of him
        vec3 cp = uPlayerPos + vec3(0.0, 1.0, 0.0);
        vec3 ray = cp - cameraPosition;
        float L = length(ray);
        vec3 rd = ray/L;
        float t = dot(vP - cameraPosition, rd);
        if (t > 0.0 && t < L - 0.8){
          float off = length(cameraPosition + rd*t - vP);
          float near = 1.0 - smoothstep(2.2, 5.0, off);
          if (near > 0.0 && hash12(floor(gl_FragCoord.xy)) < near*0.93) discard;
        }
        float leaf = vnoise(vP.xz*2.6 + vP.y*1.7)*0.6 + vnoise(vP.xz*6.0 - vP.y*4.0)*0.4;
        vec3 broad = mix(vec3(0.09, 0.17, 0.16), vec3(0.21, 0.33, 0.26), vSeed);
        vec3 pine = mix(vec3(0.05, 0.12, 0.11), vec3(0.10, 0.19, 0.16), vSeed);
        vec3 alb = mix(broad, pine, vPine)*(0.4 + leaf*1.2)*vOcc*1.35;
        vec3 c = shade(alb, normalize(vN), vP, 0.35);
        gl_FragColor = vec4(c, 1.0);
        WRITE_ID(${MAT.LEAVES});
      }`,
  });
  const group = new THREE.Group();
  for (const geo of canopyGeos) {
    const canopy = new THREE.Mesh(geo, leafMat);
    canopy.layers.enable(1);
    group.add(canopy);
  }

  // ---- trunks ----
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.36, 1, 7, 3);
  trunkGeo.translate(0, 0.5, 0);
  { // a little bend and root flare
    const a = trunkGeo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const y = a.getY(i);
      a.setX(i, a.getX(i) * (1 + Math.max(0, 0.15 - y) * 3) + Math.sin(y * 2.5) * 0.08);
    }
    trunkGeo.computeVertexNormals();
  }
  const trunkMat = makeLitMaterial(shared, { color: [0.20, 0.15, 0.11], id: MAT.STONE, detail: 0.8 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const trunkChunks = new Map();
  for (const t of trees) {
    const key = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
    if (!trunkChunks.has(key)) trunkChunks.set(key, []);
    trunkChunks.get(key).push(t);
  }
  for (const list of trunkChunks.values()) {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(p.set(t.x, t.y0 - 0.2, t.z), q, sc.set(t.s, t.trunkH + 1.0, t.s));
      trunks.setMatrixAt(i, m);
    });
    trunks.computeBoundingSphere();
    trunks.layers.enable(1);
    group.add(trunks);
  }

  group.userData.trees = trees;
  return group;
}
