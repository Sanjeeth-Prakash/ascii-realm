// Glyph grass: every blade is one character stroke ('|', 'l', '!', 'i', ';' ...)
// drawn from its root to its tip at full screen resolution, so it rotates
// smoothly as the wind bends it and as you push through. Blades live in square
// tiles laid out around the camera (tiles outside the view are skipped).
// Lighting (moon, torches, tree shadows, clouds, mist) is worked out per blade.

import * as THREE from 'three';
import { COMMON_GLSL } from '../render/lighting.js';
import { OVERLAY_GLSL, strokeIndex } from '../render/AsciiRenderer.js';
import { terrainHeight } from './terrainMath.js';

const BLADES = ['|', 'l', '!', 'i', ';', 'j', 'f', '|', 'l', '|', '|', 'i'].map(strokeIndex);
const FLOWERS = ['*', '*', '+', '+', 'o'].map(strokeIndex);

export function createGrass(shared, overlayUniforms, { density = 26, tile = 8, grid = 9 } = {}) {
  const radius = (grid * tile) / 2 - tile * 0.5;
  const count = Math.round(density * tile * tile);

  // one quad per blade: x across the glyph (-0.5..0.5), y from root (0) to tip (1)
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.instanceCount = count;
  const off = new Float32Array(count * 2);
  const rnd = new Float32Array(count * 4);
  const glyph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    off[i * 2] = Math.random() * tile;
    off[i * 2 + 1] = Math.random() * tile;
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    const flower = Math.random() < 0.014;
    glyph[i] = flower ? FLOWERS[Math.floor(Math.random() * FLOWERS.length)] + 100 : BLADES[Math.floor(Math.random() * BLADES.length)];
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(glyph, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile / 2, 0.5, tile / 2), tile * 0.75 + 2.5);

  const center = { value: new THREE.Vector2() };
  const vertexShader = /* glsl */`
    #define OVERLAY_VERTEX
    ${COMMON_GLSL}
    ${OVERLAY_GLSL}
    attribute vec2 aOffset; attribute vec4 aRand; attribute float aGlyph;
    uniform vec2 uTile; uniform vec2 uCenter; uniform float uRadius;
    varying vec2 vUv; varying vec3 vCol; varying float vGlyph; varying float vFade;
    void main(){
      // vary the layout per tile so tiles don't visibly repeat
      vec2 o = aOffset;
      float th = hash12(uTile*0.173 + 3.7);
      if (th > 0.5) o = o.yx;
      if (fract(th*7.13) > 0.5) o.x = ${tile.toFixed(1)} - o.x;
      vec2 wp = uTile + o;

      float dens = grassDensity(wp);
      float edge = 1.0 - smoothstep(uRadius*0.8, uRadius, length(wp - uCenter));
      bool flower = aGlyph > 99.0;
      if (aRand.x > dens || edge <= 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

      float patchy = 0.6 + 0.8*vnoise(wp*0.11 + 11.0);
      float H = (0.13 + aRand.y*0.22)*patchy*(0.4 + 0.6*edge)*(flower ? 1.2 : 1.0);

      // wind: rolling gusts plus a little flutter
      float g = gust(wp);
      vec2 side = vec2(cos(aRand.z*6.2831), sin(aRand.z*6.2831));
      vec2 bend = uWindDir*(0.06 + g*0.55)*uWindStrength + side*(aRand.w - 0.5)*0.42;
      bend += vec2(-uWindDir.y, uWindDir.x)*sin(uTime*2.7 + aRand.w*40.0 + wp.x*0.3)*0.06*uWindStrength;

      // pushed aside by the player + recent footsteps
      vec2 push = vec2(0.0);
      for (int i = 0; i < TRAIL_LEN; i++){
        vec2 d = wp - uTrail[i].xz;
        float l = length(d);
        push += (d/max(l, 1e-3))*(1.0 - smoothstep(0.12, 1.15, l))*uTrail[i].w;
      }
      bend = mix(bend, push*1.6, clamp(length(push), 0.0, 1.0));
      float bl = length(bend);
      if (bl > 1.25) bend *= 1.25/bl;
      if (flower) bend *= 0.35;

      vec3 B = vec3(wp.x, terrainHeight(wp), wp.y);
      vec3 T = B + vec3(bend.x*H, H*(1.0 - 0.45*min(bl, 1.25)), bend.y*H);
      vec3 M = mix(B, T, 0.55);

      // build the glyph quad in screen pixels along root -> tip
      vec4 cB = projectionMatrix*viewMatrix*vec4(B, 1.0);
      vec4 cT = projectionMatrix*viewMatrix*vec4(T, 1.0);
      vec4 cM = projectionMatrix*viewMatrix*vec4(M, 1.0);
      vec2 half_ = uGridPx*0.5;
      vec2 sB = cB.xy/cB.w*half_, sT = cT.xy/cT.w*half_;
      vec2 dir = sT - sB;
      float L = max(length(dir), 1.0);
      vec2 ax = dir/L;
      if (flower){ ax = normalize(mix(vec2(0.0, 1.0), ax, 0.3)); }
      vec2 px = vec2(-ax.y, ax.x);
      float len = flower ? clamp(L*1.6, 7.0, 16.0) : L*1.4;
      vec2 root = flower ? sT - ax*len*0.5 : sB - ax*L*0.15;
      // thickness tops out near one character width, so close-up blades stay thin strokes
      float wid = min(len*0.5, uCellSize.x*(flower ? 1.6 : 1.15));
      vec2 s = root + ax*position.y*len + px*position.x*wid;
      gl_Position = vec4(s/half_*cM.w, cM.z, cM.w);

      // lighting for the whole blade
      vec3 N = normalize(vec3(bend.x*0.6, 1.0, bend.y*0.6));
      float sky = moonShadow(M, vec3(0.0, 1.0, 0.0))*cloudShade(B);
      vec3 tip = mix(vec3(0.13, 0.30, 0.10), vec3(0.26, 0.42, 0.17), aRand.y);
      tip = mix(tip, vec3(0.42, 0.40, 0.18), step(0.93, aRand.w)*0.6);       // a few dry blades
      tip *= (0.75 + 0.5*aRand.w)*(1.0 + g*0.4);
      if (flower){
        float k = fract(aRand.w*7.0);
        tip = k < 0.4 ? vec3(0.85, 0.85, 0.80) : (k < 0.7 ? vec3(0.95, 0.80, 0.30) : vec3(0.60, 0.45, 0.90));
      }
      vec3 col = tip*lightSky(N, M, 0.6, sky);
      col = fogMist(col, M, mistAmount(M))*blobShadow(B);
      vCol = col;
      vUv = vec2(position.x + 0.5, position.y);
      vGlyph = flower ? aGlyph - 100.0 : aGlyph;
      vFade = edge;
    }`;
  const fragmentShader = /* glsl */`
    ${COMMON_GLSL}
    ${OVERLAY_GLSL}
    varying vec2 vUv; varying vec3 vCol; varying float vGlyph; varying float vFade;
    void main(){
      float a = smoothstep(0.2, 0.6, strokeAlpha(vUv, vGlyph));
      vec4 t = toneGlyph(vCol);
      a *= t.a*vFade;
      if (a < 0.02) discard;
      if (hiddenByScene(0.0003)) discard;
      gl_FragColor = vec4(t.rgb, a);
    }`;

  const group = new THREE.Group();
  const tiles = [];
  for (let i = 0; i < grid * grid; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...overlayUniforms, uTile: { value: new THREE.Vector2() }, uCenter: center, uRadius: { value: radius } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,   // the quad's winding flips with the blade's screen direction
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    tiles.push(mesh);
  }

  group.userData.update = (c) => {
    center.value.set(c.x, c.z);
    const bx = Math.floor(c.x / tile) - (grid >> 1);
    const bz = Math.floor(c.z / tile) - (grid >> 1);
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const m = tiles[j * grid + i];
        const x = (bx + i) * tile, z = (bz + j) * tile;
        m.material.uniforms.uTile.value.set(x, z);
        m.position.set(x, terrainHeight(x + tile / 2, z + tile / 2), z);
        m.visible = Math.hypot(x + tile / 2 - c.x, z + tile / 2 - c.z) < radius + tile * 0.75;
      }
    }
  };
  group.userData.dispose = () => { tiles.forEach((m) => m.material.dispose()); geo.dispose(); };
  return group;
}
