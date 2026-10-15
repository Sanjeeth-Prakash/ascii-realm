// Glowing items lying around the world (like Elden Ring's item glints):
// Golden Seeds and Sacred Tears to grow the flask, Amber Moss to heal over
// time, Golden Runes to crush for runes. Each is picked up once per save.

import * as THREE from 'three';
import { terrainHeight } from './terrainMath.js';

const SPOTS = [
  // seeds: off the beaten path
  { id: 'seed_oak', item: 'golden_seed', n: 1, x: -24, z: 31 },
  { id: 'seed_keep', item: 'golden_seed', n: 1, x: -55, z: -27 },
  { id: 'seed_shore', item: 'golden_seed', n: 1, x: 31, z: -38 },
  // a single tear, guarded by the keep's warrior
  { id: 'tear_keep', item: 'sacred_tear', n: 1, x: -46, z: -21 },
  // moss near old stones
  { id: 'moss_shrine', item: 'amber_moss', n: 2, x: 9.8, z: 5.2 },
  { id: 'moss_path', item: 'amber_moss', n: 1, x: -30, z: 6 },
  { id: 'moss_grave', item: 'amber_moss', n: 2, x: -12, z: 23 },
  { id: 'moss_east', item: 'amber_moss', n: 1, x: 24, z: 12 },
  { id: 'moss_south', item: 'amber_moss', n: 2, x: 6, z: 40 },
  // runes
  { id: 'rune_grave', item: 'golden_rune', n: 1, x: -17, z: 27 },
  { id: 'rune_keep', item: 'golden_rune', n: 2, x: -40, z: -26 },
  { id: 'rune_lake', item: 'golden_rune', n: 1, x: 27, z: -4 },
  { id: 'rune_far', item: 'golden_rune', n: 1, x: 18, z: 38 },
];

const COLORS = {
  golden_seed: new THREE.Vector3(1.0, 0.8, 0.3),
  sacred_tear: new THREE.Vector3(0.6, 0.85, 1.0),
  amber_moss: new THREE.Vector3(1.0, 0.6, 0.25),
  golden_rune: new THREE.Vector3(1.0, 0.85, 0.45),
};

export class Pickups {
  constructor(torches) {
    this.torches = torches;
    this.list = SPOTS.map((s) => {
      const pos = new THREE.Vector3(s.x, terrainHeight(s.x, s.z) + 0.35, s.z);
      const light = torches.add({ x: pos.x, y: pos.y, z: pos.z, noFlame: true, radius: 2.6, intensity: 0.55, color: COLORS[s.item].clone() });
      return { ...s, pos, light, taken: false };
    });
    this.t = 0;
  }

  // which have been picked up in this save
  load(picked = []) {
    const set = new Set(picked);
    for (const p of this.list) { p.taken = set.has(p.id); p.light.on = !p.taken; }
  }

  nearest(pos, r = 1.7) {
    let best = null, bd = r;
    for (const p of this.list) {
      if (p.taken) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { best = p; bd = d; }
    }
    return best;
  }

  take(p) {
    p.taken = true;
    p.light.on = false;
    this.torches.burst(p.pos, 18, 0.7);
  }

  update(dt, focus) {
    this.t += dt;
    for (const p of this.list) {
      if (p.taken) continue;
      if (Math.abs(p.pos.x - focus.x) > 45 || Math.abs(p.pos.z - focus.z) > 45) continue;
      // a soft pulse and a rising mote now and then
      p.light.intensity = 0.45 + 0.2 * Math.sin(this.t * 2.6 + p.pos.x);
      if (Math.random() < dt * 2.5) this.torches.burst(p.pos, 1, 0.25);
    }
  }
}
