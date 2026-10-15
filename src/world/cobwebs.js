// Cobwebs draped over the undergrowth, between trees and in the ruins.
// Carry the torch through one and it catches fire: a glowing burn front eats
// outward from where the flame touched, with embers and a flash of light.
// Walk through without a torch and it tears and drifts away. Webs grow back
// after a few minutes, like any MMO world.

import * as THREE from 'three';
import { COMMON_GLSL } from '../render/lighting.js';
import { OVERLAY_GLSL } from '../render/AsciiRenderer.js';
import { terrainHeight, mulberry32, RUINS } from './terrainMath.js';

const REGROW = 150; // seconds

// Build one irregular orb-web as thin ribbons in the XY plane.
function webGeometry(rand, R) {
  const pos = [], dist = [], seed = [], mid = [];
  const spokes = 9 + Math.floor(rand() * 5);
  const angles = [];
  for (let i = 0; i < spokes; i++) angles.push((i / spokes) * Math.PI * 2 + (rand() - 0.5) * 0.35);
  const len = angles.map(() => R * (0.75 + rand() * 0.25));
  // each thread is a 1-pixel line segment: crisp line art at any zoom
  const ribbon = (ax, ay, bx, by, s) => {
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      pos.push(x, y, 0);
      dist.push(Math.hypot(x, y) / R);
      seed.push(s);
      mid.push((ax + bx) / 2, (ay + by) / 2);   // the whole thread segment burns/snaps together
    }
  };
  // spokes, with a sag
  angles.forEach((a, i) => {
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const r0 = (k / steps) * len[i], r1 = ((k + 1) / steps) * len[i];
      const sag = (r) => Math.sin((r / len[i]) * Math.PI) * 0.04 * R;
      ribbon(Math.cos(a) * r0, Math.sin(a) * r0 - sag(r0), Math.cos(a) * r1, Math.sin(a) * r1 - sag(r1), rand());
    }
  });
  // spiral capture threads, drooping between spokes, some broken
  const rings = 5 + Math.floor(rand() * 3);
  for (let r = 1; r <= rings; r++) {
    const frac = 0.12 + (r / rings) * 0.85;
    for (let i = 0; i < spokes; i++) {
      if (rand() < 0.1) continue;
      const j = (i + 1) % spokes;
      const ra = len[i] * frac, rb = len[j] * frac;
      const a0 = angles[i], a1 = angles[j] + (j === 0 ? Math.PI * 2 : 0);
      const am = (a0 + a1) / 2, rm = (ra + rb) / 2 * 0.9;
      ribbon(Math.cos(a0) * ra, Math.sin(a0) * ra, Math.cos(am) * rm, Math.sin(am) * rm, rand());
      ribbon(Math.cos(am) * rm, Math.sin(am) * rm, Math.cos(a1) * rb, Math.sin(a1) * rb, rand());
    }
  }
  // a few loose anchor strands
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    ribbon(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, Math.cos(a) * R * 1.35, Math.sin(a) * R * 1.35, rand());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aMid', new THREE.Float32BufferAttribute(mid, 2));
  g.computeBoundingSphere();
  return g;
}

export class Cobwebs {
  // webs are drawn in the glyph-art layer (`overlay`) as thin crisp threads
  constructor(overlay, shared, overlayUniforms, trees, torches) {
    this.events = [];
    this.torches = torches;
    this.webs = [];
    const rand = mulberry32(777);
    const spots = [];
    // around tree trunks near the middle of the map
    const near = trees.filter((t) => Math.hypot(t.x, t.z) < 110);
    for (let i = 0; i < 55 && near.length; i++) {
      const t = near[Math.floor(rand() * near.length)];
      const a = rand() * Math.PI * 2, d = 0.9 + rand() * 1.2;
      spots.push([t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, a]);
    }
    // the ruined keep is full of them
    for (let i = 0; i < 12; i++) {
      spots.push([RUINS.x + (rand() - 0.5) * 18, RUINS.z + (rand() - 0.5) * 14, rand() * 6.28]);
    }
    // a couple around the shrine pillars
    [[5.6, 3.5], [-6.2, 1.2], [3.0, -6.4]].forEach(([x, z]) => spots.push([x, z, rand() * 6.28]));

    const geos = [0, 1, 2, 3, 4, 5].map((i) => webGeometry(mulberry32(100 + i), 1));
    for (const [x, z, a] of spots) {
      const R = 0.6 + rand() * 0.7;
      const uniforms = {
        ...shared,
        ...overlayUniforms,
        uBurn: { value: -1 },            // seconds since ignition (-1 = not burning)
        uTear: { value: -1 },            // seconds since torn (-1 = intact)
        uOrigin: { value: new THREE.Vector2() }, // where it was touched, in web space
        uGrow: { value: 1 },
        uSeed: { value: rand() },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        transparent: true, depthTest: false, depthWrite: false,
        vertexShader: /* glsl */`
          ${COMMON_GLSL}
          attribute float aDist; attribute float aSeed; attribute vec2 aMid;
          uniform float uBurn; uniform float uTear; uniform vec2 uOrigin; uniform float uGrow; uniform float uSeed;
          varying vec3 vP; varying float vDist; varying float vSeed; varying float vPhase; varying float vMode;
          const float BURN_SPEED = 0.75;   // web radii per second
          const float TEAR_SPEED = 1.9;
          void main(){
            vec3 p = position;
            float g = gust(modelMatrix[3].xz);
            // gentle breathing in the wind
            p.z += sin(uTime*2.0 + aDist*4.0 + uSeed*10.0)*0.03*(0.3 + g)*uWindStrength*aDist;
            float d = length(aMid - uOrigin) + (aSeed - 0.5)*0.12;
            vPhase = -1.0; vMode = 0.0;
            vec3 fall = vec3(0.0);
            if (uBurn >= 0.0){
              // phase: seconds since the flame front reached this thread
              vPhase = uBurn - d/BURN_SPEED;
              vMode = 1.0;
              float t = max(vPhase - 0.18, 0.0);
              // charred threads curl toward their middle and drop as ash
              p.xy = mix(p.xy, aMid, clamp(t*1.6, 0.0, 0.85));
              p.z += sin(t*7.0 + aSeed*30.0)*0.04*min(t*3.0, 1.0);
              fall = vec3(uWindDir.x*0.35, -1.0, uWindDir.y*0.35)*(t*t*0.9) + vec3(sin(aSeed*40.0), 0.0, cos(aSeed*40.0))*t*0.12;
            }
            if (uTear >= 0.0){
              vPhase = uTear - d/TEAR_SPEED;
              vMode = 2.0;
              float t = max(vPhase, 0.0);
              // snapped strands sag, sway with the wind, and drift down
              float sag = 1.0 - exp(-t*2.5);
              p.xy = mix(p.xy, aMid + (p.xy - aMid)*0.7, sag);
              p.z += sin(uTime*5.0 + aSeed*25.0)*0.12*sag*(0.5 + g);
              fall = vec3(uWindDir.x, 0.0, uWindDir.y)*(sag*0.5 + t*0.25)*(0.4 + aSeed)
                   + vec3(0.0, -1.0, 0.0)*(sag*0.35 + t*t*0.05);
            }
            p.xy *= uGrow;
            vec4 wp = modelMatrix*vec4(p, 1.0);
            wp.xyz += fall;
            vP = wp.xyz; vDist = aDist; vSeed = aSeed;
            gl_Position = projectionMatrix*viewMatrix*wp;
          }`,
        fragmentShader: /* glsl */`
          ${COMMON_GLSL}
          ${OVERLAY_GLSL}
          uniform float uGrow;
          varying vec3 vP; varying float vDist; varying float vSeed; varying float vPhase; varying float vMode;
          void main(){
            if (hiddenByScene(0.0004)) discard;
            float dither = hash12(floor(gl_FragCoord.xy) + vSeed*91.0);
            vec3 silk = vec3(0.50, 0.54, 0.60)*(0.7 + 0.5*vSeed);
            vec3 c = silk*lightAll(vec3(0.0, 1.0, 0.0), vP, 1.0)*1.1;
            c += uMoonColor*step(0.94, fract(vSeed*13.7 + floor(uTime*0.5)))*0.8;   // dew glints
            float fire = 0.0;
            if (vMode > 0.5 && vMode < 1.5 && vPhase > -0.12){
              // ahead of the front: silk heats up; at the front: bright flame; behind: char, then ash
              float heat = smoothstep(-0.12, 0.0, vPhase)*(1.0 - smoothstep(0.05, 0.3, vPhase));
              float charT = smoothstep(0.15, 0.45, vPhase);
              vec3 flame = mix(vec3(1.8, 0.55, 0.12), vec3(2.2, 1.4, 0.5), smoothstep(0.0, 0.1, heat - 0.6));
              c = mix(c, flame, heat);
              c = mix(c, vec3(0.05, 0.04, 0.035) + vec3(0.6, 0.15, 0.02)*step(0.93, fract(vSeed*7.0 + vPhase*3.0))*(1.0 - charT*0.7), charT*(1.0 - heat));
              fire = heat;
              if (dither < smoothstep(0.7, 1.35, vPhase)) discard;   // ash crumbles away
            }
            if (vMode > 1.5 && vPhase > 0.0){
              c *= 1.0 - 0.3*smoothstep(0.0, 1.0, vPhase);
              if (dither < smoothstep(1.2, 2.4, vPhase)) discard;    // torn strands fade out
            }
            c = fogIt(c, vP);
            vec4 t = toneGlyph(c);
            // flame stays hot-bright instead of going through the glyph curve
            vec3 outc = mix(t.rgb, c, fire);
            gl_FragColor = vec4(outc, max(t.a, fire)*uGrow*0.9);
          }`,
      });
      const mesh = new THREE.LineSegments(geos[Math.floor(rand() * geos.length)], mat);
      const h = terrainHeight(x, z);
      mesh.position.set(x, h + 0.35 + rand() * 0.7, z);
      mesh.scale.setScalar(R);
      // draped low over the grass, tilted toward the sky so it reads from above
      mesh.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.9, a, (rand() - 0.5) * 0.6, 'YXZ');
      overlay.add(mesh);
      this.webs.push({ mesh, uniforms, R, state: 'whole', t: 0 });
    }
  }

  resetAll() {
    for (const w of this.webs) {
      w.state = 'whole'; w.t = 0; w.mesh.visible = true;
      w.uniforms.uBurn.value = -1; w.uniforms.uTear.value = -1; w.uniforms.uGrow.value = 1;
    }
  }

  // where a world point lands on the web, in web space (radius 1)
  touchPoint(w, world) {
    const local = w.mesh.worldToLocal(world.clone());
    const v = new THREE.Vector2(local.x, local.y);
    if (v.length() > 1.1) v.setLength(1.1);
    return v;
  }

  update(dt, player, torchTip) {
    this.events.length = 0;
    const tmp = new THREE.Vector3();
    for (const w of this.webs) {
      const u = w.uniforms;
      const p = w.mesh.position;
      if (w.state === 'whole') {
        const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
        const torchNear = player.torchOn && Math.hypot(torchTip.x - p.x, torchTip.z - p.z) < w.R + 0.5;
        if (torchNear) {
          w.state = 'burning'; w.t = 0;
          this.events.push({ type: 'burn', pos: p });
          w.mesh.updateMatrixWorld();
          u.uOrigin.value.copy(this.touchPoint(w, tmp.set(torchTip.x, p.y, torchTip.z)));
          w.mesh.localToWorld(w.ignite = new THREE.Vector3(u.uOrigin.value.x, u.uOrigin.value.y, 0));
          this.torches.burst(w.ignite, 14, 0.8);
          w.light = this.torches.flash(w.ignite, { duration: 2.2, radius: 3 + w.R * 2.5, intensity: 1.1 });
        } else if (d < w.R * 0.7 + 0.35 && Math.hypot(player.vel.x, player.vel.z) > 0.5) {
          w.state = 'tearing'; w.t = 0;
          this.events.push({ type: 'tear', pos: p });
          w.mesh.updateMatrixWorld();
          u.uOrigin.value.copy(this.touchPoint(w, tmp.set(player.pos.x, p.y, player.pos.z)));
        }
      } else if (w.state === 'burning') {
        w.t += dt;
        u.uBurn.value = w.t;
        // embers rise from the moving flame front
        const front = w.t * 0.75;
        if (front < 1.6 && Math.random() < dt * 40) {
          const a = Math.random() * Math.PI * 2;
          const o = u.uOrigin.value;
          tmp.set(o.x + Math.cos(a) * front, o.y + Math.sin(a) * front, 0);
          if (tmp.length() < 1.2) { w.mesh.localToWorld(tmp); this.torches.burst(tmp, 1, 0.5); }
        }
        if (w.light) w.light.intensity = 1.1 * Math.max(0, 1 - w.t / 2.4);
        if (w.t > 4.2) { w.state = 'gone'; w.t = 0; w.mesh.visible = false; }
      } else if (w.state === 'tearing') {
        w.t += dt;
        u.uTear.value = w.t;
        if (w.t > 3.4) { w.state = 'gone'; w.t = 0; w.mesh.visible = false; }
      } else if (w.state === 'gone') {
        w.t += dt;
        const far = Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 20;
        if (w.t > REGROW && far) {
          w.state = 'growing'; w.t = 0; w.mesh.visible = true;
          u.uBurn.value = -1; u.uTear.value = -1; u.uGrow.value = 0;
        }
      } else if (w.state === 'growing') {
        w.t += dt;
        u.uGrow.value = Math.min(1, w.t / 4);
        if (w.t > 4) w.state = 'whole';
      }
    }
  }
}
