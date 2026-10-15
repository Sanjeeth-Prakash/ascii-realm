// The title-screen "film": a loop of staged shots played live in the engine.
// Each shot places the hero, sets the weather and drives the camera; the
// screen fades through black between shots.

import * as THREE from 'three';
import { terrainHeight, pathZ, LAKE, RUINS } from '../world/terrainMath.js';

const FADE = 0.9;
const ease = (t) => t * t * (3 - 2 * t);

const SHOTS = [
  {
    name: 'path',
    dur: 11,
    time: 'night', rain: false,
    start: { x: -36, z: pathZ(-36) },
    yaw: Math.PI / 2,
    walk: (p) => { const dz = pathZ(p.x + 0.5) - pathZ(p.x - 0.5); const l = Math.hypot(1, dz); return { x: 1 / l, z: dz / l }; },
    cam(t, p, out, look) {
      // tracking shot alongside the hero, slowly drifting ahead of him
      look.set(p.x + 1.5, p.y + 1.1, p.z);
      out.set(p.x + 4 + t * 0.25, p.y + 5.5, p.z + 10.5 - t * 0.2);
    },
  },
  {
    name: 'shrine',
    dur: 11,
    time: 'night', rain: false,
    start: { x: 0, z: -0.95 },
    yaw: Math.PI,
    cam(t, p, out, look) {
      // slow orbit around the shrine and its braziers
      const a = 0.6 + t * 0.075;
      look.set(0, 1.0, -1.2);
      out.set(Math.sin(a) * 14, 8.5 - t * 0.15, Math.cos(a) * 14 - 1.2);
    },
  },
  {
    name: 'mere',
    dur: 11,
    time: 'dawn', rain: false,
    start: { x: LAKE.x - LAKE.r * 0.86, z: LAKE.z + 5 },
    yaw: Math.PI / 2 + 0.25,
    cam(t, p, out, look) {
      // low over the hero's shoulder, gliding toward the misty water
      look.set(LAKE.x - 2 + t * 0.4, 1.5, LAKE.z + 2);
      out.set(p.x - 9 + t * 0.55, p.y + 5.2 - t * 0.08, p.z + 6.5 - t * 0.15);
    },
  },
  {
    name: 'keep',
    dur: 12,
    time: 'night', rain: true,
    start: { x: RUINS.x - 3, z: RUINS.z + 2.4 },
    yaw: Math.PI / 2,
    walk: () => ({ x: 1, z: -0.03 }),
    walkFrom: 1.5,
    cam(t, p, out, look) {
      // outside the gate in the storm, pushing in as the hero walks out
      look.set(p.x + 1.0, p.y + 1.4, p.z);
      out.set(RUINS.x + 22 - t * 0.55, 8.5 - t * 0.12, RUINS.z + 13 - t * 0.35);
    },
  },
];

export class Cinematic {
  constructor({ player, weather, camera, fadeEl, cobwebs }) {
    this.player = player;
    this.weather = weather;
    this.camera = camera;
    this.fadeEl = fadeEl;
    this.cobwebs = cobwebs;
    this.i = -1;
    this.t = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.ctl = { x: 0, z: 0, run: false, toggleTorch: false };
  }

  start() {
    this.i = -1;
    this.next();
  }

  next() {
    this.i = (this.i + 1) % SHOTS.length;
    this.t = 0;
    const s = SHOTS[this.i];
    const p = this.player;
    p.pos.set(s.start.x, terrainHeight(s.start.x, s.start.z), s.start.z);
    p.vel.set(0, 0, 0);
    p.yaw = s.yaw;
    p.torchOn = true;
    p.canRun = true;
    this.weather.setTime(s.time);
    this.weather.rainTarget = s.rain ? 1 : 0;
    this.weather.rain = s.rain ? 1 : 0;
    this.cobwebs?.resetAll();
  }

  // Returns the camera target (used to place grass, shadows, fireflies).
  update(dt) {
    this.t += dt;
    const s = SHOTS[this.i];
    if (this.t >= s.dur) this.next();
    const shot = SHOTS[this.i];
    const p = this.player;

    const c = this.ctl;
    c.toggleTorch = false;
    if (shot.walk && this.t > (shot.walkFrom || 0)) {
      const d = shot.walk(p.pos);
      c.x = d.x; c.z = d.z;
    } else { c.x = 0; c.z = 0; }

    shot.cam(this.t, p.pos, this.camPos, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();

    // fade through black at the cuts
    const a = Math.max(1 - ease(Math.min(1, this.t / FADE)), ease(Math.max(0, (this.t - (shot.dur - FADE)) / FADE)));
    this.fadeEl.style.opacity = a.toFixed(3);
    return this.camLook;
  }

  stop() { this.fadeEl.style.opacity = 0; }
}
