// Shared lighting + wind + world uniforms used by every material in the scene.
// Every scene shader writes a material ID into the alpha channel; the ASCII pass
// uses it to choose a glyph set (grass strokes, dense leaf clumps, stone, fire...).
//
// Lighting model: ambient sky + moon/sun (with real shadow map + drifting cloud
// shadows) + up to 16 flickering torches, then distance fog and low-lying mist.

import * as THREE from 'three';
import { NOISE_GLSL, TERRAIN_GLSL } from '../world/terrainMath.js';

export const MAX_LIGHTS = 16;
export const TRAIL_LEN = 8;

export const MAT = { GROUND: 0, GRASS: 1, LEAVES: 2, STONE: 3, CHAR: 4, FIRE: 5, WATER: 6, WEB: 7 };

export function createShared() {
  return {
    uTime: { value: 0 },
    uAmbient: { value: new THREE.Vector3(0.03, 0.04, 0.06) },
    uMoonDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uMoonColor: { value: new THREE.Vector3(0.22, 0.28, 0.40) },
    uFogColor: { value: new THREE.Vector3(0.01, 0.012, 0.02) },
    uFogDensity: { value: 0.006 },
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
    uLightCount: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.85, 0.35).normalize() },
    uWindStrength: { value: 0.6 },
    uPlayerPos: { value: new THREE.Vector3() },
    uTrail: { value: Array.from({ length: TRAIL_LEN }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uRain: { value: 0 },
    uFlash: { value: 0 },
    uCloud: { value: 0.5 },
    uMist: { value: 0.6 },
    // moon shadow map
    uShadowPass: { value: 0 },
    uShadowOn: { value: 0 },
    uShadowMat: { value: new THREE.Matrix4() },
    uShadowSize: { value: 2048 },
    tShadow: { value: null },
  };
}

export const COMMON_GLSL = /* glsl */`
#define MAX_LIGHTS ${MAX_LIGHTS}
#define TRAIL_LEN ${TRAIL_LEN}
uniform float uTime;
uniform vec3 uAmbient;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform int uLightCount;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uPlayerPos;
uniform vec4 uTrail[TRAIL_LEN];
uniform float uRain;
uniform float uFlash;
uniform float uCloud;
uniform float uMist;
uniform float uShadowPass;
uniform float uShadowOn;
uniform mat4 uShadowMat;
uniform float uShadowSize;
uniform sampler2D tShadow;
${NOISE_GLSL}
${TERRAIN_GLSL}

// Shadow-map pass: every caster writes only its depth.
#define SHADOW_PASS_OUT if (uShadowPass > 0.5) { gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); return; }

// Rolling gusts that travel across the world along the wind direction.
float gust(vec2 p){
  vec2 q = p*0.045 - uWindDir*uTime*0.55;
  float n = vnoise(q)*0.65 + vnoise(q*2.3 + 7.1)*0.35;
  float wave = 0.5 + 0.5*sin(dot(p, uWindDir)*0.22 - uTime*2.2);
  return clamp(n*0.8 + wave*0.45 - 0.22, 0.0, 1.0);
}

// Soft (3x3 PCF) moon/sun shadows.
float moonShadow(vec3 P, vec3 N){
  if (uShadowOn < 0.5) return 1.0;
  vec4 sp = uShadowMat*vec4(P + N*0.06, 1.0);
  vec3 s = sp.xyz/sp.w*0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  vec2 t = vec2(0.9/uShadowSize);
  float z = s.z - 0.0015;
  float sum = step(z, texture2D(tShadow, s.xy + vec2(-t.x, -t.y)).r)
            + step(z, texture2D(tShadow, s.xy + vec2( t.x, -t.y)).r)
            + step(z, texture2D(tShadow, s.xy + vec2(-t.x,  t.y)).r)
            + step(z, texture2D(tShadow, s.xy + vec2( t.x,  t.y)).r);
  float edge = smoothstep(0.0, 0.08, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)));
  return mix(1.0, sum*0.25, edge);
}

// Big soft cloud shadows drifting across the land.
float cloudShade(vec3 P){
  vec2 q = P.xz*0.011 + uWindDir*uTime*0.02;
  float c = vnoise(q)*0.62 + vnoise(q*2.2 + 5.3)*0.38;
  return mix(1.0, mix(0.5, 1.0, smoothstep(0.36, 0.68, c)), uCloud);
}

vec3 torchLight(vec3 N, vec3 P, float wrap){
  vec3 L = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++){
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i].xyz - P;
    float dist = length(d);
    float att = 1.0 - smoothstep(0.0, uLightPos[i].w, dist);
    att *= att;
    float ndl = max((dot(N, d/max(dist, 1e-3)) + wrap)/(1.0 + wrap), 0.0);
    L += uLightColor[i]*att*ndl;
  }
  return L;
}

// sky = moon shadow * cloud shade, passed in when already known (grass works it out per vertex)
vec3 lightSky(vec3 N, vec3 P, float wrap, float sky){
  vec3 L = uAmbient*(1.0 + uFlash*8.0);
  L += uMoonColor*(1.0 + uFlash*3.0)*max((dot(N, uMoonDir) + wrap)/(1.0 + wrap), 0.0)*sky;
  L += torchLight(N, P, wrap);
  return L;
}
vec3 lightAll(vec3 N, vec3 P, float wrap){ return lightSky(N, P, wrap, moonShadow(P, N)*cloudShade(P)); }

// low-lying mist pooling in hollows and over the lake
float mistAmount(vec3 P){
  float low = 1.0 - smoothstep(-0.9, 0.6, P.y);
  if (low*uMist < 0.01) return 0.0;
  vec2 q = P.xz*0.06 + uWindDir*uTime*0.05;
  return smoothstep(0.32, 0.78, vnoise(q)*0.6 + vnoise(q*2.3 + 1.7)*0.4)*low*uMist;
}
vec3 fogMist(vec3 c, vec3 P, float m){
  float d = length(P - cameraPosition);
  float fo = 1.0 - exp(-pow(d*uFogDensity, 2.0));
  c = mix(c, uFogColor, clamp(fo + uRain*0.08, 0.0, 1.0));
  vec3 mc = uFogColor*2.0 + uMoonColor*0.4 + uAmbient*0.7;
  return mix(c, mc, clamp(m*0.7, 0.0, 1.0));
}
vec3 fogIt(vec3 c, vec3 P){ return fogMist(c, P, mistAmount(P)); }

vec3 shade(vec3 alb, vec3 N, vec3 P, float wrap){ return fogIt(alb*lightAll(N, P, wrap), P); }

float blobShadow(vec3 P){
  float d = length(P.xz - uPlayerPos.xz);
  float s = mix(0.45, 1.0, smoothstep(0.2, 1.0, d));
  return mix(s, 1.0, smoothstep(0.25, 0.8, P.y - uPlayerPos.y));
}

#define WRITE_ID(id) gl_FragColor.a = (float(id) + 0.5)/8.0
`;

// General lit material for solid objects (stone, bark, props).
// Works with Mesh and InstancedMesh.
export function makeLitMaterial(shared, { color, id, detail = 0.6, variance = 0.3, rim = 0.0, wrap = 0.2, flagstone = false, side = THREE.FrontSide }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Vector3(...color) },
      uDetail: { value: detail },
      uVar: { value: variance },
      uRim: { value: rim },
      uWrap: { value: wrap },
    },
    defines: { ID: id, ...(flagstone ? { FLAGSTONE: 1 } : {}) },
    side,
    vertexShader: /* glsl */`
      ${COMMON_GLSL}
      varying vec3 vN; varying vec3 vP; varying float vSeed;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(m) * normal);
        vSeed = hash12(vec2(m[3][0], m[3][2]) * 1.37);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_GLSL}
      uniform vec3 uColor; uniform float uDetail; uniform float uVar; uniform float uRim; uniform float uWrap;
      varying vec3 vN; varying vec3 vP; varying float vSeed;
      void main(){
        SHADOW_PASS_OUT
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec2 nq = vP.xz*1.7 + vec2(vP.y*1.3, -vP.y*0.9);
        float n = vnoise(nq)*0.6 + vnoise(nq*2.1)*0.4;
        vec3 alb = uColor*(1.0 + (vSeed - 0.5)*uVar)*mix(1.0, 0.55 + 0.9*n, uDetail);
        #ifdef FLAGSTONE
          vec2 g = vP.xz*0.6;
          g.x += floor(g.y)*0.5;
          vec2 fr = fract(g);
          float grout = smoothstep(0.02, 0.12, min(min(fr.x, 1.0 - fr.x), min(fr.y, 1.0 - fr.y)));
          alb *= mix(0.12, 1.0, grout) * (0.6 + 0.7*hash12(floor(g)));
          // moss creeping between the stones
          alb = mix(alb, vec3(0.05, 0.10, 0.04), (1.0 - grout)*smoothstep(0.4, 0.8, vnoise(vP.xz*0.8)));
        #endif
        vec3 c = shade(alb, N, vP, uWrap) * blobShadow(vP);
        vec3 V = normalize(cameraPosition - vP);
        c += uColor*uRim*pow(1.0 - max(dot(N, V), 0.0), 3.0)*(0.25 + 2.0*length(torchLight(N, vP, 1.0)));
        gl_FragColor = vec4(c, 1.0);
        WRITE_ID(ID);
      }`,
  });
}

// Material for imported models (skinned and/or morph-animated, textured or
// vertex-colored). Keeps the model's own texture/colors as albedo but lights it
// with the world's lighting and writes the glyph-set ID.
export function makeModelMaterial(shared, source, { id = MAT.CHAR, tint = [1, 1, 1], brightness = 1.4, rim = 0.8, wrap = 0.5, emissive = 0 } = {}) {
  const map = source?.map || null;
  const baseColor = source?.color ? source.color.clone() : new THREE.Color(1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uMap: { value: map },
      uBase: { value: new THREE.Vector3(baseColor.r * tint[0], baseColor.g * tint[1], baseColor.b * tint[2]) },
      uBright: { value: brightness },
      uRim: { value: rim },
      uWrap: { value: wrap },
      uEmissive: { value: emissive },
    },
    defines: { ID: id, ...(map ? { HAS_MAP: 1 } : {}) },
    vertexColors: !!source?.vertexColors,
    side: source?.side ?? THREE.FrontSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <color_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      ${COMMON_GLSL}
      varying vec3 vN; varying vec3 vP; varying vec2 vUv2;
      void main(){
        #include <color_vertex>
        #include <morphcolor_vertex>
        #include <beginnormal_vertex>
        #include <morphinstance_vertex>
        #include <morphnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        vec4 wp = modelMatrix*vec4(transformed, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(modelMatrix)*objectNormal);
        vUv2 = uv;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <color_pars_fragment>
      ${COMMON_GLSL}
      uniform sampler2D uMap; uniform vec3 uBase; uniform float uBright; uniform float uRim; uniform float uWrap; uniform float uEmissive;
      varying vec3 vN; varying vec3 vP; varying vec2 vUv2;
      void main(){
        SHADOW_PASS_OUT
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 alb = uBase;
        #ifdef HAS_MAP
          alb *= texture2D(uMap, vUv2).rgb;
        #endif
        #if defined(USE_COLOR)
          alb *= vColor;
        #endif
        alb *= uBright;
        vec3 c = shade(alb, N, vP, uWrap);
        vec3 V = normalize(cameraPosition - vP);
        c += alb*uRim*pow(1.0 - max(dot(N, V), 0.0), 2.5)*(0.15 + 2.2*length(torchLight(N, vP, 1.0)) + length(uAmbient)*1.5);
        c += alb*uEmissive;
        gl_FragColor = vec4(c, 1.0);
        WRITE_ID(ID);
      }`,
  });
  return mat;
}

// Swap every mesh material in an imported model for the ASCII-world material.
export function applyModelMaterials(root, shared, opts) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => makeModelMaterial(shared, m, opts))
      : makeModelMaterial(shared, o.material, opts);
    o.frustumCulled = false;
    o.layers.enable(1); // casts moon shadows
  });
}
