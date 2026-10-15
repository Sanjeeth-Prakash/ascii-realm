// Time of day, wind, rain and lightning. Everything blends smoothly between states.

import * as THREE from 'three';

const V = (r, g, b) => new THREE.Vector3(r, g, b);

export const TIMES = {
  night: { ambient: V(0.045, 0.055, 0.085), moon: V(0.22, 0.28, 0.40), fog: V(0.010, 0.012, 0.022), gain: 3.1, torch: 1.0, cloud: 0.55, mist: 0.7, dir: V(0.62, 0.68, 0.38) },
  dawn:  { ambient: V(0.11, 0.08, 0.10), moon: V(0.55, 0.32, 0.24), fog: V(0.10, 0.06, 0.07), gain: 2.6, torch: 0.65, cloud: 0.45, mist: 1.0, dir: V(0.8, 0.35, -0.3) },
  day:   { ambient: V(0.30, 0.34, 0.40), moon: V(0.95, 0.90, 0.80), fog: V(0.32, 0.38, 0.45), gain: 2.3, torch: 0.25, cloud: 0.65, mist: 0.1, dir: V(0.6, 0.72, 0.25) },
  dusk:  { ambient: V(0.09, 0.06, 0.10), moon: V(0.60, 0.28, 0.20), fog: V(0.08, 0.04, 0.07), gain: 2.7, torch: 0.7, cloud: 0.5, mist: 0.5, dir: V(-0.8, 0.3, -0.3) },
};
export const TIME_ORDER = ['night', 'dawn', 'day', 'dusk'];

export class Weather {
  constructor(shared) {
    this.shared = shared;
    this.timeName = 'night';
    this.rainTarget = 0;
    this.rain = 0;
    this.flash = 0;
    this.nextBolt = 6;
    this.cur = { ...TIMES.night, ambient: TIMES.night.ambient.clone(), moon: TIMES.night.moon.clone(), fog: TIMES.night.fog.clone(), dir: TIMES.night.dir.clone().normalize() };
    this.time = 0;
  }

  // jump straight to a time of day (no fade)
  setTime(name) {
    if (!TIMES[name]) return;
    this.timeName = name;
    const T = TIMES[name];
    this.cur = { ...T, ambient: T.ambient.clone(), moon: T.moon.clone(), fog: T.fog.clone(), dir: T.dir.clone().normalize() };
  }

  cycleTime() {
    const i = TIME_ORDER.indexOf(this.timeName);
    this.timeName = TIME_ORDER[(i + 1) % TIME_ORDER.length];
    return this.timeName;
  }

  toggleRain() { this.rainTarget = this.rainTarget > 0.5 ? 0 : 1; return this.rainTarget > 0.5; }

  update(dt) {
    this.time += dt;
    const k = Math.min(1, dt * 1.2);
    const T = TIMES[this.timeName], c = this.cur;
    c.ambient.lerp(T.ambient, k); c.moon.lerp(T.moon, k); c.fog.lerp(T.fog, k);
    c.dir.lerp(T.dir.clone().normalize(), k).normalize();
    c.gain += (T.gain - c.gain) * k; c.torch += (T.torch - c.torch) * k;
    c.cloud += (T.cloud - c.cloud) * k; c.mist += (T.mist - c.mist) * k;

    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.6);

    // lightning during storms: a quick double flicker
    if (this.rain > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt < 0) {
        this.flash = 1;
        this.secondFlash = 0.12 + Math.random() * 0.1;
        this.nextBolt = 5 + Math.random() * 10;
      }
    }
    if (this.secondFlash !== undefined) {
      this.secondFlash -= dt;
      if (this.secondFlash < 0) { this.flash = Math.max(this.flash, 0.7); this.secondFlash = undefined; }
    }
    this.flash *= Math.exp(-dt * 9);

    const sh = this.shared;
    const dim = 1 - this.rain * 0.35;
    sh.uAmbient.value.copy(c.ambient).multiplyScalar(dim);
    sh.uMoonColor.value.copy(c.moon).multiplyScalar(dim);
    sh.uFogColor.value.copy(c.fog).multiplyScalar(dim);
    sh.uMoonDir.value.copy(c.dir);
    sh.uRain.value = this.rain;
    sh.uFlash.value = this.flash;
    sh.uCloud.value = Math.min(1, c.cloud + this.rain * 0.4);
    sh.uMist.value = c.mist + this.rain * 0.3;
    this.night = THREE.MathUtils.clamp((c.torch - 0.3) / 0.7, 0, 1);

    // wind: gentle breeze, stronger and gustier in rain; slowly veers
    const veer = Math.sin(this.time * 0.05) * 0.35;
    sh.uWindDir.value.set(Math.cos(0.4 + veer), Math.sin(0.4 + veer));
    // slow, irregular gusts: the grass leans harder and the wind sound swells together
    const t = this.time, g = 0.5 * Math.sin(t * 0.13) + 0.3 * Math.sin(t * 0.31 + 1.7) + 0.2 * Math.sin(t * 0.71 + 4.1);
    this.gust = Math.max(0, g) ** 2;
    sh.uWindStrength.value = 0.48 + this.gust * 0.45 + this.rain * 0.55;
  }
}
