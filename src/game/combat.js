// Combat: who hits whom, lock-on, hit feel (hitstop, shake, sparks), enemy
// health bars with souls-style stacked damage numbers.

import * as THREE from 'three';

const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const WEAPON_DMG = { sword: 28, unarmed: 14 };   // base damage, scaled by each attack
const ENEMY_R = 0.45;                             // body radius used for reach checks
const LOCK_RANGE = 20, LOCK_BREAK = 26;

export class Combat {
  constructor({ player, enemies, torches, audio, camera, hooks }) {
    this.player = player;
    this.enemies = enemies;
    this.torches = torches;
    this.audio = audio;
    this.camera = camera;
    this.hooks = hooks;          // { onPlayerHit(dmg), onKill(enemy) }
    this.hitstop = 0;
    this.shake = 0;
    this.bars = new Map();
    this.layer = document.getElementById('foes');
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.textContent = '◈';
    this.layer.append(this.reticle);
    this.v = new THREE.Vector3();
    const $ = (id) => document.getElementById(id);
    this.boss = { el: $('boss'), name: $('bossname'), dmg: $('bossdmg'), fill: $('bossfill'), trail: $('bosstrail'), who: null, tr: 1 };
  }

  // strong foes (warriors) get the big bar at the bottom while you fight them
  pickBoss() {
    const t = this.player.lockTarget;
    if (t && t.kind === 'warrior' && t.alive) return t;
    const B = this.boss.who;
    if (B && B.alive && B.awake && B.pos.distanceTo(this.player.pos) < 24) return B;
    let best = null, bd = 16;
    for (const e of this.enemies.list) {
      if (e.kind !== 'warrior' || !e.awake || e.state === 'return') continue;
      const d = e.pos.distanceTo(this.player.pos);
      if (d < bd) { best = e; bd = d; }
    }
    return best;
  }

  // ---------- lock-on ----------
  toggleLock(camYaw) {
    if (this.player.lockTarget) { this.player.lockTarget = null; return null; }
    const t = this.pickTarget(camYaw);
    this.player.lockTarget = t;
    return t;
  }

  // nearest enemy in front of the camera; `side` (-1/1) picks the next one over
  pickTarget(camYaw, side = 0) {
    const p = this.player.pos;
    const fwd = camYaw + Math.PI;      // camera looks along -(sin yaw, cos yaw)
    let best = null, bestScore = Infinity;
    const cur = this.player.lockTarget;
    const curA = cur ? angDiff(fwd, Math.atan2(cur.pos.x - p.x, cur.pos.z - p.z)) : 0;
    for (const e of this.enemies.list) {
      if (!e.targetable || e === cur) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > LOCK_RANGE) continue;
      const a = angDiff(fwd, Math.atan2(dx, dz));
      if (side) {
        // switching: only enemies on that side of the current one
        const rel = angDiff(curA, a);
        if (Math.sign(-rel) !== side) continue;
        const score = Math.abs(rel) * 10 + d * 0.1;
        if (score < bestScore) { best = e; bestScore = score; }
      } else {
        // prefer what's on screen; something right behind you only if it's close
        if (Math.abs(a) > 1.4 && d > 9) continue;
        const score = d + Math.abs(a) * 9;
        if (score < bestScore) { best = e; bestScore = score; }
      }
    }
    return best;
  }

  switchTarget(camYaw, side) {
    const t = this.pickTarget(camYaw, side);
    if (t) this.player.lockTarget = t;
  }

  // ---------- per-frame ----------
  update(dt) {
    const P = this.player;
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.shake *= Math.exp(-dt * 9);
    if (P.lockTarget && (!P.lockTarget.targetable || P.lockTarget.pos.distanceTo(P.pos) > LOCK_BREAK)) P.lockTarget = null;

    // the hero's swing
    if (P.hitActive && P.atk) {
      const a = P.atk;
      for (const e of this.enemies.list) {
        if (!e.targetable || P.hitDone.has(e)) continue;
        const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > a.reach + ENEMY_R) continue;
        const off = Math.abs(angDiff(P.yaw, Math.atan2(dx, dz)));
        if (d > 0.8 && off > a.arc / 2 + Math.atan2(ENEMY_R, d)) continue;
        P.hitDone.add(e);
        this.hitEnemy(e, a);
      }
    }

    // their swings
    for (const e of this.enemies.list) {
      if (!e.hitActive || e.hitPlayer || !P.alive) continue;
      const a = e.atk;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d > a.reach + 0.35) continue;
      const off = Math.abs(angDiff(e.yaw, Math.atan2(dx, dz)));
      if (d > 0.8 && off > a.arc / 2 + 0.25) continue;
      if (P.invulnerable) continue;      // rolled through it
      e.hitPlayer = true;
      const dmg = Math.round(a.dmg * (0.92 + Math.random() * 0.16));
      this.v.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
      this.torches.burst(this.v, 6, 0.6);
      this.audio.play('hit_player', { vol: 0.9 });
      this.hitstop = Math.max(this.hitstop, a.heavy ? 0.09 : 0.06);
      this.shake = Math.max(this.shake, a.heavy ? 0.5 : 0.32);
      this.hooks.onPlayerHit(dmg, e, !!a.heavy);
    }
  }

  hitEnemy(e, a) {
    const P = this.player;
    const charge = P.chargeMul || 1;
    const mult = this.hooks.attackMult ? this.hooks.attackMult() : 1;
    const dmg = Math.round(WEAPON_DMG[P.weapon] * a.dmg * mult * charge * (0.94 + Math.random() * 0.12));
    const killed = e.hurt(dmg, (a.poise || 1) + (charge > 1.3 ? 1 : 0), P.yaw, this.enemies.events);
    // stacked damage number like souls games: hits close together add up
    const now = performance.now() / 1000;
    if (now - (e.dmgT || 0) > 1.6) e.dmgSum = 0;
    e.dmgSum = (e.dmgSum || 0) + dmg; e.dmgT = now;
    // sparks and bone chips where the blade lands
    this.v.set(e.pos.x, e.pos.y + 1.0, e.pos.z);
    this.torches.burst(this.v, a.poise ? 16 : 9, a.poise ? 1.1 : 0.8);
    this.audio.play(this.audio.pick('hit_bone', 3), { vol: 0.95, pos: e.pos });
    if (e.kind === 'warrior' && Math.random() < 0.35) this.audio.play('clang', { vol: 0.5, pos: e.pos });
    this.hitstop = Math.max(this.hitstop, a.poise ? 0.11 : 0.065);
    this.shake = Math.max(this.shake, a.poise ? 0.38 : 0.2);
    if (killed) {
      this.hitstop = 0.14;
      this.hooks.onKill(e);
    }
  }

  // ---------- on-screen: health bars over enemies, lock reticle ----------
  draw(camera, show = true) {
    const now = performance.now() / 1000;
    const target = this.player.lockTarget;
    const boss = show && this.player.alive ? this.pickBoss() : null;
    const B = this.boss;
    if (boss !== B.who) { B.who = boss; B.tr = boss ? boss.hp / boss.def.hp : 1; if (boss) B.name.textContent = boss.def.name; }
    B.el.classList.toggle('on', !!boss);
    if (boss) {
      const f = boss.hp / boss.def.hp;
      B.tr = f >= B.tr ? f : B.tr - (B.tr - f) * 0.05;
      B.fill.style.width = `${f * 100}%`;
      B.trail.style.width = `${B.tr * 100}%`;
      B.dmg.textContent = now - (boss.dmgT || 0) < 1.6 && boss.dmgSum ? boss.dmgSum : '';
    }
    for (const e of this.enemies.list) {
      let bar = this.bars.get(e);
      const visible = show && e !== boss && e.alive && e.state !== 'dormant' && (e === target || now - e.lastHurt < 6) && e.pos.distanceTo(this.player.pos) < 30;
      if (!visible) { if (bar) bar.el.style.display = 'none'; continue; }
      if (!bar) {
        const el = document.createElement('div');
        el.className = 'foe';
        el.innerHTML = '<div class="foe-name"></div><div class="foe-bar"><i class="t"></i><i class="f"></i></div><div class="foe-dmg"></div>';
        this.layer.append(el);
        bar = { el, name: el.querySelector('.foe-name'), fill: el.querySelector('.f'), trail: el.querySelector('.t'), dmg: el.querySelector('.foe-dmg'), tr: 1 };
        bar.name.textContent = e.def.name;
        this.bars.set(e, bar);
      }
      this.v.set(e.pos.x, e.pos.y + 2.25 * e.def.scale, e.pos.z).project(camera);
      if (this.v.z > 1) { bar.el.style.display = 'none'; continue; }
      bar.el.style.display = 'block';
      bar.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * innerWidth}px, ${(-this.v.y * 0.5 + 0.5) * innerHeight}px)`;
      const f = e.hp / e.def.hp;
      bar.tr = f >= bar.tr ? f : bar.tr - (bar.tr - f) * 0.05;
      bar.fill.style.width = `${f * 100}%`;
      bar.trail.style.width = `${bar.tr * 100}%`;
      bar.name.style.display = e === target ? 'block' : 'none';
      const showDmg = now - (e.dmgT || 0) < 1.6 && e.dmgSum;
      bar.dmg.textContent = showDmg ? e.dmgSum : '';
    }
    for (const [e, bar] of this.bars) if (!e.alive && bar.el.style.display !== 'none') bar.el.style.display = 'none';

    if (show && target) {
      this.v.set(target.pos.x, target.pos.y + 1.05 * target.def.scale, target.pos.z).project(camera);
      this.reticle.style.display = this.v.z < 1 ? 'block' : 'none';
      this.reticle.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * innerWidth}px, ${(-this.v.y * 0.5 + 0.5) * innerHeight}px)`;
    } else this.reticle.style.display = 'none';
  }
}
