// Skeleton enemies (KayKit Skeletons pack, CC0, Kay Lousberg).
// They lie dormant in the grass and rise when you come near, then hunt you
// with readable, telegraphed attacks. Dodge through the swing, punish the
// recovery. They come back when you rest at the shrine.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MAT, applyModelMaterials } from '../render/lighting.js';
import { terrainHeight } from '../world/terrainMath.js';

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const KINDS = {
  minion: {
    name: 'Skeleton Minion', model: 'skelMinion', weapon: 'skelBlade', scale: 0.88,
    hp: 95, poise: 1, runes: 70, speed: 2.4, chase: 3.6, aggro: 11, leash: 34, turn: 4.2,
    attacks: [
      { clip: '1H_Melee_Attack_Chop', ts: 0.82, hit: [0.48, 0.6], reach: 1.9, arc: 1.1, dmg: 34, end: 0.92, lunge: [0.35, 0.55, 2.2], range: [0, 2.0] },
      { clip: '1H_Melee_Attack_Slice_Diagonal', ts: 0.9, hit: [0.33, 0.46], reach: 1.9, arc: 1.3, dmg: 28, end: 0.85, lunge: [0.2, 0.4, 2.4], range: [0, 2.0] },
    ],
  },
  warrior: {
    name: 'Skeleton Warrior', model: 'skelWarrior', weapon: 'skelAxe', scale: 1.0,
    hp: 210, poise: 3, runes: 240, speed: 2.1, chase: 3.2, aggro: 12, leash: 34, turn: 3.4,
    attacks: [
      { clip: '1H_Melee_Attack_Chop', ts: 0.72, hit: [0.48, 0.6], reach: 2.2, arc: 1.1, dmg: 58, end: 0.92, lunge: [0.35, 0.55, 2.4], range: [0, 2.3], heavy: true },
      { clip: '1H_Melee_Attack_Jump_Chop', ts: 0.85, hit: [0.48, 0.6], reach: 2.3, arc: 1.0, dmg: 70, end: 0.92, lunge: [0.15, 0.5, 7.5], range: [3.5, 6.5], heavy: true },
      { clip: '2H_Melee_Attack_Spin', ts: 1.0, hit: [0.36, 0.56], reach: 2.5, arc: 3.2, dmg: 46, end: 0.9, lunge: [0.3, 0.55, 1.2], range: [0, 2.2], heavy: true },
    ],
  },
};

class Skeleton {
  constructor(scene, shared, assets, kind, x, z, yaw) {
    this.kind = kind;
    this.def = KINDS[kind];
    this.home = { x, z, yaw };
    this.root = new THREE.Group();
    const model = cloneSkinned(assets[this.def.model].scene);
    model.scale.setScalar(this.def.scale);
    applyModelMaterials(model, shared, { id: MAT.CHAR, tint: [0.95, 0.93, 0.86], brightness: 1.15, rim: 0.9, wrap: 0.5 });
    // glowing eyes
    model.traverse((o) => {
      if (o.isMesh && /Eyes/.test(o.name)) o.material.uniforms.uEmissive.value = 2.5;
    });
    // skip drawing skeletons that are off screen (or out of the shadow map)
    model.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; const g = o.geometry; if (!g.userData.padded) { g.computeBoundingSphere(); g.boundingSphere.radius *= 1.6; g.userData.padded = true; } } });
    this.root.add(model);
    scene.add(this.root);
    this.model = model;
    // weapon in the right hand
    const w = assets[this.def.weapon].scene.clone(true);
    applyModelMaterials(w, shared, { id: MAT.CHAR, brightness: 1.1, rim: 0.8 });
    model.getObjectByName('handslotr').add(w);

    this.mixer = new THREE.AnimationMixer(model);
    this.clips = {};
    for (const c of assets[this.def.model].animations) this.clips[c.name] = c;
    this.loco = {
      idle: this.loop('Idle_Combat'),
      walk: this.loop('Walking_D_Skeletons'),
      run: this.loop('Running_C'),
    };
    this.lw = { idle: 1, walk: 0, run: 0 };
    this.oneshot = null;
    this.pos = new THREE.Vector3();
    this.reset();
  }

  loop(n) { const a = this.mixer.clipAction(this.clips[n]); a.play(); a.setEffectiveWeight(0); return a; }

  playOnce(name, ts = 1, fade = 0.12) {
    const a = this.mixer.clipAction(this.clips[name]);
    if (this.oneshot && this.oneshot !== a) this.oneshot.fadeOut(fade);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts;
    a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.oneshot = a;
    this.dur = this.clips[name].duration / ts;
    return a;
  }

  reset() {
    this.pos.set(this.home.x, terrainHeight(this.home.x, this.home.z), this.home.z);
    this.yaw = this.home.yaw;
    this.hp = this.def.hp;
    this.poiseDmg = 0;
    this.state = 'dormant';
    this.t = 0;
    this.cool = 0;
    this.speed = 0;
    this.shownHp = 1;
    this.lastHurt = -10;
    this.root.visible = true;
    this.mixer.stopAllAction();
    for (const k in this.loco) { this.loco[k].play(); this.loco[k].setEffectiveWeight(0); }
    this.oneshot = null;
    this.playOnce('Skeletons_Inactive_Floor_Pose', 1, 0.01);
    this.mixer.update(0.01);
    this.place();
  }

  get alive() { return this.state !== 'dead' && this.state !== 'gone'; }
  get awake() { return this.alive && this.state !== 'dormant' && this.state !== 'rising'; }
  get targetable() { return this.alive && this.state !== 'dormant'; }

  enter(s) { this.state = s; this.t = 0; this.hitPlayer = false; }

  update(dt, player, events) {
    this.t += dt;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toward = Math.atan2(dx, dz);
    let move = 0, moveYaw = this.yaw;

    switch (this.state) {
      case 'dormant':
        if (dist < this.def.aggro && player.alive) {
          this.enter('rising');
          this.playOnce('Skeletons_Awaken_Floor', 1.15, 0.1);
          events.push({ type: 'enemySound', name: 'skel_awake', pos: this.pos, vol: 0.9 });
        }
        break;
      case 'rising':
        if (this.t > this.dur * 0.95) { this.enter('chase'); this.fadeOut(); }
        break;
      case 'chase': {
        if (!player.alive || dist > this.def.leash) { this.enter('return'); break; }
        this.turnTo(toward, dt, this.def.turn);
        this.cool -= dt;
        // pick an attack whose range fits
        const atk = this.cool <= 0 && this.def.attacks.filter((a) => dist >= a.range[0] && dist <= a.range[1] + 0.2);
        if (atk && atk.length && Math.abs(angDiff(this.yaw, toward)) < 0.5) { this.attack(atk[Math.floor(Math.random() * atk.length)], events); break; }
        // keep a little distance while waiting to attack, otherwise close in
        const want = this.cool > 0 ? 2.4 : 1.4;
        if (dist > want) { move = dist > 6 ? this.def.chase : this.def.speed; moveYaw = toward; }
        else if (dist < 1.2) { move = -1.2; moveYaw = toward; }
        if (Math.random() < dt * 0.25) events.push({ type: 'enemySound', name: 'rattle', pos: this.pos, vol: 0.35 });
        break;
      }
      case 'attack': {
        const a = this.atk, f = this.t / this.dur;
        if (f < a.hit[0] - 0.1) this.turnTo(toward, dt, this.def.turn * 0.6);   // tracks you during the wind-up only
        if (f >= a.lunge[0] && f <= a.lunge[1]) { move = a.lunge[2] * Math.sin(Math.PI * (f - a.lunge[0]) / (a.lunge[1] - a.lunge[0])); moveYaw = this.yaw; }
        if (!this.swung && f >= a.hit[0] - 0.06) { this.swung = true; events.push({ type: 'enemySound', name: a.heavy ? 'swing_heavy' : 'swing', pos: this.pos, vol: 0.8 }); }
        this.hitActive = f >= a.hit[0] && f <= a.hit[1];
        if (f >= a.end) { this.hitActive = false; this.enter('chase'); this.fadeOut(0.25); this.cool = 0.9 + Math.random() * 1.2; }
        break;
      }
      case 'stagger':
        move = this.t < 0.2 ? -2.2 : 0; moveYaw = this.yaw;
        if (this.t > this.dur * 0.85) { this.enter('chase'); this.fadeOut(); this.cool = Math.max(this.cool, 0.4); }
        break;
      case 'return': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        const hd = Math.hypot(hx, hz);
        if (dist < this.def.aggro * 0.8 && player.alive) { this.enter('chase'); break; }
        if (hd < 0.6) { this.enter('chase'); this.hp = this.def.hp; this.state = 'idle'; break; }
        moveYaw = Math.atan2(hx, hz); this.turnTo(moveYaw, dt, this.def.turn); move = this.def.speed;
        this.hp = Math.min(this.def.hp, this.hp + this.def.hp * 0.25 * dt);
        break;
      }
      case 'idle':
        if (dist < this.def.aggro && player.alive) this.enter('chase');
        break;
      case 'dead':
        if (this.t > 5.0) { this.state = 'gone'; this.root.visible = false; }
        break;
      default: break;
    }

    // movement with simple collision against the world
    this.speed = damp(this.speed, move, 8, dt);
    if (Math.abs(this.speed) > 0.01) {
      this.pos.x += Math.sin(moveYaw) * this.speed * dt;
      this.pos.z += Math.cos(moveYaw) * this.speed * dt;
    }
    this.pos.y = damp(this.pos.y, terrainHeight(this.pos.x, this.pos.z), 14, dt);

    // locomotion blend
    const spd = (this.state === 'chase' || this.state === 'return') ? Math.abs(this.speed) : 0;
    const w = { idle: 1 - Math.min(1, spd), walk: 0, run: 0 };
    const runK = THREE.MathUtils.clamp((spd - 2.6) / 1.0, 0, 1);
    w.walk = Math.min(1, spd) * (1 - runK); w.run = Math.min(1, spd) * runK;
    const base = this.oneshot ? 0 : 1;
    for (const k in this.loco) { this.lw[k] = damp(this.lw[k], w[k], 8, dt); this.loco[k].setEffectiveWeight(this.lw[k] * base); }
    this.loco.walk.timeScale = THREE.MathUtils.clamp(spd / 1.4, 0.6, 2.0);
    this.loco.run.timeScale = THREE.MathUtils.clamp(spd / 3.0, 0.8, 1.6);
    this.mixer.update(dt);
    this.place();
  }

  fadeOut(f = 0.2) { if (this.oneshot) this.oneshot.fadeOut(f); this.oneshot = null; }

  turnTo(target, dt, rate) {
    this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, target), -rate * dt, rate * dt);
  }

  attack(a, events) {
    this.enter('attack');
    this.atk = a;
    this.swung = false;
    this.playOnce(a.clip, a.ts, 0.12);
  }

  // returns true if the hit killed it
  hurt(dmg, poise, fromYaw, events) {
    if (!this.alive || this.state === 'dormant') return false;
    this.hp -= dmg;
    this.lastHurt = performance.now() / 1000;
    if (this.state === 'rising') { /* can't be staggered while getting up */ }
    if (this.hp <= 0) {
      this.hp = 0;
      this.enter('dead');
      this.hitActive = false;
      this.playOnce('Death_C_Skeletons', 1.0, 0.06);
      events.push({ type: 'enemySound', name: 'skel_death', pos: this.pos, vol: 1 });
      return true;
    }
    this.poiseDmg += poise;
    // most hits stagger minions; warriors need a heavy or a few hits
    if (this.poiseDmg >= this.def.poise && this.state !== 'rising') {
      this.poiseDmg = 0;
      this.enter('stagger');
      this.hitActive = false;
      this.playOnce(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', 1.2, 0.05);
    }
    if (this.state === 'dormant' || this.state === 'idle' || this.state === 'return') this.enter('chase');
    return false;
  }

  place() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

export class Enemies {
  constructor(scene, shared, assets, colliders = []) {
    this.list = [];
    this.events = [];          // sounds etc. from this frame
    this.colliders = colliders;
    // a few pockets of the dead: the graveyard path, the keep, the lake shore
    const spawns = [
      ['minion', -14, 18, 2.4], ['minion', -18, 22, 0.5], ['minion', -10, 25, 3.8],
      ['minion', -40, -12, 1.2], ['warrior', -48, -18, 1.6], ['minion', -52, -26, 0.4], ['minion', -44, -28, 2.8],
      ['minion', 30, -14, 4.0], ['warrior', 38, -6, 3.0],
      ['minion', 16, 34, 5.0], ['minion', 22, 30, 1.0],
    ];
    for (const [k, x, z, yaw] of spawns) this.list.push(new Skeleton(scene, shared, assets, k, x, z, yaw));
  }

  update(dt, player) {
    const events = this.events;
    events.length = 0;
    for (const e of this.list) {
      // out of sight range: don't draw (saves draw calls and shadow passes)
      if (e.state !== 'gone') e.root.visible = Math.abs(e.pos.x - player.pos.x) < 55 && Math.abs(e.pos.z - player.pos.z) < 55;
      // far-away dormant skeletons don't need to think
      if (e.state === 'dormant' && (Math.abs(e.pos.x - player.pos.x) > 40 || Math.abs(e.pos.z - player.pos.z) > 40)) continue;
      if (e.state === 'gone') continue;
      e.update(dt, player, events);
    }
    // keep them from stacking on each other or the player
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.awake) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.awake) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 1e-3) { const p = (1.1 - d) / 2; a.pos.x -= dx / d * p; a.pos.z -= dz / d * p; b.pos.x += dx / d * p; b.pos.z += dz / d * p; }
      }
      const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 1e-3 && player.state !== 'dodge') { const p = 0.9 - d; a.pos.x -= dx / d * p; a.pos.z -= dz / d * p; }
      // walls, pillars and trees
      for (const c of this.colliders) {
        const cx = a.pos.x - c.x, cz = a.pos.z - c.z;
        if (Math.abs(cx) > c.r + 0.5 || Math.abs(cz) > c.r + 0.5) continue;
        const cd = Math.hypot(cx, cz), min = c.r + 0.4;
        if (cd < min && cd > 1e-4) { a.pos.x = c.x + cx / cd * min; a.pos.z = c.z + cz / cd * min; }
      }
      a.place();
    }
  }

  resetAll() { for (const e of this.list) e.reset(); }
}
