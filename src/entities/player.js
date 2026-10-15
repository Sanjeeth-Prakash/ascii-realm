// The hero: the realistic rigged soldier (Mixamo, via the three.js examples)
// with idle / walk / run clips, plus a procedural pose layer for everything
// else: sword swings, the dodge roll, flask, sitting at the shrine, getting hit
// and dying. Each action is a few key poses (where the upper arm and forearm
// point, how the torso twists and leans) eased together, applied on top of the
// animation with two-bone aiming. Mixamo sword animations can replace these
// later without changing anything else (same rig).
//
// States: move | attack | dodge | hit | flask | rest | dead
// Inputs pressed slightly early are buffered so combat feels responsive.

import * as THREE from 'three';
import { COMMON_GLSL, MAT, makeLitMaterial, applyModelMaterials } from '../render/lighting.js';
import { terrainHeight } from '../world/terrainMath.js';

const WALK = 2.4, RUN = 6.2;               // m/s the walk / run clips are authored for
const JOG = 3.7, SPRINT = 6.1, LOCK_SPEED = 2.6;
const WALK_CYCLE = 1.72, RUN_CYCLE = 2.25;  // metres per animation cycle (no foot sliding)
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const smooth = (t) => t * t * (3 - 2 * t);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

// Rotate `bone` so the direction bone -> child points along `dir` (world), blended by w.
function aimBone(bone, child, dir, w) {
  if (w < 0.001) return;
  bone.updateWorldMatrix(true, true);
  const a = bone.getWorldPosition(_v1);
  const cur = child.getWorldPosition(_v2).sub(a).normalize();
  const delta = _q1.setFromUnitVectors(cur, dir);
  const target = delta.multiply(bone.getWorldQuaternion(_q2));
  const local = bone.parent.getWorldQuaternion(_q3).invert().multiply(target);
  bone.quaternion.slerp(local, w);
}

// Rotate a bone about a world-space axis.
function turnBone(bone, axis, angle) {
  if (Math.abs(angle) < 1e-4) return;
  bone.updateWorldMatrix(true, false);
  const pw = bone.parent.getWorldQuaternion(_q3);
  const rot = _q1.setFromAxisAngle(axis, angle);
  const world = _q2.copy(pw).multiply(bone.quaternion);
  world.premultiply(rot);
  bone.quaternion.copy(pw.invert().multiply(world));
}

// ---- key poses. Directions are [right, up, forward] relative to the hero. ----
// arm = shoulder -> elbow, fore = elbow -> hand; twist turns the torso (+ = to
// his left), lean tips it forward (+) or back (-).
const P = (t, arm, fore, twist = 0, lean = 0) => ({ t, arm, fore, twist, lean });
const GUARD = { arm: [0.25, -0.75, 0.35], fore: [0.05, -0.05, 1], twist: 0, lean: 0 };

export const ATTACKS = {
  sword: {
    light: [
      { name: 'diagonal', dur: 0.72, hit: [0.30, 0.47], combo: [0.42, 0.8], cancel: 0.58, end: 0.8, lunge: [0.18, 0.42, 2.4], dmg: 1.0, stam: 14, reach: 2.2, arc: 1.2, sound: 'swing',
        keys: [P(0.26, [0.75, 0.55, -0.1], [0.3, 0.9, 0.25], -0.5, -0.05), P(0.37, [0.25, 0.3, 0.95], [-0.15, 0.15, 1], 0, 0.1),
          P(0.48, [-0.45, -0.25, 0.85], [-0.75, -0.45, 0.45], 0.5, 0.18), P(0.75, [-0.4, -0.45, 0.75], [-0.55, -0.7, 0.4], 0.35, 0.1)] },
      { name: 'backhand', dur: 0.68, hit: [0.20, 0.38], combo: [0.32, 0.76], cancel: 0.5, end: 0.76, lunge: [0.05, 0.3, 2.2], dmg: 1.05, stam: 14, reach: 2.2, arc: 1.5, sound: 'swing',
        keys: [P(0.18, [-0.55, 0.25, 0.5], [-0.85, 0.2, 0.3], 0.45, 0), P(0.28, [0.1, 0.15, 1], [0.3, 0.1, 0.95], 0, 0.1),
          P(0.38, [0.8, 0.1, 0.45], [0.95, 0.0, -0.1], -0.5, 0.12), P(0.7, [0.7, -0.2, 0.5], [0.8, -0.3, 0.1], -0.35, 0.05)] },
      { name: 'thrust', dur: 0.78, hit: [0.22, 0.36], combo: [0.34, 0.74], cancel: 0.55, end: 0.74, lunge: [0.12, 0.32, 3.6], dmg: 1.1, stam: 15, reach: 2.5, arc: 0.7, sound: 'swing',
        keys: [P(0.2, [0.45, -0.3, -0.75], [0.1, 0.1, 1], -0.4, -0.05), P(0.3, [0.05, 0.15, 1], [0, 0.1, 1], 0.25, 0.22),
          P(0.6, [0.08, 0.05, 1], [0.02, 0.0, 1], 0.2, 0.18)] },
      // the 4th hit finishes the chain: a rising cut that hits harder
      { name: 'rising', dur: 0.88, hit: [0.25, 0.42], combo: null, cancel: 0.62, end: 0.82, lunge: [0.1, 0.35, 2.8], dmg: 1.35, stam: 17, reach: 2.3, arc: 1.3, poise: 1, sound: 'swing_heavy',
        keys: [P(0.22, [-0.4, -0.6, 0.5], [-0.6, -0.55, 0.5], 0.45, 0.15), P(0.33, [0.25, 0.45, 0.85], [0.3, 0.7, 0.6], -0.1, 0),
          P(0.43, [0.4, 0.85, 0.25], [0.3, 0.95, -0.1], -0.4, -0.08), P(0.75, [0.35, 0.6, 0.4], [0.3, 0.8, 0.1], -0.3, -0.04)] },
    ],
    // heavy chain: overhead chop, then a wide sweep. Hold the button to charge either.
    heavy: [
      { name: 'overhead', dur: 1.2, hit: [0.48, 0.62], combo: [0.62, 0.92], cancel: 0.72, end: 0.88, lunge: [0.38, 0.56, 3.2], dmg: 1.75, stam: 24, reach: 2.4, arc: 1.0, poise: 2, sound: 'swing_heavy',
        charge: { at: 0.38, max: 0.7 },
        keys: [P(0.42, [0.25, 0.95, -0.2], [0.05, 0.55, -0.85], -0.2, -0.18), P(0.51, [0.12, 0.6, 0.8], [0, 0.3, 1], 0, 0.1),
          P(0.6, [0.05, -0.35, 0.95], [0, -0.8, 0.6], 0.05, 0.38), P(0.85, [0.1, -0.5, 0.85], [0.05, -0.75, 0.55], 0, 0.3)] },
      { name: 'sweep', dur: 1.1, hit: [0.42, 0.58], combo: [0.6, 0.9], cancel: 0.7, end: 0.86, lunge: [0.34, 0.52, 3.0], dmg: 1.9, stam: 24, reach: 2.6, arc: 2.2, poise: 2, sound: 'swing_heavy',
        charge: { at: 0.33, max: 0.7 },
        keys: [P(0.37, [0.85, 0.3, -0.35], [0.7, 0.2, -0.65], -0.75, 0), P(0.48, [0.1, 0.1, 1], [-0.3, 0, 0.95], 0, 0.15),
          P(0.58, [-0.8, 0.0, 0.5], [-0.95, -0.1, 0.1], 0.75, 0.12), P(0.85, [-0.6, -0.3, 0.6], [-0.7, -0.4, 0.3], 0.5, 0.05)] },
    ],
    // light attack while sprinting: a running lunge
    run: { name: 'running slash', dur: 0.9, hit: [0.26, 0.44], combo: null, cancel: 0.6, end: 0.8, lunge: [0.0, 0.45, 6.5], dmg: 1.3, stam: 18, reach: 2.4, arc: 1.4, poise: 1, sound: 'swing_heavy',
      keys: [P(0.2, [0.7, 0.5, -0.2], [0.4, 0.85, 0.1], -0.45, 0.25), P(0.33, [0.2, 0.2, 1], [-0.1, 0.0, 1], 0.05, 0.35),
        P(0.45, [-0.5, -0.3, 0.8], [-0.8, -0.4, 0.4], 0.5, 0.3), P(0.75, [-0.4, -0.45, 0.75], [-0.55, -0.6, 0.4], 0.3, 0.15)] },
    // light attack out of a roll: a low quick sweep
    roll: { name: 'rolling slash', dur: 0.62, hit: [0.18, 0.34], combo: null, cancel: 0.5, end: 0.7, lunge: [0.0, 0.3, 3.0], dmg: 1.1, stam: 13, reach: 2.2, arc: 1.8, sound: 'swing',
      keys: [P(0.14, [0.7, -0.35, 0.2], [0.85, -0.3, 0.3], -0.5, 0.3), P(0.25, [0.1, -0.3, 1], [-0.2, -0.35, 0.95], 0, 0.32),
        P(0.36, [-0.4, -0.35, 0.85], [-0.85, -0.35, 0.4], 0.5, 0.3), P(0.65, [-0.35, -0.45, 0.8], [-0.6, -0.5, 0.4], 0.35, 0.15)] },
    // light attack out of a backstep: a quick counter thrust
    back: { name: 'counter thrust', dur: 0.62, hit: [0.2, 0.34], combo: null, cancel: 0.5, end: 0.68, lunge: [0.08, 0.32, 4.6], dmg: 1.2, stam: 13, reach: 2.6, arc: 0.7, sound: 'swing',
      keys: [P(0.16, [0.45, -0.3, -0.75], [0.1, 0.1, 1], -0.35), P(0.27, [0.05, 0.15, 1], [0, 0.1, 1], 0.25, 0.25), P(0.6, [0.08, 0.05, 1], [0.02, 0, 1], 0.2, 0.15)] },
  },
  unarmed: {
    light: [
      { name: 'jab', dur: 0.5, hit: [0.24, 0.36], combo: [0.3, 0.62], cancel: 0.45, end: 0.6, lunge: [0.1, 0.3, 1.5], dmg: 0.45, stam: 9, reach: 1.5, arc: 1.0, sound: 'swing',
        keys: [P(0.2, [0.3, -0.5, -0.2], [0.1, 0.5, 0.75], -0.25), P(0.3, [0.1, 0.15, 1], [0, 0.1, 1], 0.2, 0.1), P(0.55, [0.15, -0.1, 0.9], [0.05, 0.2, 0.9], 0.1)] },
      { name: 'hook', dur: 0.55, hit: [0.22, 0.36], combo: null, cancel: 0.45, end: 0.6, lunge: [0.1, 0.3, 1.5], dmg: 0.5, stam: 9, reach: 1.5, arc: 1.2, sound: 'swing',
        keys: [P(0.2, [0.8, -0.1, -0.2], [0.3, 0.2, 0.9], -0.45), P(0.32, [0.4, 0.1, 0.9], [-0.7, 0.1, 0.6], 0.45, 0.1), P(0.6, [0.2, -0.2, 0.9], [-0.4, 0.1, 0.8], 0.3)] },
    ],
    heavy: [{ name: 'haymaker', dur: 0.9, hit: [0.4, 0.55], combo: null, cancel: 0.65, end: 0.8, lunge: [0.3, 0.5, 2.4], dmg: 0.8, stam: 16, reach: 1.7, arc: 1.0, poise: 1, sound: 'swing',
      charge: { at: 0.32, max: 0.6 },
      keys: [P(0.36, [0.6, 0.6, -0.5], [0.2, 0.8, 0.3], -0.55, -0.1), P(0.48, [0.2, 0.2, 1], [-0.2, 0.0, 1], 0.4, 0.25), P(0.8, [0.1, -0.2, 0.9], [-0.2, -0.2, 0.9], 0.3, 0.15)] }],
  },
};

for (const W of Object.values(ATTACKS)) {
  W.light.forEach((a) => { a.kind = 'light'; });
  W.heavy.forEach((a) => { a.kind = 'heavy'; });
  for (const k of ['run', 'roll', 'back']) if (W[k]) W[k].kind = k;
}

const DODGE = { dur: 0.62, iframes: [0.04, 0.62], move: 0.75, recover: 0.82, dist: 4.0, stam: 18 };
const FLASK = { dur: 1.25, drink: 0.45,
  keys: [P(0.3, [0.25, -0.55, 0.55], [-0.35, 0.85, 0.3]), P(0.55, [0.25, -0.35, 0.6], [-0.45, 0.85, 0.05], 0, -0.12), P(0.8, [0.25, -0.5, 0.55], [-0.3, 0.8, 0.3])] };

// interpolate key poses at fraction f (starting from the guard pose)
function sample(keys, f, out) {
  let a = { t: 0, ...GUARD }, b = keys[0];
  for (let i = 0; i < keys.length; i++) {
    if (f >= keys[i].t) { a = keys[i]; b = keys[i + 1] || { ...keys[i], t: 1 }; }
  }
  const u = smooth(THREE.MathUtils.clamp((f - a.t) / Math.max(1e-4, b.t - a.t), 0, 1));
  for (const k of ['arm', 'fore']) for (let i = 0; i < 3; i++) out[k][i] = a[k][i] + (b[k][i] - a[k][i]) * u;
  out.twist = a.twist + (b.twist - a.twist) * u;
  out.lean = a.lean + (b.lean - a.lean) * u;
  return out;
}

export class Player {
  constructor(scene, shared, colliders, gltf) {
    this.shared = shared;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 0, 4.5);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.speed = 0;
    this.turnRate = 0;
    this.phase = 0;
    this.move = 0;
    this.runBlend = 0;
    this.state = 'move';
    this.stateT = 0;
    this.torchOn = true;
    this.torchBlend = 1;
    this.lockTarget = null;
    this.events = [];
    this.buffer = null;
    this.comboIdx = 0;
    this.weapon = 'sword';
    this.t = 0;
    this.hitDone = new Set();
    this.parts = {};
    this.oneshotDur = 1;
    this.actVel = { x: 0, z: 0 };
    // procedural pose layer
    this.pose = { arm: [0, -1, 0], fore: [0, -1, 0], twist: 0, lean: 0 };
    this.poseW = 0;
    this.hipTwist = 0;
    this.sit = 0;            // 0 standing .. 1 sitting
    this.fall = 0;           // death fall 0..1
    this.hitLean = 0;

    // ---- model: root (position, yaw, lean) > tumble (rolls, falls) > model ----
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.tumble = new THREE.Group();
    this.root.add(this.tumble);
    const model = gltf.scene;
    model.rotation.y = Math.PI;               // the model faces -z; our forward is +z
    applyModelMaterials(model, shared, { id: MAT.CHAR, tint: [1.0, 0.95, 0.88], brightness: 2.7, rim: 1.2, wrap: 0.6 });
    this.tumble.add(model);
    this.model = model;
    scene.add(this.root);

    const bone = (n) => model.getObjectByName('mixamorig' + n);
    this.b = {
      hips: bone('Hips'), spine: bone('Spine'), spine1: bone('Spine1'), spine2: bone('Spine2'), head: bone('Head'),
      armR: bone('RightArm'), foreR: bone('RightForeArm'), handR: bone('RightHand'),
      armL: bone('LeftArm'), foreL: bone('LeftForeArm'), handL: bone('LeftHand'),
      thighL: bone('LeftUpLeg'), shinL: bone('LeftLeg'), footL: bone('LeftFoot'),
      thighR: bone('RightUpLeg'), shinR: bone('RightLeg'), footR: bone('RightFoot'),
    };

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    this.idle = this.mixer.clipAction(clip('Idle'));
    this.walk = this.mixer.clipAction(clip('Walk'));
    this.run = this.mixer.clipAction(clip('Run'));
    for (const a of [this.idle, this.walk, this.run]) { a.play(); a.setEffectiveWeight(0); }
    this.walk.timeScale = 0; this.run.timeScale = 0;   // driven by our own phase
    this.idle.setEffectiveWeight(1);

    // ---- props ----
    const leather = makeLitMaterial(shared, { color: [0.36, 0.24, 0.14], id: MAT.CHAR, detail: 0.3, variance: 0, rim: 0.8 });
    const iron = makeLitMaterial(shared, { color: [0.25, 0.25, 0.27], id: MAT.CHAR, detail: 0.2, variance: 0, rim: 1.2 });
    const steel = makeLitMaterial(shared, { color: [0.62, 0.64, 0.68], id: MAT.CHAR, detail: 0.15, variance: 0, rim: 1.6 });
    this.torch = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 0.6, 6), leather);
    stick.position.y = 0.12;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.12, 7), iron);
    cup.position.y = 0.44;
    this.torch.add(stick, cup);
    scene.add(this.torch);
    this.torchTip = new THREE.Vector3();

    // a plain longsword: grip, crossguard, long blade (blade points along +y)
    this.sword = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6), leather);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.05), iron);
    guard.position.y = 0.11;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.88, 0.014), steel);
    blade.position.y = 0.56;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.039, 0.1, 4), steel);
    tip.position.y = 1.05; tip.scale.z = 0.25;
    this.sword.add(grip, guard, blade, tip);
    scene.add(this.sword);
    for (const g of [this.torch, this.sword]) g.traverse((o) => { o.layers.enable(1); o.frustumCulled = false; });

    // ---- cape ----
    this.capeU = { uDrag: { value: new THREE.Vector3() } };
    const capeGeo = new THREE.PlaneGeometry(0.42, 0.95, 4, 12);
    capeGeo.translate(0, -0.525, 0);
    const capeMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...this.capeU, uColor: { value: new THREE.Vector3(0.30, 0.08, 0.07) } },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${COMMON_GLSL}
        uniform vec3 uDrag;
        varying vec3 vP; varying vec3 vN;
        void main(){
          vec3 p = position;
          float t = clamp(-position.y/1.05, 0.0, 1.0);
          float flap = sin(t*5.0 - uTime*(6.0 + uDrag.y*6.0) + position.x*4.0)*(0.03 + 0.07*uDrag.y);
          p.z -= (0.08 + uDrag.z*0.6)*t*t + flap*t;
          p.x += uDrag.x*0.35*t*t;
          p.y += uDrag.z*0.28*t*t;
          p.x *= 1.0 + t*0.4;
          vec4 wp = modelMatrix*vec4(p, 1.0);
          vP = wp.xyz;
          vN = normalize(mat3(modelMatrix)*vec3(0.0, 0.25 + uDrag.z*0.4, 1.0));
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: /* glsl */`
        ${COMMON_GLSL}
        uniform vec3 uColor;
        varying vec3 vP; varying vec3 vN;
        void main(){
          SHADOW_PASS_OUT
          vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
          float folds = 0.75 + 0.25*sin(vP.x*30.0 + vP.z*30.0);
          vec3 c = shade(uColor*folds, N, vP, 0.8);
          vec3 V = normalize(cameraPosition - vP);
          c += uColor*pow(1.0 - abs(dot(N, V)), 2.0)*(0.15 + 1.5*length(torchLight(N, vP, 1.0)));
          gl_FragColor = vec4(c, 1.0);
          WRITE_ID(${MAT.CHAR});
        }`,
    });
    this.cape = new THREE.Mesh(capeGeo, capeMat);
    this.cape.frustumCulled = false;
    this.cape.layers.enable(1);
    scene.add(this.cape);

    this.root.position.copy(this.pos);
  }

  setWeapon(kind) { this.weapon = kind; this.sword.visible = kind === 'sword'; }

  get busy() { return this.state !== 'move'; }
  get invulnerable() { return (this.state === 'dodge' && this.stateT >= this.iframe0 && this.stateT <= this.iframe1) || this.state === 'dead'; }
  get alive() { return this.state !== 'dead'; }

  enter(state, dur = 1) {
    this.state = state;
    this.stateT = 0;
    this.oneshotDur = dur;
    this.hitDone = new Set();
    this.hitActive = false;
  }

  // ---------------------------------------------------------------- update
  // ctl: { x, z, run, toggleTorch, light, heavy, dodge, flask, flasks }
  update(dt, ctl, stamina = 100) {
    this.t += dt;
    this.stateT += dt;
    this.events.length = 0;
    for (const k of ['light', 'heavy', 'dodge', 'flask']) if (ctl[k]) this.buffer = { kind: k, t: this.t };
    this.heavyHeld = !!ctl.heavyHeld;
    if (this.buffer && this.t - this.buffer.t > 0.35) this.buffer = null;
    if (ctl.toggleTorch && this.state !== 'dead') { this.torchOn = !this.torchOn; this.events.push({ type: 'torch', on: this.torchOn }); }

    const mag = Math.min(1, Math.hypot(ctl.x, ctl.z));
    const dirYaw = mag > 0.1 ? Math.atan2(ctl.x, ctl.z) : null;
    const haveSt = stamina > 0;

    // ---- start actions (from free movement, cancel windows, or combo windows) ----
    const D = this.oneshotDur;
    const canAct = this.state === 'move' || (this.state === 'attack' && this.stateT >= this.atk.cancel * D) ||
      (this.state === 'dodge' && this.stateT >= DODGE.recover * D) || (this.state === 'hit' && this.stateT > 0.42);
    const inCombo = this.state === 'attack' && this.atk.combo && this.stateT >= this.atk.combo[0] * D && this.stateT <= this.atk.combo[1] * D;
    if (this.buffer) {
      const k = this.buffer.kind;
      if (k === 'dodge' && canAct && haveSt) { this.buffer = null; this.startDodge(dirYaw); }
      else if (k === 'light' && (canAct || (inCombo && this.atk.kind === 'light')) && haveSt) {
        this.buffer = null;
        const W = ATTACKS[this.weapon];
        const afterRoll = this.state === 'dodge' || this.t - (this.dodgeEnd ?? -9) < 0.4;
        if (this.state === 'move' && this.speed > JOG + 0.6 && W.run) this.startAttack(W.run, dirYaw);
        else if (afterRoll && this.lastBackstep && W.back) this.startAttack(W.back, dirYaw);
        else if (afterRoll && W.roll) this.startAttack(W.roll, dirYaw);
        else {
          const chain = inCombo && this.atk.kind === 'light';
          this.comboIdx = chain ? (this.comboIdx + 1) % W.light.length : 0;
          this.startAttack(W.light[this.comboIdx], dirYaw);
        }
      } else if (k === 'heavy' && (canAct || (inCombo && this.atk.kind === 'heavy')) && haveSt) {
        this.buffer = null;
        const H = ATTACKS[this.weapon].heavy;
        const chain = inCombo && this.atk.kind === 'heavy';
        this.heavyIdx = chain ? ((this.heavyIdx || 0) + 1) % H.length : 0;
        this.comboIdx = 0;
        this.startAttack(H[this.heavyIdx], dirYaw);
      }
      else if (k === 'flask' && this.state === 'move') { this.buffer = null; if (ctl.flasks > 0) this.startFlask(); else this.events.push({ type: 'noflask' }); }
    }

    // ---- movement ----
    let target = 0;
    this.sprinting = false;
    if (this.state === 'move') {
      if (this.lockTarget) {
        const face = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
        this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, face) * (1 - Math.exp(-12 * dt)), -9 * dt, 9 * dt);
        target = mag * (ctl.run && this.canRun !== false ? JOG : LOCK_SPEED);
        if (dirYaw !== null) this.moveYaw = dirYaw;
        this.turnRate = damp(this.turnRate, 0, 8, dt);
      } else if (dirYaw !== null) {
        const diff = angDiff(this.yaw, dirYaw);
        const rate = this.speed < 1.2 ? 13 : this.speed > 4.6 ? 5.2 : 8.5;
        const step = THREE.MathUtils.clamp(diff * (1 - Math.exp(-16 * dt)), -rate * dt, rate * dt);
        this.yaw += step;
        this.turnRate = damp(this.turnRate, step / Math.max(dt, 1e-4), 8, dt);
        const align = Math.max(0, Math.cos(diff));
        const running = ctl.run && this.canRun !== false;
        target = (running ? SPRINT : JOG) * mag * align * align;
        this.sprinting = running && this.speed > JOG + 0.3;
        this.moveYaw = this.yaw;
      } else {
        this.turnRate = damp(this.turnRate, 0, 8, dt);
      }
      const accel = target > this.speed ? (target > JOG + 0.1 ? 6.5 : 9.5) : 13;
      const prev = this.speed;
      this.speed += THREE.MathUtils.clamp(target - this.speed, -accel * dt, accel * dt);
      this.accel = damp(this.accel || 0, (this.speed - prev) / Math.max(dt, 1e-4), 10, dt);
      const my = this.moveYaw ?? this.yaw;
      this.applyMove(dt, Math.sin(my) * this.speed, Math.cos(my) * this.speed);
    } else {
      this.speed = damp(this.speed, 0, 10, dt);
      this.accel = damp(this.accel || 0, 0, 10, dt);
      this.turnRate = damp(this.turnRate, 0, 8, dt);
      this.updateAction(dt, dirYaw, mag);
      this.applyMove(dt, this.actVel.x, this.actVel.z);
    }

    this.torchBlend = damp(this.torchBlend, this.torchOn && this.state !== 'dead' ? 1 : 0, 6, dt);
    this.animate(dt);
  }

  applyMove(dt, vx, vz) {
    let px = this.pos.x + vx * dt, pz = this.pos.z + vz * dt;
    for (const c of this.colliders) {
      const dx = px - c.x, dz = pz - c.z;
      if (Math.abs(dx) > c.r + 0.5 || Math.abs(dz) > c.r + 0.5) continue;
      const d = Math.hypot(dx, dz), min = c.r + 0.34;
      if (d < min && d > 1e-4) { px = c.x + dx / d * min; pz = c.z + dz / d * min; }
    }
    if (terrainHeight(px, pz) < -1.0) { px = this.pos.x; pz = this.pos.z; }
    px = Math.max(-195, Math.min(195, px)); pz = Math.max(-195, Math.min(195, pz));
    this.vel.x = (px - this.pos.x) / Math.max(dt, 1e-4);
    this.vel.z = (pz - this.pos.z) / Math.max(dt, 1e-4);
    this.pos.x = px; this.pos.z = pz;
    this.pos.y = damp(this.pos.y, Math.max(terrainHeight(px, pz), -1.0), 18, dt);
    if (this.state === 'move') this.speed = Math.min(this.speed, Math.hypot(this.vel.x, this.vel.z) + 0.05);
  }

  // ---------------------------------------------------------------- actions
  startAttack(atk, dirYaw) {
    this.enter('attack', atk.dur);
    this.atk = atk;
    if (this.lockTarget) this.yaw = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
    else if (dirYaw !== null) this.yaw += angDiff(this.yaw, dirYaw) * 0.85;
    this.events.push({ type: 'stamina', cost: atk.stam });
    this.swung = false;
    this.charging = 0;
    this.chargeMul = 1;
    this.fullCharge = false;
    this.released = false;
  }

  startDodge(dirYaw) {
    this.enter('dodge', DODGE.dur);
    if (dirYaw === null) { this.rollYaw = this.yaw + Math.PI; this.backstep = true; }
    else { this.backstep = false; this.rollYaw = dirYaw; if (!this.lockTarget) this.yaw = dirYaw; }
    this.iframe0 = DODGE.iframes[0] * this.oneshotDur;
    this.iframe1 = DODGE.iframes[1] * this.oneshotDur;
    this.events.push({ type: 'stamina', cost: DODGE.stam }, { type: 'sound', name: 'dodge' });
  }

  startFlask() { this.enter('flask', FLASK.dur); this.drank = false; }

  takeHit(fromX, fromZ, heavy) {
    if (this.state === 'dead') return;
    this.enter('hit', 0.6);
    this.hitDir = Math.atan2(this.pos.x - fromX, this.pos.z - fromZ);
    this.hitHeavy = heavy;
    this.buffer = null;
  }

  die() { this.enter('dead', 1); this.lockTarget = null; this.fallDir = this.hitDir ?? this.yaw + Math.PI; }

  startRest() { this.enter('rest', 1); this.lockTarget = null; this.standing = false; }

  standUp() {
    if (this.state !== 'rest' || this.standing) return;
    this.standing = true;
    this.stateT = 0;
  }

  revive() {
    this.enter('move');
    this.speed = 0;
    this.buffer = null;
    this.fall = 0; this.sit = 0; this.poseW = 0;
    this.tumble.quaternion.identity();
  }

  updateAction(dt, dirYaw, mag) {
    const T = this.stateT, D = this.oneshotDur;
    this.actVel = { x: 0, z: 0 };
    if (this.state === 'attack') {
      const a = this.atk;
      // charged heavy: holding the button freezes the wind-up and builds power
      if (a.charge && this.heavyHeld && T / D >= a.charge.at && this.charging < a.charge.max) {
        this.stateT = a.charge.at * D;
        this.charging += dt;
        this.chargeMul = 1 + 0.5 * Math.min(1, this.charging / a.charge.max);
        if (this.charging >= a.charge.max && !this.fullCharge) { this.fullCharge = true; this.events.push({ type: 'charged' }); }
      } else if (this.charging > 0 && !this.released) { this.released = true; }
      const f = this.stateT / D;
      if (!this.swung && f >= a.hit[0] - 0.08) { this.swung = true; this.events.push({ type: 'sound', name: a.sound }); }
      if (f >= a.lunge[0] && f <= a.lunge[1]) {
        const s = a.lunge[2] * Math.sin(Math.PI * (f - a.lunge[0]) / (a.lunge[1] - a.lunge[0]));
        this.actVel = { x: Math.sin(this.yaw) * s, z: Math.cos(this.yaw) * s };
      }
      if (f < a.hit[0] && !this.lockTarget && dirYaw !== null) this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, dirYaw), -2.5 * dt, 2.5 * dt);
      if (f < a.hit[0] && this.lockTarget) this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z)), -6 * dt, 6 * dt);
      this.hitActive = f >= a.hit[0] && f <= a.hit[1];
      if (f >= a.end) this.finish();
    } else if (this.state === 'dodge') {
      const f = T / D;
      if (f < DODGE.move) {
        const u = f / DODGE.move;
        const dist = this.backstep ? DODGE.dist * 0.55 : DODGE.dist;
        const s = (dist / (DODGE.move * D)) * 1.6 * (1 - u) ** 0.9;   // fast start, eased stop
        this.actVel = { x: Math.sin(this.rollYaw) * s, z: Math.cos(this.rollYaw) * s };
      }
      if (f >= 1.0) this.finish();
    } else if (this.state === 'hit') {
      const s = 2.6 * Math.max(0, 1 - T / 0.25);
      this.actVel = { x: Math.sin(this.hitDir) * s, z: Math.cos(this.hitDir) * s };
      if (T > 0.6) this.finish();
    } else if (this.state === 'flask') {
      if (dirYaw !== null) {
        this.yaw += THREE.MathUtils.clamp(angDiff(this.yaw, dirYaw), -3 * dt, 3 * dt);
        this.actVel = { x: Math.sin(this.yaw) * 1.1 * mag, z: Math.cos(this.yaw) * 1.1 * mag };
      }
      if (!this.drank && T > D * FLASK.drink) { this.drank = true; this.events.push({ type: 'drink' }); }
      if (T >= D) this.finish();
    } else if (this.state === 'rest') {
      if (this.standing && T > 0.9) this.finish();
    }
  }

  finish() {
    if (this.state === 'dodge') { this.dodgeEnd = this.t; this.lastBackstep = this.backstep; }
    this.enter('move');
  }

  // ---------------------------------------------------------------- animation
  animate(dt) {
    const spd = this.state === 'move' ? Math.hypot(this.vel.x, this.vel.z) : 0;
    const B = this.b;

    // strafing while locked on: legs walk the way you move, chest keeps facing the foe
    let back = false, hipWant = 0;
    if (this.lockTarget && this.state === 'move' && spd > 0.3) {
      let rel = angDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
      if (Math.abs(rel) > 1.95) { back = true; rel = angDiff(Math.PI, rel); }
      hipWant = THREE.MathUtils.clamp(rel, -1.3, 1.3);
    }
    this.hipTwist = damp(this.hipTwist, hipWant, 10, dt);

    // ---- locomotion clips, one shared phase (feet don't slide) ----
    this.move = damp(this.move, Math.min(spd / WALK, 1), 8, dt);
    this.runBlend = damp(this.runBlend, THREE.MathUtils.clamp((spd - WALK) / (RUN - WALK), 0, 1), 6, dt);
    const m = this.move, rb = this.runBlend;
    const cycle = THREE.MathUtils.lerp(WALK_CYCLE, RUN_CYCLE, rb);
    this.phase = (this.phase + (back ? -1 : 1) * (spd / cycle) * dt + 1) % 1;
    if (m < 0.02) this.phase = 0;
    this.walk.time = this.phase * this.walk.getClip().duration;
    this.run.time = this.phase * this.run.getClip().duration;
    this.idle.setEffectiveWeight(1 - m);
    this.walk.setEffectiveWeight(m * (1 - rb));
    this.run.setEffectiveWeight(m * rb);
    if (this.state === 'move' && m > 0.3) {
      const ph = this.phase * 2;
      if (this.stepPh !== undefined && Math.floor(ph) !== Math.floor(this.stepPh)) this.events.push({ type: 'step', run: rb > 0.5 });
      this.stepPh = ph;
    } else this.stepPh = undefined;
    this.mixer.update(dt);

    // ---- body: lean into turns / acceleration, and whole-body moves (roll, fall, sit) ----
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.rotation.z = THREE.MathUtils.clamp(-this.turnRate * 0.03, -0.18, 0.18) * m;
    this.root.rotation.x = THREE.MathUtils.clamp((this.accel || 0) * 0.018, -0.1, 0.12);

    const T = this.stateT, D = this.oneshotDur;
    this.sit = damp(this.sit, this.state === 'rest' && !this.standing ? 1 : 0, this.state === 'rest' && !this.standing ? 3.2 : 5, dt);
    this.fall = this.state === 'dead' ? Math.min(1, this.fall + dt / 0.75) : 0;
    let pivot = 0.55, drop = 0;
    const axis = _v3.set(1, 0, 0);
    const rolling = this.state === 'dodge' && !this.backstep;
    if (rolling) {
      const f = Math.min(1, T / (D * 0.9));
      const rel = angDiff(this.yaw, this.rollYaw);
      axis.set(Math.cos(rel), 0, -Math.sin(rel));   // up x roll direction, in the hero's frame
      drop = 0.22 * Math.sin(Math.PI * f);
      this.tumble.quaternion.setFromAxisAngle(axis, Math.PI * 2 * smooth(f));
    } else if (this.state === 'dodge') {
      const f = Math.min(1, T / (D * 0.9));
      this.tumble.quaternion.setFromAxisAngle(axis, -0.28 * Math.sin(Math.PI * f));   // lean back on a backstep
    } else if (this.state === 'dead') {
      // topple away from the blow and lie still
      pivot = 0.05;
      const rel = angDiff(this.yaw, this.fallDir);
      axis.set(Math.cos(rel), 0, -Math.sin(rel));
      const f = this.fall;
      this.tumble.quaternion.setFromAxisAngle(axis, (Math.PI / 2) * 0.97 * f * f);
      drop = -0.08 * f;
    } else {
      this.tumble.quaternion.slerp(_q1.identity(), 1 - Math.exp(-18 * dt));
    }
    this.tumble.position.y = pivot - drop - this.sit * 0.5;
    this.model.position.y = -pivot;
    this.root.updateMatrixWorld(true);

    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const fwd = _fwd.set(s, 0, c), right = _right.set(-c, 0, s);
    const dir = (v, out) => out.set(0, 0, 0).addScaledVector(right, v[0]).addScaledVector(Y, v[1]).addScaledVector(fwd, v[2]).normalize();

    // hips turn toward the strafe direction; chest turns back to the target
    if (Math.abs(this.hipTwist) > 0.01) { turnBone(B.hips, Y, this.hipTwist); turnBone(B.spine, Y, -this.hipTwist * 0.6); turnBone(B.spine1, Y, -this.hipTwist * 0.4); }

    // ---- right arm / torso pose for actions ----
    let want = 0;
    if (this.state === 'attack') { sample(this.atk.keys, T / D, this.pose); want = 1; }
    else if (this.state === 'flask') { sample(FLASK.keys, T / D, this.pose); want = 1; }
    else if ((this.state === 'move' || this.state === 'hit') && this.weapon === 'sword') {
      // sword held low and ready, swinging a little with the stride
      const sw = Math.sin(this.phase * Math.PI * 2) * 0.2 * m;
      const p = this.pose;
      p.arm[0] = 0.22; p.arm[1] = -0.85; p.arm[2] = 0.3 - sw;
      p.fore[0] = 0.05; p.fore[1] = -0.25 + rb * 0.2; p.fore[2] = 1;
      p.twist = 0; p.lean = 0;
      want = this.lockTarget ? 0.9 : 0.55 * (1 - rb * 0.6);
    }
    if (this.state === 'rest' || this.state === 'dead' || rolling) want = 0;
    this.poseW = damp(this.poseW, want, this.state === 'attack' ? 40 : 10, dt);
    const pw = this.poseW;
    if (pw > 0.01) {
      turnBone(B.spine1, Y, this.pose.twist * 0.5 * pw);
      turnBone(B.spine2, Y, this.pose.twist * 0.5 * pw);
      turnBone(B.spine1, right, this.pose.lean * 0.6 * pw);
      aimBone(B.armR, B.foreR, dir(this.pose.arm, _d1), pw);
      aimBone(B.foreR, B.handR, dir(this.pose.fore, _d2), pw);
    }

    // getting hit: snap back and twist
    const hurt = this.state === 'hit' && T < 0.25;
    this.hitLean = damp(this.hitLean, hurt ? 1 : 0, hurt ? 30 : 6, dt);
    if (this.hitLean > 0.01) {
      const away = angDiff(this.yaw, this.hitDir ?? this.yaw);
      turnBone(B.spine1, right, -0.45 * Math.cos(away) * this.hitLean * (this.hitHeavy ? 1.4 : 1));
      turnBone(B.spine2, fwd, 0.25 * Math.sin(away) * this.hitLean);
    }

    // sitting at the shrine: knees up, arms resting on them
    if (this.sit > 0.01) {
      const w = this.sit;
      aimBone(B.thighL, B.shinL, dir([-0.25, 0.5, 0.82], _d1), w);
      aimBone(B.shinL, B.footL, dir([-0.05, -0.8, 0.6], _d1), w);
      aimBone(B.thighR, B.shinR, dir([0.25, 0.5, 0.82], _d1), w);
      aimBone(B.shinR, B.footR, dir([0.05, -0.8, 0.6], _d1), w);
      turnBone(B.spine1, right, 0.25 * w);
      aimBone(B.armR, B.foreR, dir([0.3, -0.5, 0.75], _d1), w);
      aimBone(B.foreR, B.handR, dir([-0.2, -0.3, 0.9], _d1), w);
    }
    // tucked roll: knees pulled in, back rounded (directions turn with the roll)
    if (rolling) {
      const w = Math.sin(Math.PI * Math.min(1, T / (D * 0.9)));
      const tq = this.tumble.quaternion;
      const tdir = (v, out) => out.set(v[0] * -1, v[1], v[2]).normalize().applyQuaternion(tq).applyQuaternion(this.root.quaternion);
      // (the hero's local frame: +x is his left, so right = -x)
      aimBone(B.thighL, B.shinL, tdir([-0.15, 0.35, 0.95], _d1), w);
      aimBone(B.shinL, B.footL, tdir([0, -0.95, 0.2], _d1), w);
      aimBone(B.thighR, B.shinR, tdir([0.15, 0.35, 0.95], _d1), w);
      aimBone(B.shinR, B.footR, tdir([0, -0.95, 0.2], _d1), w);
      turnBone(B.spine1, _v1.set(1, 0, 0).applyQuaternion(tq).applyQuaternion(this.root.quaternion), 0.5 * w);
    }

    // ---- torch in the left hand: upper arm forward-down-out, forearm up ----
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.12 * m;
    const tb = this.torchBlend * (1 - this.sit) * (this.state === 'dead' || rolling ? 0 : 1);
    if (tb > 0.01) {
      const left = _v2.copy(right).negate();
      const upper = _d1.copy(fwd).multiplyScalar(0.5 + sway).addScaledVector(left, 0.42).add(_v1.set(0, -0.62, 0)).normalize();
      aimBone(B.armL, B.foreL, upper, tb);
      const lower = _d2.copy(fwd).multiplyScalar(0.42).addScaledVector(left, 0.05).add(_v1.set(0, 0.9, 0)).normalize();
      aimBone(B.foreL, B.handL, lower, tb);
    }
    this.model.updateMatrixWorld(true);
    B.handL.getWorldPosition(this.torch.position);
    this.torch.position.y += 0.02;
    this.torch.quaternion.setFromEuler(_e.set(0, this.yaw, 0));
    this.torch.scale.setScalar(Math.max(0.001, this.torchBlend));
    this.torch.visible = this.torchBlend > 0.05;
    this.torchTip.copy(this.torch.position).add(_v1.set(0, 0.52, 0));

    // ---- sword follows the right hand, blade continuing the forearm ----
    if (this.sword.visible) {
      B.handR.getWorldPosition(this.sword.position);
      const fore = _v1.copy(this.sword.position).sub(B.foreR.getWorldPosition(_v2)).normalize();
      const bladeDir = _d1.copy(fore).addScaledVector(fwd, this.state === 'move' ? 0.9 : 0.35).normalize();
      this.sword.quaternion.setFromUnitVectors(Y, bladeDir);
      this.sword.position.addScaledVector(bladeDir, -0.05);
    }

    // ---- cape hangs from the upper back ----
    const bodyQ = this.tumble.getWorldQuaternion(_q1);
    B.spine2.getWorldPosition(this.cape.position);
    this.cape.position.addScaledVector(_v2.set(0, 0, -1).applyQuaternion(bodyQ), 0.17);
    this.cape.position.addScaledVector(_v2.set(0, 1, 0).applyQuaternion(bodyQ), 0.2);
    this.cape.quaternion.copy(bodyQ).multiply(_q2.setFromEuler(_e.set(0.08 + 0.1 * rb * m, 0, 0)));
    const fwdSpeed = this.vel.x * s + this.vel.z * c;
    const side = this.vel.x * c - this.vel.z * s;
    const w = this.shared.uWindDir.value, ws = this.shared.uWindStrength.value;
    const windBack = -(w.x * s + w.y * c) * ws;
    const windSide = (w.x * c - w.y * s) * ws;
    const drag = this.capeU.uDrag.value;
    drag.z = damp(drag.z, THREE.MathUtils.clamp(fwdSpeed / RUN * 1.3 + Math.max(0, windBack) * 0.35, 0, 1.3), 4, dt);
    drag.x = damp(drag.x, THREE.MathUtils.clamp(-side / RUN + windSide * 0.3, -0.8, 0.8), 4, dt);
    drag.y = damp(drag.y, Math.min(1, spd / RUN + ws * 0.3), 3, dt);
  }

  torchWorldPos(out) { return out.copy(this.torchTip); }
  headWorldPos(out) { return this.b.head.getWorldPosition(out).setY(this.pos.y + 2.25); }
}
