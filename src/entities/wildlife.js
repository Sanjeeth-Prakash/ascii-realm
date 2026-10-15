// Ambient life: foxes that wander, sniff around and bolt when you get close,
// and storks circling over the lake.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MAT, applyModelMaterials } from '../render/lighting.js';
import { terrainHeight, pathDist, LAKE } from '../world/terrainMath.js';

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

class Fox {
  constructor(scene, shared, gltf, x, z) {
    this.root = new THREE.Group();
    const model = cloneSkinned(gltf.scene);
    model.scale.setScalar(0.0075);
    applyModelMaterials(model, shared, { id: MAT.CHAR, brightness: 1.6, rim: 0.7, wrap: 0.5 });
    this.root.add(model);
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    this.acts = { Survey: this.mixer.clipAction(clip('Survey')), Walk: this.mixer.clipAction(clip('Walk')), Run: this.mixer.clipAction(clip('Run')) };
    Object.values(this.acts).forEach((a) => { a.play(); a.setEffectiveWeight(0); });
    this.weights = { Survey: 1, Walk: 0, Run: 0 };
    this.home = new THREE.Vector2(x, z);
    this.pos = new THREE.Vector3(x, terrainHeight(x, z), z);
    this.yaw = Math.random() * 6.28;
    this.speed = 0;
    this.state = 'idle';
    this.timer = 1 + Math.random() * 4;
    this.target = new THREE.Vector2(x, z);
    this.mixer.setTime(Math.random() * 3);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  pickTarget(r = 9) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, d = 3 + Math.random() * r;
      const x = this.home.x + Math.cos(a) * d, z = this.home.y + Math.sin(a) * d;
      if (terrainHeight(x, z) > -0.7) { this.target.set(x, z); return; }
    }
  }

  update(dt, playerPos) {
    const toPlayer = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    this.timer -= dt;
    if (toPlayer < 6.5 && this.state !== 'flee') {
      this.state = 'flee';
      const a = Math.atan2(this.pos.z - playerPos.z, this.pos.x - playerPos.x) + (Math.random() - 0.5) * 0.8;
      this.target.set(this.pos.x + Math.cos(a) * 16, this.pos.z + Math.sin(a) * 16);
      this.home.copy(this.target);
      this.timer = 4;
    }
    let want = 0;
    if (this.state === 'idle') {
      if (this.timer < 0) { this.state = 'walk'; this.pickTarget(); this.timer = 12; }
    } else {
      const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.z;
      const d = Math.hypot(dx, dz);
      want = this.state === 'flee' ? 5.2 : 1.15;
      if (d < 0.6 || this.timer < 0) {
        this.state = 'idle'; this.timer = 2 + Math.random() * 6; want = 0;
      } else {
        const turn = angDiff(this.yaw, Math.atan2(dx, dz));
        this.yaw += turn * (1 - Math.exp(-(this.state === 'flee' ? 8 : 3) * dt));
        if (Math.abs(turn) > 1.2) want *= 0.4; // slow down to turn
      }
    }
    this.speed = damp(this.speed, want, this.state === 'flee' ? 6 : 3, dt);
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    if (terrainHeight(nx, nz) > -0.7) { this.pos.x = nx; this.pos.z = nz; } else { this.state = 'idle'; this.timer = 1; }
    this.pos.y = damp(this.pos.y, terrainHeight(this.pos.x, this.pos.z), 12, dt);

    // blend animations by speed, playback matched to speed
    const runW = THREE.MathUtils.clamp((this.speed - 1.6) / 2.4, 0, 1);
    const moveW = THREE.MathUtils.clamp(this.speed / 0.8, 0, 1);
    const tgt = { Survey: 1 - moveW, Walk: moveW * (1 - runW), Run: moveW * runW };
    for (const k in tgt) {
      this.weights[k] = damp(this.weights[k], tgt[k], 8, dt);
      this.acts[k].setEffectiveWeight(this.weights[k]);
    }
    this.acts.Walk.timeScale = Math.max(0.3, this.speed / 1.15);
    this.acts.Run.timeScale = Math.max(0.5, this.speed / 5.0);
    this.mixer.update(dt);

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

class Bird {
  constructor(scene, shared, gltf, i) {
    this.model = cloneSkinned(gltf.scene);
    this.model.scale.setScalar(0.0075);
    applyModelMaterials(this.model, shared, { id: MAT.CHAR, brightness: 1.7, rim: 0.6, wrap: 0.6 });
    this.model.traverse((o) => { if (o.isMesh) o.layers.disable(1); }); // no shadows from tiny birds
    scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const a = this.mixer.clipAction(gltf.animations[0]);
    a.play();
    a.timeScale = 0.9 + Math.random() * 0.3;
    this.mixer.setTime(Math.random() * 2);
    this.radius = 14 + i * 4 + Math.random() * 3;
    this.height = 8 + i * 0.8;
    this.speed = (0.22 + Math.random() * 0.06) * (i % 2 ? 1 : -1);
    this.angle = Math.random() * 6.28;
    this.center = new THREE.Vector2(LAKE.x + (Math.random() - 0.5) * 6, LAKE.z + (Math.random() - 0.5) * 6);
  }

  update(dt, time) {
    this.angle += this.speed * dt;
    const r = this.radius + Math.sin(time * 0.3 + this.radius) * 3;
    const x = this.center.x + Math.cos(this.angle) * r;
    const z = this.center.y + Math.sin(this.angle) * r;
    const y = this.height + Math.sin(time * 0.7 + this.radius) * 0.8;
    this.model.position.set(x, y, z);
    const dir = Math.sign(this.speed);
    const tx = -Math.sin(this.angle) * dir, tz = Math.cos(this.angle) * dir;
    this.model.rotation.set(0, Math.atan2(tx, tz), 0);
    this.model.rotateZ(-0.35 * dir); // bank into the turn
    this.mixer.update(dt);
  }
}

export class Wildlife {
  constructor(scene, shared, assets) {
    this.foxes = [];
    const spots = [[-22, 16], [24, -18], [-30, -40], [18, 30], [70, 10], [-8, 48]];
    for (const [x, z] of spots) {
      if (pathDist(x, z) < 2) continue;
      this.foxes.push(new Fox(scene, shared, assets.fox, x, z));
    }
    this.birds = [0, 1, 2, 3].map((i) => new Bird(scene, shared, assets.stork, i));
  }

  update(dt, time, playerPos) {
    for (const f of this.foxes) {
      // only animate foxes near the player; far ones just wait
      if (Math.abs(f.pos.x - playerPos.x) < 70 && Math.abs(f.pos.z - playerPos.z) < 70) f.update(dt, playerPos);
    }
    for (const b of this.birds) b.update(dt, time);
  }
}
