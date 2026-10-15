// In-game HUD: HP / FP / stamina bars along the bottom, the equipment cross
// (spell, both hands, quick item) bottom-left, runes and the menu bar
// bottom-right, frame rate in the corner.

import { ITEMS, RARITY, countOf } from '../game/items.js';
import { keyName } from '../core/settings.js';

const SHORT = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5' };
export const shortKey = (c) => SHORT[c] || keyName(c);

export class Hud {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.stats = { hp: [380, 380], fp: [120, 120], st: [100, 100], level: 1, runes: 0 };
    this.trail = { hp: 380, fp: 120, st: 100 };   // the pale "recent loss" part of each bar
    this.toastEl = document.getElementById('toast');
    this.plates = new Map();
    this.frames = 0; this.acc = 0; this.fps = 0;
    this.toastTimer = 0;
  }

  nameplate(id, text) {
    let el = this.plates.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'nameplate';
      document.body.appendChild(el);
      this.plates.set(id, el);
    }
    el.textContent = text;
    return el;
  }

  placePlate(id, worldPos, camera) {
    const el = this.plates.get(id);
    if (!el) return;
    const p = worldPos.clone().project(camera);
    el.style.display = p.z < 1 ? 'block' : 'none';
    el.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = 1;
    this.toastTimer = 1.6;
  }

  // "[E] Rest at the shrine" style hint above the bars (null hides it)
  prompt(key, text) {
    const el = this.el('prompt');
    const want = text ? `${key}|${text}` : '';
    if (want === this._prompt) return;
    this._prompt = want;
    if (text) { el.replaceChildren(Object.assign(document.createElement('kbd'), { textContent: key }), text); }
    el.classList.toggle('on', !!text);
  }

  setName(name) { this.el('pname').textContent = name; }

  showGpu(renderer) {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
    this.el('gpu').textContent = name.replace(/ANGLE \(|\)$/g, '');
    return name;
  }

  // equipment cross + menu key labels; call when equipment or bindings change
  refreshEquip(inv, bindings, torchOn) {
    for (const slot of ['spell', 'left', 'right', 'item']) {
      const box = document.querySelector(`.eqs[data-slot="${slot}"]`);
      const id = inv.equip[slot];
      const def = id && ITEMS[id];
      box.querySelector('.g').textContent = def ? def.glyph : '';
      box.querySelector('.n').textContent = def ? def.name : '';
      box.style.setProperty('--rc', def ? RARITY[def.rarity].color : 'transparent');
      box.classList.toggle('empty', !def);
      const c = box.querySelector('.c');
      c.textContent = def?.stack ? String(countOf(inv, id)) : '';
      box.querySelector('.k').textContent = shortKey(bindings[box.dataset.key]?.[0]);
    }
    document.querySelector('.eqs[data-slot="left"]').classList.toggle('lit', !!torchOn && inv.equip.left === 'pitch_torch');
    document.querySelectorAll('.mmo [data-action]').forEach((b) => {
      b.querySelector('kbd').textContent = b.dataset.action === 'menu' ? 'Esc' : keyName(bindings[b.dataset.action]?.[0]);
    });
  }

  update(dt, info, frameMs) {
    this.frames++; this.acc += dt;
    if (this.acc > 0.5) {
      this.fps = Math.round(this.frames / this.acc); this.frames = 0; this.acc = 0;
      this.el('perf').textContent = `${this.fps} fps · ${frameMs.toFixed(1)} ms`;
    }
    const s = this.stats;
    for (const k of ['hp', 'fp', 'st']) {
      const [cur, max] = s[k];
      // bar length grows with the maximum, like souls games
      this.el(`${k}bar`).style.width = `${Math.round(110 + max * (k === 'hp' ? 0.75 : k === 'fp' ? 1.2 : 1.9))}px`;
      this.el(`${k}fill`).style.width = `${(cur / max) * 100}%`;
      this.trail[k] = cur >= this.trail[k] ? cur : this.trail[k] - (this.trail[k] - cur) * Math.min(1, dt * 2.5);
      this.el(`${k}trail`).style.width = `${(this.trail[k] / max) * 100}%`;
    }
    this.el('level').textContent = String(s.level);
    this.el('runes').textContent = s.runes.toLocaleString();
    this.el('world').textContent = info;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = 0;
    }
  }

  loading(text, frac = 0) {
    const el = document.getElementById('loading');
    if (text === null) { el.style.opacity = 0; setTimeout(() => el.remove(), 700); return; }
    document.getElementById('loadtxt').textContent = text;
    document.getElementById('loadbar').style.width = `${Math.round(frac * 100)}%`;
  }

  setMenuMode(on) { document.body.classList.toggle('menu-mode', on); }
  setShowFps(on) { document.body.classList.toggle('hide-fps', !on); }
}
