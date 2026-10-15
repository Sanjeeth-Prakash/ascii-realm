// Live glyph portrait of the hero for the status panel. A small offscreen
// camera renders a copy of the real 3D hero (same gear, idling), and each pixel block becomes one colored character.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const COLS = 30, ROWS = 26;          // characters
const SX = 2, SY = 3;                // render pixels per character
const RAMP = ' .,:;-=+*%#@';

export class Portrait {
  constructor(renderer, gltf, canvas, { cw = 5, ch = 7 } = {}) {
    this.renderer = renderer;
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.cw = cw; this.ch = ch;        // CSS px per character
    canvas.width = COLS * this.cw * dpr;
    canvas.height = ROWS * this.ch * dpr;
    canvas.style.width = `${COLS * this.cw}px`;
    canvas.style.height = `${ROWS * this.ch}px`;
    this.g = canvas.getContext('2d');
    this.g.scale(dpr, dpr);
    this.g.font = `bold ${this.ch + 1}px "DejaVu Sans Mono", Consolas, monospace`;
    this.g.textBaseline = 'top';

    this.rt = new THREE.WebGLRenderTarget(COLS * SX, ROWS * SY, { depthBuffer: true });
    this.px = new Uint8Array(COLS * SX * ROWS * SY * 4);

    // little studio: cold key light, warm torch fill from the side, rim from behind
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x111108, 1.1));
    const key = new THREE.DirectionalLight(0xd8e0ff, 2.6); key.position.set(-2, 3, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x99aaff, 2.2); rim.position.set(1, 2, -3); this.scene.add(rim);
    this.torchLight = new THREE.PointLight(0xff9a40, 6, 4, 1.5); this.torchLight.position.set(0.7, 1.9, 0.5); this.scene.add(this.torchLight);

    this.model = cloneSkinned(gltf.scene);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      o.material = new THREE.MeshLambertMaterial({ map: src.map || null, color: src.color || 0xffffff });
      o.frustumCulled = false;
    });
    this.scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const idle = gltf.animations.find((a) => a.name === 'Idle');
    if (idle) this.mixer.clipAction(idle).play();
    this.parts = {};
    this.model.traverse((o) => { if (o.isMesh) this.parts[o.name] = o; });

    // aspect of the on-screen glyph block (not of the tiny render target)
    this.camera = new THREE.PerspectiveCamera(30, (COLS * this.cw) / (ROWS * this.ch), 0.1, 20);
    // full figure, three-quarter view, like an equipment screen
    this.camera.position.set(1.4, 1.35, 4.6);
    this.camera.lookAt(-0.05, 0.95, 0);
    this.model.rotation.y = 0.5 + Math.PI; // three-quarter view (the model faces -z)
    this.timer = 0;
  }

  // a calm idle; shows the same gear as the hero
  update(dt, player) {
    this.timer += dt;
    for (const n in this.parts) if (player.parts[n]) this.parts[n].visible = player.parts[n].visible;
    this.mixer.update(dt);
    this.torchLight.intensity = player.torchOn ? 5 + Math.sin(this.timer * 23) * 0.6 + Math.sin(this.timer * 9) * 0.8 : 0;
    if (this.timer < 1 / 15) return;   // the glyph image updates 15 times a second
    this.timer = 0;
    this.draw();
  }

  draw() {
    if (this.reading) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    // tiny image (60x78 px), only read while the inventory is open
    r.readRenderTargetPixels(this.rt, 0, 0, COLS * SX, ROWS * SY, this.px);
    this.paint();
  }

  paint() {
    const g = this.g, W = COLS * SX;
    g.clearRect(0, 0, COLS * this.cw, ROWS * this.ch);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let R = 0, G = 0, B = 0, A = 0;
        for (let j = 0; j < SY; j++) {
          for (let i = 0; i < SX; i++) {
            const k = (((ROWS - 1 - y) * SY + (SY - 1 - j)) * W + x * SX + i) * 4;
            R += this.px[k]; G += this.px[k + 1]; B += this.px[k + 2]; A += this.px[k + 3];
          }
        }
        const n = SX * SY;
        if (A / n < 40) continue;
        R /= n; G /= n; B /= n;
        const lum = (0.3 * R + 0.59 * G + 0.11 * B) / 255;
        const ch = RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(Math.pow(lum, 0.7) * (RAMP.length - 1)))];
        if (this.palette) {
          // follow the colour scheme: brightness picks a palette step (never the background)
          const n = this.palette.length;
          g.fillStyle = this.palette[Math.max(1, Math.min(n - 1, Math.round(Math.pow(lum, 0.6) * (n - 1) + 0.3)))];
        } else {
          const m = Math.max(R, G, B, 1);
          const boost = 0.45 + 1.1 * Math.pow(lum, 0.6);
          g.fillStyle = `rgb(${Math.min(255, R / m * 255 * boost) | 0},${Math.min(255, G / m * 255 * boost) | 0},${Math.min(255, B / m * 255 * boost) | 0})`;
        }
        g.fillText(ch, x * this.cw, y * this.ch);
      }
    }
  }
}
