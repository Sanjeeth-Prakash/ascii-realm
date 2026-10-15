// Every fire in the world: flickering flame billboards, rising embers, the
// point lights that feed the shaders, and the soft screen-space halos.

import * as THREE from 'three';
import { COMMON_GLSL, MAT, MAX_LIGHTS } from '../render/lighting.js';
import { OVERLAY_GLSL } from '../render/AsciiRenderer.js';

const MAX_FLAMES = 32;
const MAX_EMBERS = 420;
const FIRE = new THREE.Vector3(1.0, 0.55, 0.22);

export class TorchSystem {
  // embers are drawn in the glyph-art layer (`overlay`) as crisp glowing sparks
  constructor(scene, shared, overlay, overlayUniforms) {
    this.shared = shared;
    this.torches = [];
    this.time = 0;
    this.dayFactor = 1; // 1 at night (strong), lower by day

    // ---- flames ----
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    this.flameAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4);
    this.flameAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iF', this.flameAttr);
    geo.instanceCount = 0;
    this.flameGeo = geo;
    const flames = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { ...shared },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${COMMON_GLSL}
        attribute vec4 iF; // xyz, scale (seed derived from position)
        varying vec2 vUv; varying float vSeed;
        void main(){
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, 0.55));
          float s = iF.w;
          vec3 W = iF.xyz + right*position.x*s*0.6 + up*position.y*s;
          W.xz += uWindDir*position.y*position.y*0.3*s*uWindStrength;
          vUv = uv; vSeed = hash12(iF.xz*3.7);
          gl_Position = projectionMatrix*viewMatrix*vec4(W, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${COMMON_GLSL}
        varying vec2 vUv; varying float vSeed;
        void main(){
          float y = vUv.y;
          float n = vnoise(vec2(vUv.x*4.0, y*3.0 - uTime*7.0) + vSeed*10.0);
          float x = vUv.x - 0.5 + (n - 0.5)*0.3*y;
          float w = 0.46*pow(1.0 - y, 1.1)*smoothstep(0.0, 0.25, y + 0.05);
          float d = abs(x)/max(w, 1e-3);
          if (d > 1.0) discard;
          float heat = (1.0 - d)*(1.0 - y*0.8);
          vec3 c = mix(vec3(0.9, 0.25, 0.04), vec3(1.0, 0.85, 0.45), smoothstep(0.1, 0.7, heat));
          gl_FragColor = vec4(c*(0.8 + heat*0.9), 1.0);
          WRITE_ID(${MAT.FIRE});
        }`,
    }));
    flames.frustumCulled = false;
    scene.add(flames);

    // ---- embers ----
    this.embers = Array.from({ length: MAX_EMBERS }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3() }));
    this.emberPos = new Float32Array(MAX_EMBERS * 3);
    this.emberLife = new Float32Array(MAX_EMBERS);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3).setUsage(THREE.DynamicDrawUsage));
    eg.setAttribute('aLife', new THREE.BufferAttribute(this.emberLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.emberGeo = eg;
    this.emberUniforms = { uPx: { value: 1 } };
    const embers = new THREE.Points(eg, new THREE.ShaderMaterial({
      uniforms: { ...shared, ...overlayUniforms, ...this.emberUniforms },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aLife; uniform float uPx; varying float vLife;
        void main(){
          vec4 mv = viewMatrix*vec4(position, 1.0);
          vLife = aLife;
          gl_PointSize = aLife > 0.0 ? clamp(0.09*uPx/-mv.z, 3.0, 14.0) : 0.0;
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */`
        ${OVERLAY_GLSL}
        varying float vLife;
        void main(){
          if (vLife <= 0.0) discard;
          float r = length(gl_PointCoord - 0.5)*2.0;
          float core = 1.0 - smoothstep(0.0, 0.35, r);
          float glow = (1.0 - smoothstep(0.0, 1.0, r))*0.5;
          float a = (core + glow)*min(1.0, vLife*2.5);
          if (a < 0.01 || hiddenByScene(0.0005)) discard;
          vec3 c = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.85, 0.5), vLife*core);
          gl_FragColor = vec4(c*a*1.4, 1.0);
        }`,
    }));
    embers.frustumCulled = false;
    overlay.add(embers);
  }

  add(t) {
    const torch = { color: FIRE.clone(), radius: 10, intensity: 1, on: true, carried: false, seed: Math.random() * 100, emit: 0, level: 1, ...t, pos: new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0) };
    this.torches.push(torch);
    return torch;
  }

  // burst of embers at a point (burning cobwebs, hits, etc.)
  burst(pos, count = 20, power = 1) {
    for (let i = 0; i < count; i++) {
      const e = this.embers.find((e) => e.life <= 0);
      if (!e) break;
      e.p.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * 0.6);
      e.v.set((Math.random() - 0.5) * 2.5 * power, (0.8 + Math.random() * 2.2) * power, (Math.random() - 0.5) * 2.5 * power);
      e.max = e.life = 0.5 + Math.random() * 1.0;
    }
  }

  // short-lived fire light that fades out
  flash(pos, { duration = 0.8, radius = 5, intensity = 1.3 } = {}) {
    const t = this.add({ x: pos.x, y: pos.y, z: pos.z, radius, intensity, temp: duration, tempMax: duration, noFlame: true });
    return t;
  }

  flicker(t) {
    const s = t.seed, x = this.time;
    return 0.82 + 0.1 * Math.sin(x * 9.1 + s) + 0.06 * Math.sin(x * 23.7 + s * 3) + 0.05 * Math.sin(x * 4.3 + s * 7);
  }

  update(dt, focus, camera, ascii) {
    this.time += dt;
    const sh = this.shared;
    // fade torches in/out smoothly
    for (const t of this.torches) {
      t.level += ((t.on ? 1 : 0) - t.level) * Math.min(1, dt * 6);
      if (t.temp !== undefined) { t.temp -= dt; t.level = Math.max(0, t.temp / t.tempMax); }
    }
    this.torches = this.torches.filter((t) => t.temp === undefined || t.temp > 0);

    // feed nearest lights to the shaders
    const live = this.torches.filter((t) => t.level > 0.02)
      .map((t) => ({ t, d: t.pos.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LIGHTS);
    live.forEach(({ t }, i) => {
      const f = this.flicker(t) * t.intensity * t.level;
      const jitter = 0.05;
      sh.uLightPos.value[i].set(
        t.pos.x + Math.sin(this.time * 13 + t.seed) * jitter,
        t.pos.y + 0.35,
        t.pos.z + Math.cos(this.time * 11 + t.seed) * jitter,
        t.radius * (0.92 + 0.08 * f),
      );
      sh.uLightColor.value[i].copy(t.color).multiplyScalar(f * 1.25 * (0.5 + 0.5 * this.dayFactor));
    });
    sh.uLightCount.value = live.length;

    // flames
    let n = 0;
    for (const t of this.torches) {
      if (n >= MAX_FLAMES) break;
      if (t.noFlame) continue;
      const s = (t.carried ? 0.45 : 0.75) * t.level * (0.9 + 0.15 * this.flicker(t));
      if (s < 0.02) continue;
      this.flameAttr.setXYZW(n++, t.pos.x, t.pos.y, t.pos.z, s);
    }
    this.flameGeo.instanceCount = n;
    this.flameAttr.needsUpdate = true;

    // embers
    const wind = sh.uWindDir.value, ws = sh.uWindStrength.value;
    for (const t of this.torches) {
      if (t.level < 0.3 || t.noFlame) continue;
      t.emit += dt * (t.carried ? 7 : 11);
      while (t.emit > 1) {
        t.emit -= 1;
        const e = this.embers.find((e) => e.life <= 0);
        if (!e) break;
        e.p.set(t.pos.x + (Math.random() - 0.5) * 0.2, t.pos.y + 0.3, t.pos.z + (Math.random() - 0.5) * 0.2);
        e.v.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6);
        e.max = e.life = 0.8 + Math.random() * 1.4;
      }
    }
    this.embers.forEach((e, i) => {
      if (e.life > 0) {
        e.life -= dt;
        e.v.x += (wind.x * ws * 1.6 - e.v.x) * dt * 0.8 + (Math.random() - 0.5) * dt * 3;
        e.v.z += (wind.y * ws * 1.6 - e.v.z) * dt * 0.8 + (Math.random() - 0.5) * dt * 3;
        e.v.y *= 1 - dt * 0.4;
        e.p.addScaledVector(e.v, dt);
      }
      this.emberPos[i * 3] = e.p.x; this.emberPos[i * 3 + 1] = e.p.y; this.emberPos[i * 3 + 2] = e.p.z;
      this.emberLife[i] = Math.max(0, e.life / e.max);
    });
    this.emberGeo.attributes.position.needsUpdate = true;
    this.emberGeo.attributes.aLife.needsUpdate = true;
    this.emberUniforms.uPx.value = ascii.gridPx.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    // screen-space halos
    const out = [];
    const tmp = new THREE.Vector3();
    const fovPx = ascii.gridPx.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const { t } of live) {
      ascii.project(tmp.copy(t.pos).setY(t.pos.y + 0.35), camera, tmp);
      if (tmp.z > 1) continue;
      const dist = camera.position.distanceTo(t.pos);
      out.push({
        x: tmp.x, y: tmp.y,
        r: (t.carried ? 1.5 : 2.2) * fovPx / dist,
        intensity: 0.5 * this.flicker(t) * t.level * (0.35 + 0.65 * this.dayFactor),
        color: FIRE,
      });
    }
    ascii.glows = out;
  }
}
