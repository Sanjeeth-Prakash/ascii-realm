// Sound: music, ambience loops and effects, each on its own volume bus.
//   master -> music  (title theme / world track, crossfaded)
//          -> effects (footsteps, swords, hits, UI, thunder...)
//          -> ambience (rain, wind, crickets, birds, fires)
// Browsers only allow sound after the player has clicked or pressed a key, so
// the context starts on the first input.

const SFX_FILES = [
  'step_grass_0', 'step_grass_1', 'step_grass_2', 'step_grass_3', 'step_stone_0', 'step_stone_1', 'step_stone_2', 'step_stone_3',
  'swing_0', 'swing_1', 'swing_2', 'swing_heavy', 'hit_bone_0', 'hit_bone_1', 'hit_bone_2', 'hit_player', 'clang', 'dodge',
  'rattle', 'skel_awake', 'skel_death', 'flask', 'rest', 'died', 'runes', 'ui_move', 'ui_select', 'ui_open', 'ui_back',
  'torch', 'burn', 'tear', 'thunder_near_0', 'thunder_near_1', 'thunder_far_0', 'thunder_far_1',
];
const AMB_FILES = ['rain', 'wind', 'night', 'day', 'fire'];
const MUSIC_FILES = ['theme', 'world'];

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = new Map();
    this.loops = {};
    this.music = { name: null, src: null, gain: null };
    this.duck = 1;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.ready = false;
    this.wantMusic = null;
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: false });
    window.addEventListener('keydown', start, { once: false });
    settings.onChange((section) => { if (section === 'audio' || section === 'all') this.applyVolumes(); });
  }

  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    // a gentle high cut and compressor keep it soft in headphones
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass'; this.tone.frequency.value = 9000; this.tone.Q.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005; this.comp.release.value = 0.25;
    this.master.connect(this.tone).connect(this.comp).connect(ctx.destination);
    this.bus = {};
    for (const b of ['music', 'effects', 'ambience']) { this.bus[b] = ctx.createGain(); this.bus[b].connect(this.master); }
    this.applyVolumes();
    // music first (it's what you hear on the title screen), then everything else
    await Promise.all(MUSIC_FILES.map((n) => this.load(`music/${n}`)));
    this.ready = true;
    if (this.wantMusic) this.playMusic(this.wantMusic, 2.5);
    await Promise.all([...AMB_FILES.map((n) => this.load(`amb/${n}`)), ...SFX_FILES.map((n) => this.load(`sfx/${n}`))]);
    for (const n of AMB_FILES) this.startLoop(n);
  }

  async load(path) {
    try {
      const res = await fetch(`./assets/audio/${path}.ogg`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(path.split('/').pop(), buf);
    } catch { /* missing or undecodable: stay silent */ }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.get('audio');
    const now = this.ctx.currentTime;
    // overall headroom: a 100% slider is a comfortable level, not a loud one
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master * 0.55, now, 0.05);
    this.bus.music.gain.setTargetAtTime(a.music * 0.42 * this.duck, now, 0.15);
    this.bus.effects.gain.setTargetAtTime(a.effects * 0.7, now, 0.05);
    this.bus.ambience.gain.setTargetAtTime(a.ambience * 0.45, now, 0.1);
  }

  // softer music while paused / in menus
  setDuck(d) { this.duck = d; this.applyVolumes(); }

  playMusic(name, fade = 2.0) {
    this.wantMusic = name;
    if (!this.ready || this.music.name === name) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.music.src) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.src.stop(now + fade + 0.1);
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(g).connect(this.bus.music);
    src.start(now + 0.05);
    this.music = { name, src, gain: g };
  }

  startLoop(name) {
    const buf = this.buffers.get(name);
    if (!buf || this.loops[name]) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(g).connect(this.bus.ambience);
    src.start(this.ctx.currentTime + Math.random() * 0.2, Math.random() * buf.duration);
    this.loops[name] = { src, gain: g };
  }

  // volume 0..1 for each ambience loop, eased
  setLoop(name, v, rate = 0.6) {
    const l = this.loops[name];
    if (l) l.gain.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, rate);
  }

  setListener(x, z, yaw) { this.listener.x = x; this.listener.z = z; this.listener.yaw = yaw; }

  // play an effect; `pos` ({x, z}) makes it come from a place in the world
  play(name, { vol = 1, rate = 1, pos = null, range = 30, delay = 0, bus = 'effects' } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    let gain = vol;
    let node = src.connect(g);
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      gain *= Math.pow(1 - d / range, 1.6);
      // left/right relative to where the camera looks
      const s = Math.sin(this.listener.yaw), c = Math.cos(this.listener.yaw);
      const side = (dx * c - dz * s) / Math.max(d, 1);
      if (ctx.createStereoPanner) {
        // gentle panning: hard left/right feels like a sound inside your ear
        const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.4, Math.min(0.4, side * 0.5));
        node = node.connect(p);
      }
    }
    g.gain.value = gain;
    node.connect(this.bus[bus]);
    src.start(ctx.currentTime + delay);
  }

  pick(base, n) { return `${base}_${Math.floor(Math.random() * n)}`; }
}
