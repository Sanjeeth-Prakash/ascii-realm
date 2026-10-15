// World shape, shared by the CPU (player, placement) and the GPU (grass, terrain shaders).
// The JS and GLSL versions must stay identical so grass sits exactly on the ground.

export const LAKE = { x: 55, z: -30, r: 26 };
export const WATER_LEVEL = -0.6;
export const RUINS = { x: -48, z: -22 };
export const WORLD_HALF = 200;

const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export function terrainHeight(x, z) {
  let h = Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.6
        + Math.sin(x * 0.012 + z * 0.017) * 3.0
        + Math.sin(z * 0.07 + 1.3) * 0.5;
  h *= ss(10.0, 24.0, Math.hypot(x, z));                       // flat shrine clearing
  h = mix(h, 0.2, 1.0 - ss(14.0, 22.0, Math.hypot(x - RUINS.x, z - RUINS.z))); // flat ruin floor
  const lake = 1.0 - ss(LAKE.r * 0.45, LAKE.r, Math.hypot(x - LAKE.x, z - LAKE.z));
  return mix(h, -3.0, lake);
}

export function pathZ(x) {
  return Math.sin(x * 0.03) * 14.0 + Math.sin(x * 0.011 + 1.0) * 22.0 - Math.sin(1.0) * 22.0;
}

export function pathDist(x, z) {
  const pz = Math.sin(x * 0.03) * 14.0 + Math.sin(x * 0.011 + 1.0) * 22.0 - Math.sin(1.0) * 22.0;
  return Math.abs(z - pz);
}

// ---- small JS value noise (for placement) ----
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Number(n).toFixed(4);

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), fr = fract(p); vec2 u = fr*fr*(3.0-2.0*fr);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

export const TERRAIN_GLSL = /* glsl */`
const vec2 LAKE_XZ = vec2(${f(LAKE.x)}, ${f(LAKE.z)});
const float LAKE_R = ${f(LAKE.r)};
const float WATER_LEVEL = ${f(WATER_LEVEL)};
const vec2 RUINS_XZ = vec2(${f(RUINS.x)}, ${f(RUINS.z)});
float terrainHeight(vec2 p){
  float h = sin(p.x*0.045)*cos(p.y*0.038)*1.6 + sin(p.x*0.012 + p.y*0.017)*3.0 + sin(p.y*0.07 + 1.3)*0.5;
  h *= smoothstep(10.0, 24.0, length(p));
  h = mix(h, 0.2, 1.0 - smoothstep(14.0, 22.0, length(p - RUINS_XZ)));
  float lake = 1.0 - smoothstep(LAKE_R*0.45, LAKE_R, length(p - LAKE_XZ));
  return mix(h, -3.0, lake);
}
float pathDist(vec2 p){
  float pz = sin(p.x*0.03)*14.0 + sin(p.x*0.011 + 1.0)*22.0 - sin(1.0)*22.0;
  return abs(p.y - pz);
}
float grassDensity(vec2 p){
  float d = smoothstep(1.3, 3.2, pathDist(p) + (vnoise(p*0.6) - 0.5)*1.4);
  d *= smoothstep(LAKE_R*0.63, LAKE_R*0.76, length(p - LAKE_XZ));
  d *= smoothstep(7.4, 8.8, length(p));
  d *= 0.55 + 0.45*smoothstep(0.25, 0.6, vnoise(p*0.05 + 3.0));
  return d;
}
`;
