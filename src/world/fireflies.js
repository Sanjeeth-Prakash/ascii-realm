// Fireflies drifting low over the grass at night. They live in a window around
// the player (wrapping like the grass), so there are always some nearby.

import * as THREE from 'three';
import { COMMON_GLSL } from '../render/lighting.js';
import { OVERLAY_GLSL } from '../render/AsciiRenderer.js';

// drawn in the glyph-art layer as soft glowing motes
export function createFireflies(shared, overlayUniforms, { count = 160, radius = 26 } = {}) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * radius;
    pos[i * 3 + 1] = Math.random();
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * radius;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { ...shared, ...overlayUniforms, uCenter: { value: new THREE.Vector2() }, uRadius: { value: radius }, uNight: { value: 1 }, uPx: { value: 500 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${COMMON_GLSL}
      attribute float aSeed;
      uniform vec2 uCenter; uniform float uRadius; uniform float uNight; uniform float uPx;
      varying float vGlow;
      void main(){
        vec2 rel = mod(position.xz - uCenter + uRadius, 2.0*uRadius) - uRadius;
        vec2 wp = uCenter + rel;
        // lazy wandering
        float t = uTime*0.35 + aSeed*40.0;
        wp += vec2(sin(t*1.3) + sin(t*0.7 + 2.0), cos(t*1.1) + sin(t*0.5))*1.2;
        float y = terrainHeight(wp) + 0.5 + position.y*1.6 + sin(t*2.1)*0.25;
        // more fireflies near water and in long grass, none on the path
        float place = grassDensity(wp)*(0.6 + 0.8*(1.0 - smoothstep(LAKE_R*0.7, LAKE_R*1.6, length(wp - LAKE_XZ))));
        float blink = smoothstep(0.55, 1.0, sin(uTime*(1.2 + aSeed*1.6) + aSeed*30.0));
        float edge = 1.0 - smoothstep(uRadius*0.8, uRadius, length(rel));
        vGlow = blink*uNight*edge*step(aSeed, place)*(1.0 - uRain*0.8);
        vec4 mv = viewMatrix*vec4(wp.x, y, wp.y, 1.0);
        gl_PointSize = vGlow > 0.01 ? clamp(0.45*uPx/-mv.z, 6.0, 40.0) : 0.0;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      ${OVERLAY_GLSL}
      varying float vGlow;
      void main(){
        if (vGlow < 0.01) discard;
        float r = length(gl_PointCoord - 0.5)*2.0;
        float a = (1.0 - smoothstep(0.0, 0.16, r)) + pow(1.0 - min(r, 1.0), 3.0)*0.35;   // bright core + soft halo
        if (a < 0.01 || hiddenByScene(0.0005)) discard;
        gl_FragColor = vec4(vec3(0.70, 1.0, 0.45)*a*vGlow, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.update = (center, night, pxScale) => {
    uniforms.uCenter.value.set(center.x, center.z);
    uniforms.uNight.value = night;
    uniforms.uPx.value = pxScale;
  };
  return points;
}
