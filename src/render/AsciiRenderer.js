// Frame pipeline
//   1. 3D scene -> small offscreen buffer (colour + material ID + depth)
//   2. one texel per character cell: average colour + chosen glyph
//   3. glyph image drawn at full resolution, then the "glyph art" layer on top:
//      free-floating grass strokes, web threads, glowing motes. These are drawn
//      crisp (not snapped to the grid) and hidden behind characters and walls
//      using the depth from step 1.
//   4. post: torch halos, rain, lightning, vignette, then the colour scheme.

import * as THREE from 'three';

// Glyph sets, sparse -> dense. Index = material ID (see MAT in lighting.js).
export const GLYPH_SETS = [
  " .,:;=+*#",        // 0 ground / dirt
  " .,'`;:!|/\\",      // 1 grass blades
  " .:-o0O8&@",        // 2 leaves / canopy clumps
  " .:-=+*#%@",        // 3 stone / bark
  " .:-=+*#%@",        // 4 characters
  " .*+xX#@",          // 5 fire / embers
  " .-~=+oO0@",        // 6 water
  " .'`-:+*#",         // 7 cobwebs (fine threads)
];

// Glyphs used by the free-floating glyph-art layer (one row, drawn upright).
export const STROKE_GLYPHS = ['|', 'l', '!', 'i', ';', ':', 'j', 'f', '*', 'o', '+', '.', "'", ','];
export const strokeIndex = (ch) => STROKE_GLYPHS.indexOf(ch);

const MAX_GLOWS = 16;
const GLYPH_W = 32, GLYPH_H = 48, ATLAS_COLS = 16;

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = GLYPH_W * ATLAS_COLS;
  c.height = GLYPH_H * GLYPH_SETS.length;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 40px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace';
  GLYPH_SETS.forEach((set, row) => {
    [...set].forEach((ch, col) => {
      g.fillText(ch, col * GLYPH_W + GLYPH_W / 2, row * GLYPH_H + GLYPH_H / 2 + 2);
    });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function buildStrokeAtlas() {
  const W = 48, H = 80;
  const c = document.createElement('canvas');
  c.width = W * STROKE_GLYPHS.length; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '64px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace';
  STROKE_GLYPHS.forEach((ch, i) => g.fillText(ch, i * W + W / 2, H / 2 + 4));
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Shared GLSL for glyph-art materials: depth test against the 3D scene, and the
// same brightness curve the grid uses so both layers match.
export const OVERLAY_GLSL = /* glsl */`
uniform sampler2D tBaseDepth;
uniform vec2 uGridPx;
uniform vec2 uCellSize;
uniform float uGain;
uniform sampler2D tStrokes;
uniform float uStrokeCount;
#ifndef OVERLAY_VERTEX
bool hiddenByScene(float bias){
  float sd = texture2D(tBaseDepth, gl_FragCoord.xy/uGridPx).r;
  return gl_FragCoord.z > sd + bias;
}
#endif
// linear scene colour -> displayed glyph colour (matches the grid glyphs)
vec4 toneGlyph(vec3 col){
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float v = 1.0 - exp(-lum*uGain*1.5);
  vec3 hue = col/max(max(col.r, max(col.g, col.b)), 1e-4);
  hue = mix(vec3(dot(hue, vec3(0.33))), hue, 0.75);         // a touch less saturated
  return vec4(hue*(0.05 + 1.05*v), smoothstep(0.004, 0.05, lum*uGain));
}
float strokeAlpha(vec2 uv, float glyph){
  return texture2D(tStrokes, vec2((glyph + clamp(uv.x, 0.02, 0.98))/uStrokeCount, uv.y)).r;
}
`;

export const PALETTES = [
  // id, label, mode (0 = full colour, 1 = ramp), colours (dark -> light)
  { id: 'full', label: 'Full colour', colors: [] },
  { id: 'ibm8503', label: 'IBM 8503', colors: ['#2e3037', '#ebe5ce'] },
  { id: 'mac', label: 'Macintosh', colors: ['#333319', '#e5ffff'] },
  { id: 'zenith', label: 'Zenith amber', colors: ['#3f291e', '#fdca55'] },
  { id: 'c1084', label: 'Commodore', colors: ['#40318e', '#88d7de'] },
  { id: 'ibm5151', label: 'IBM 5151 green', colors: ['#25342f', '#01eb5f'] },
  { id: 'phosphor', label: 'Phosphor', colors: ['#040d06', '#0f3b1a', '#23a043', '#8affa8'] },
  { id: 'amber', label: 'Amber terminal', colors: ['#0d0702', '#4a2606', '#c0700e', '#ffd27a'] },
  { id: 'dmg', label: 'Pocket green', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { id: 'bone', label: 'Ink & bone', colors: ['#0b0a0a', '#f1e9d2'] },
];

const hexToVec = (h) => new THREE.Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

export class AsciiRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.cellCss = 7;          // glyph width in CSS px; height = width * 1.55
    this.glows = [];           // [{x, y (buffer px), r (px), intensity, color: Vector3}]
    this.quality = 3;          // scene samples per cell edge (2..4); auto-tuned by the game

    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType),
    });
    this.rt.depthTexture.minFilter = THREE.NearestFilter;
    this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.cellRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    });
    this.screenRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    });

    const setLen = GLYPH_SETS.map((s) => [...s].length);
    while (setLen.length < 8) setLen.push(10);

    // uniforms shared with every glyph-art material
    this.overlayUniforms = {
      tBaseDepth: { value: this.rt.depthTexture },
      uGridPx: { value: new THREE.Vector2(1, 1) },
      uCellSize: { value: new THREE.Vector2(7, 11) },
      uGain: { value: 2.4 },
      tStrokes: { value: buildStrokeAtlas() },
      uStrokeCount: { value: STROKE_GLYPHS.length },
    };

    this.uniforms = {
      tScene: { value: this.rt.texture },
      tCells: { value: this.cellRT.texture },
      tScreen: { value: this.screenRT.texture },
      tAtlas: { value: buildAtlas() },
      uCellPx: { value: new THREE.Vector2(7, 11) },
      uGrid: { value: new THREE.Vector2(1, 1) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNumSets: { value: GLYPH_SETS.length },
      uSetLen: { value: setLen },
      uGain: this.overlayUniforms.uGain,
      uTime: { value: 0 },
      uRain: { value: 0 },
      uFlash: { value: 0 },
      uSlant: { value: 0.22 },
      uDpr: { value: 1 },
      uGlow: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4()) },
      uGlowCol: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
      uGlowCount: { value: 0 },
      uPalMode: { value: 0 },
      uPalN: { value: 2 },
      uPal: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    };

    const HASH = `float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }`;
    const quad = (fragmentShader) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: this.uniforms, depthTest: false, depthWrite: false,
        vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader,
      }));
      m.frustumCulled = false;
      const sc = new THREE.Scene(); sc.add(m);
      return sc;
    };

    // ---- pass 2: per cell -> average colour, glyph set, glyph index ----
    this.cellScene = quad(/* glsl */`
      uniform sampler2D tScene; uniform vec2 uGrid; uniform float uNumSets; uniform float uSetLen[8]; uniform float uGain;
      ${HASH}
      float setLen(float s){ for (int i = 0; i < 8; i++){ if (float(i) == s) return uSetLen[i]; } return 10.0; }
      void main(){
        vec2 cell = floor(gl_FragCoord.xy);
        vec3 acc = vec3(0.0); vec3 accC = vec3(0.0); float nC = 0.0;
        float best = -1.0; float id = 0.0;
        for (int j = 0; j < 4; j++){
          for (int i = 0; i < 4; i++){
            vec2 o = (vec2(float(i), float(j)) + 0.5)*0.25;
            vec4 s = texture2D(tScene, (cell + o)/uGrid);
            acc += s.rgb;
            float sid = floor(s.a*8.0);
            if (sid == 4.0){ accC += s.rgb; nC += 1.0; }
            float w = dot(s.rgb, vec3(0.3, 0.59, 0.11)) + ((sid == 4.0 || sid == 5.0) ? 0.35 : 0.0);
            if (w > best){ best = w; id = sid; }
          }
        }
        vec3 col = acc/16.0;
        if (nC >= 3.0){ col = accC/nC; id = 4.0; }   // keep characters crisp against the ground
        float lum = dot(col, vec3(0.3, 0.59, 0.11));
        id = clamp(id, 0.0, uNumSets - 1.0);
        float len = setLen(id);
        float dv = 1.0 - exp(-lum*uGain*3.6);         // glyph density
        float idx = clamp(floor(dv*len + (hash12(cell + id*17.0) - 0.5)*0.8), 0.0, len - 1.0);
        if (lum*uGain < 0.006) idx = 0.0;
        gl_FragColor = vec4(col, id*16.0 + idx);
      }`);

    // ---- pass 3a: glyph image ----
    this.composeScene = quad(/* glsl */`
      uniform sampler2D tCells; uniform sampler2D tAtlas;
      uniform vec2 uCellPx; uniform vec2 uGrid; uniform float uNumSets; uniform float uGain;
      void main(){
        vec2 cf = gl_FragCoord.xy/uCellPx;
        vec2 cell = floor(cf);
        vec2 cuv = fract(cf);
        vec4 c = texture2D(tCells, (cell + 0.5)/uGrid);
        vec3 col = c.rgb;
        float id = floor(c.a/16.0 + 0.01);
        float idx = floor(c.a - id*16.0 + 0.5);
        float lum = dot(col, vec3(0.3, 0.59, 0.11));
        float v = 1.0 - exp(-lum*uGain*1.7);
        vec2 auv = vec2((idx + cuv.x)/16.0, 1.0 - (id + 1.0 - cuv.y)/uNumSets);
        float g = texture2D(tAtlas, auv).r;
        vec3 hue = col/max(max(col.r, max(col.g, col.b)), 1e-4);
        vec3 gcol = hue*(0.12 + 1.75*v)*(id == 4.0 ? 1.3 : 1.0);
        gl_FragColor = vec4(gcol*g + col*uGain*0.24, 1.0);
      }`);

    // ---- pass 4: post ----
    this.postScene = quad(/* glsl */`
      uniform sampler2D tScreen; uniform vec2 uRes; uniform vec2 uGrid; uniform vec2 uCellPx;
      uniform float uTime; uniform float uRain; uniform float uFlash; uniform float uSlant; uniform float uDpr;
      uniform vec4 uGlow[${MAX_GLOWS}]; uniform vec3 uGlowCol[${MAX_GLOWS}]; uniform int uGlowCount;
      uniform float uPalMode; uniform float uPalN; uniform vec3 uPal[8];
      ${HASH}
      float rainLayer(vec2 p, float laneW, float speed, float len, float seed){
        p.x += p.y*uSlant;
        float lane = floor(p.x/laneW);
        float r = hash12(vec2(lane, seed));
        float yy = p.y + uTime*speed*(0.8 + 0.4*r) + r*997.0;
        float per = 240.0 + r*320.0;
        float k = floor(yy/per);
        float on = step(0.5, hash12(vec2(lane + 0.37, k + seed*3.1)));
        float y = mod(yy, per);
        float s = smoothstep(0.0, len*0.25, y)*(1.0 - smoothstep(len*0.25, len, y));
        float xc = (fract(p.x/laneW) - 0.5 - (r - 0.5)*0.5)*laneW;
        float line = 1.0 - smoothstep(0.3, 1.0, abs(xc));
        return line*s*on;
      }
      float bayer4(vec2 p){
        vec2 q = mod(floor(p), 4.0);
        float a = mod(q.x + q.y*2.0, 4.0);
        float m[16];
        m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
        m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
        int i = int(q.y*4.0 + q.x);
        float v = 0.0;
        for (int k = 0; k < 16; k++){ if (k == i) v = m[k]; }
        return (v + 0.5)/16.0;
      }
      vec3 palAt(float i){
        vec3 c = uPal[0];
        for (int k = 1; k < 8; k++){ if (float(k) <= i) c = uPal[k]; }
        return c;
      }
      void main(){
        vec2 fc = gl_FragCoord.xy;
        vec3 c = texture2D(tScreen, fc/uRes).rgb;
        for (int i = 0; i < ${MAX_GLOWS}; i++){
          if (i >= uGlowCount) break;
          vec2 d2 = fc - uGlow[i].xy;
          float r = uGlow[i].z;
          float dd = dot(d2, d2);
          if (dd > r*r*9.0) continue;
          c += uGlowCol[i]*(exp(-dd/(r*r))*0.8 + exp(-dd/(r*r*0.06))*0.6)*uGlow[i].w;
        }
        if (uRain > 0.01){
          vec2 p = fc/uDpr;
          float rn = rainLayer(p, 11.0, 1100.0, 34.0, 1.0) + rainLayer(p + 31.0, 17.0, 1500.0, 52.0, 2.0)*0.8;
          c = c*(1.0 - 0.12*uRain) + vec3(0.55, 0.62, 0.72)*rn*0.32*uRain;
        }
        c += vec3(0.55, 0.6, 0.75)*uFlash*0.22;
        vec2 q = fc/uRes - 0.5;
        c *= 1.0 - 0.5*pow(clamp(length(q)*1.35, 0.0, 1.0), 2.2);
        if (uPalMode > 0.5){
          // colour scheme: brightness -> palette steps, with a fine ordered dither
          float l = clamp(dot(c, vec3(0.3, 0.59, 0.11))*1.25, 0.0, 1.0);
          l = pow(l, 0.75);
          float steps = uPalN - 1.0;
          float x = l*steps + (bayer4(fc/max(uDpr, 1.0)) - 0.5)*0.9;
          c = palAt(clamp(floor(x + 0.5), 0.0, steps));
        }
        gl_FragColor = vec4(c, 1.0);
      }`);
    this.finalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.palette = 'full';
    this.resize();
  }

  setPalette(id) {
    const p = PALETTES.find((x) => x.id === id) || PALETTES[0];
    this.palette = p.id;
    const u = this.uniforms;
    u.uPalMode.value = p.colors.length ? 1 : 0;
    u.uPalN.value = Math.max(2, p.colors.length);
    p.colors.forEach((h, i) => u.uPal.value[i].copy(hexToVec(h)));
    return p;
  }

  // Scene samples per cell edge: 4 = sharpest, 2 = fastest.
  setQuality(q) {
    q = Math.max(2, Math.min(4, q));
    if (q === this.quality) return false;
    this.quality = q;
    this.resize();
    return true;
  }

  setCellSize(px) {
    this.cellCss = Math.max(4, Math.min(16, px));
    this.resize();
  }

  // Call on window resize. Returns the aspect the scene camera must use.
  resize() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const dpr = r.getPixelRatio();
    const cw = this.cellCss * dpr;
    const ch = Math.round(this.cellCss * 1.55) * dpr;
    this.cols = Math.ceil(size.x / cw);
    this.rows = Math.ceil(size.y / ch);
    this.gridPx = new THREE.Vector2(this.cols * cw, this.rows * ch);
    const ssx = this.quality, ssy = Math.max(this.quality, Math.round(this.quality * ch / cw));
    this.rt.setSize(this.cols * ssx, this.rows * ssy);
    this.cellRT.setSize(this.cols, this.rows);
    this.screenRT.setSize(size.x, size.y);
    // the glyph layer uses the full grid area so its projection matches the scene's
    this.screenRT.viewport.set(0, 0, this.gridPx.x, this.gridPx.y);
    const u = this.uniforms;
    u.uCellPx.value.set(cw, ch);
    u.uGrid.value.set(this.cols, this.rows);
    u.uRes.value.copy(size);
    u.uDpr.value = dpr;
    this.overlayUniforms.uGridPx.value.copy(this.gridPx);
    this.overlayUniforms.uCellSize.value.set(cw, ch);
    this.aspect = this.gridPx.x / this.gridPx.y;
    this.rtHeight = this.rows * ssy;
    this.dpr = dpr;
    return this.aspect;
  }

  // Project a world point to buffer pixels (same space as gl_FragCoord in the final pass).
  project(v, camera, out) {
    const p = v.clone().project(camera);
    out.x = (p.x * 0.5 + 0.5) * this.gridPx.x;
    out.y = (p.y * 0.5 + 0.5) * this.gridPx.y;
    out.z = p.z;
    return out;
  }

  render(scene, camera, overlay) {
    const r = this.renderer;
    const u = this.uniforms;
    const n = Math.min(this.glows.length, MAX_GLOWS);
    for (let i = 0; i < n; i++) {
      const g = this.glows[i];
      u.uGlow.value[i].set(g.x, g.y, g.r, g.intensity);
      u.uGlowCol.value[i].copy(g.color);
    }
    u.uGlowCount.value = n;

    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(scene, camera);
    r.setRenderTarget(this.cellRT);
    r.render(this.cellScene, this.finalCam);
    r.setRenderTarget(this.screenRT);
    r.render(this.composeScene, this.finalCam);
    if (overlay) r.render(overlay, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.finalCam);
  }
}
