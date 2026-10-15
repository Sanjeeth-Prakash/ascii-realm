// Title screen, pause menu, options and dialogs. Plain DOM over the game canvas.

import { ACTIONS, keyName } from '../core/settings.js';
import { formatPlaytime, placeName } from '../core/save.js';
import { WINDOW_SIZES } from '../core/display.js';
import { PALETTES } from '../render/AsciiRenderer.js';
import { CREDITS } from '../game/credits.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const newerVer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// ---------- ASCII title banner, rendered from a font at startup ----------
function makeBanner(text, cols) {
  const c = document.createElement('canvas');
  const CW = 6, CH = 12;                     // canvas pixels per character cell
  const W = cols, H = Math.round(cols * 0.09);
  c.width = W * CW; c.height = H * CH;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = c.height * 0.95;
  const font = (s) => `900 ${s}px "Times New Roman", Georgia, "DejaVu Serif", serif`;
  g.font = font(size);
  while (g.measureText(text).width > c.width * 0.97 && size > 8) { size -= 2; g.font = font(size); }
  g.fillText(text, c.width / 2, c.height * 0.54);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const ramp = " .,:;-=+*#%@";
  const rows = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let j = 0; j < CH; j += 2) for (let i = 0; i < CW; i += 2) sum += px[((y * CH + j) * c.width + x * CW + i) * 4];
      const v = sum / ((CW / 2) * (CH / 2) * 255);
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
    }
    rows.push(line.replace(/\s+$/, ''));
  }
  while (rows.length && !rows[0].trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return rows;
}

export class Menu {
  constructor({ settings, input, display, onContinue, onNewGame, onResume, onQuitToTitle, onExit, getSave, sound }) {
    this.sound = sound || (() => {});
    this.settings = settings;
    this.input = input;
    this.display = display;
    this.cb = { onContinue, onNewGame, onResume, onQuitToTitle, onExit };
    this.getSave = getSave;
    this.root = $('#ui');
    this.stack = [];        // open screens, top is active
    this.mode = 'title';    // title | pause | hidden
    this.buildTitle();
    this.buildPause();
    this.buildOptions();
    this.buildCredits();
    this.dialog = h('div', { class: 'dialog-wrap', hidden: true });
    this.root.append(this.dialog);

    window.addEventListener('keydown', (e) => this.onKey(e));
    this.bannerTimer = setInterval(() => this.shimmer(), 110);
  }

  // ---------------- title ----------------
  buildTitle() {
    const cols = 132;
    this.bannerRows = makeBanner('ASCII REALM', cols);
    this.banner = h('pre', { class: 'banner', 'aria-label': 'ASCII Realm' }, this.bannerRows.join('\n'));
    this.press = h('div', { class: 'press' }, 'PRESS ANY KEY');
    this.titleList = h('nav', { class: 'menu-list', hidden: true });
    this.saveInfo = h('div', { class: 'save-info', hidden: true });
    this.title = h('section', { class: 'screen title' },
      h('div', { class: 'title-top' }, this.banner, h('div', { class: 'tagline' }, 'a tale told in glyphs')),
      h('div', { class: 'title-bottom' }, this.press, this.titleList, this.saveInfo),
      h('footer', { class: 'title-foot' }, this.verEl = h('span', {}, 'early build'), h('span', { class: 'keys' }, '↑ ↓ select    Enter confirm    Esc back')),
    );
    this.root.append(this.title);
    fetch('./package.json').then((r) => r.json()).then((p) => { this.version = p.version; this.verEl.textContent = `v${p.version} · early build`; }).catch(() => {});
    this.checkUpdate();
    setInterval(() => { if (this.mode === 'title') this.checkUpdate(); }, 8000);
    const wake = (e) => {
      if (this.pressed || this.mode !== 'title') return;
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      this.pressed = true;
      this._wakeEvent = e;   // this key only wakes the menu, it doesn't pick an item
      this.press.hidden = true;
      this.showTitleMenu();
    };
    window.addEventListener('keydown', wake);
    window.addEventListener('mousedown', wake);
  }

  // desktop app: is there an update zip waiting in Downloads / Desktop?
  async checkUpdate() {
    if (!window.desktop?.checkUpdate) return;
    const before = `${this.update?.version}|${this.online?.version}`;
    try { this.update = (await window.desktop.checkUpdate()).update; } catch { this.update = null; }
    // online (GitHub releases): at most every 10 minutes
    if (window.desktop.checkOnline && (!this.onlineAt || performance.now() - this.onlineAt > 600000)) {
      this.onlineAt = performance.now();
      try { const r = await window.desktop.checkOnline(); this.online = r.update || null; } catch { this.online = null; }
    }
    const after = `${this.update?.version}|${this.online?.version}`;
    if (after !== before && this.mode === 'title' && this.pressed && !this.titleList.hidden && !this.stack.length) this.showTitleMenu();
  }

  async installOnline(plan) {
    const mb = fmtSize(plan.size);
    const notes = plan.notes ? `\n\n${plan.notes.slice(0, 400)}` : '';
    if (!(await this.confirm(`Update to v${plan.version}? It downloads ${mb}, saves your progress and restarts the game.${notes}`, 'Update now'))) return;
    this.cb.onExit?.();
    const bar = h('i', { class: 'upd-fill' });
    const label = h('p', {}, `Downloading v${plan.version}…`);
    this.dialog.replaceChildren(h('div', { class: 'dialog' }, label, h('div', { class: 'upd-bar' }, bar)));
    this.dialog.hidden = false;
    window.desktop.onUpdateProgress((f) => { bar.style.width = `${Math.round(f * 100)}%`; });
    const r = await window.desktop.installOnline(plan);
    if (r.ok) { label.textContent = `Updated to v${r.version}. Restarting…`; bar.style.width = '100%'; return; }
    this.dialog.hidden = true;
    await this.confirm(`The update couldn't be installed: ${r.error}. Your game is unchanged.`, 'OK', 'Close');
  }

  async pickUpdate() {
    const r = await window.desktop.pickUpdate();
    if (!r) return;
    if (r.error) { await this.confirm(`That file isn't an update: ${r.error}`, 'OK', 'Close'); return; }
    if (this.version && !newerVer(r.version, this.version)) { await this.confirm(`You already have v${this.version}; that file is v${r.version}.`, 'OK', 'Close'); return; }
    this.installUpdate(r.path, r.version);
  }

  async installUpdate(file, version) {
    if (!(await this.confirm(`Install update v${version}? Your progress is saved first and the game restarts.`, 'Install & restart'))) return;
    this.cb.onExit?.();
    this.dialog.replaceChildren(h('div', { class: 'dialog' }, h('p', {}, `Installing v${version}…`)));
    this.dialog.hidden = false;
    const r = await window.desktop.applyUpdate(file);
    if (r.ok) { this.dialog.replaceChildren(h('div', { class: 'dialog' }, h('p', {}, `Updated to v${r.version}. Restarting…`))); return; }
    this.dialog.hidden = true;
    await this.confirm(`The update couldn't be installed: ${r.error}`, 'OK', 'Close');
  }

  showTitleMenu() {
    const save = this.getSave();
    const items = [
      { label: 'Continue', disabled: !save, act: () => this.cb.onContinue() },
      { label: 'New Game', act: () => this.newGameFlow() },
      { label: 'Options', act: () => this.openOptions() },
      { label: 'Credits', act: () => this.openCredits() },
      { label: 'Exit', act: () => this.exitGame() },
    ];
    let first = save ? 0 : 1;
    if (this.online && (!this.update || newerVer(this.online.version, this.update.version))) {
      const o = this.online;
      items.unshift({ label: `Update to v${o.version}  (${fmtSize(o.size)})`, act: () => this.installOnline(o) });
      first = 0;
    } else if (this.update) {
      const u = this.update;
      items.unshift({ label: `Install update v${u.version}`, act: () => this.installUpdate(u.path, u.version) });
      first = 0;
    } else if (window.desktop?.pickUpdate) {
      // no update found automatically: choose the zip by hand
      items.splice(items.length - 1, 0, { label: 'Update from file…', act: () => this.pickUpdate() });
    }
    this.setList(this.titleList, items, first);
    this.titleList.hidden = false;
    if (save) {
      this.saveInfo.hidden = false;
      this.saveInfo.textContent = `${save.name} · LV ${save.stats?.level ?? 1} · ${placeName(save.pos[0], save.pos[2])} · ${formatPlaytime(save.playtime || 0)}`;
    } else this.saveInfo.hidden = true;
    this.activeList = this.titleList;
  }

  setList(nav, items, sel = 0) {
    nav.replaceChildren(...items.map((it, i) => {
      const b = h('button', { class: 'menu-item', disabled: it.disabled || false, 'data-i': i,
        onmouseenter: () => !it.disabled && this.select(nav, i),
        onclick: () => { if (!it.disabled) { this.sound('ui_select'); it.act(); } } }, h('span', { class: 'mark' }, '>'), h('span', {}, it.label));
      return b;
    }));
    nav._items = items;
    nav._sel = undefined;
    this.select(nav, sel);
  }

  select(nav, i) {
    if (nav._sel !== undefined && nav._sel !== i) this.sound('ui_move');
    nav._sel = i;
    [...nav.children].forEach((b, j) => b.classList.toggle('sel', j === i));
  }

  moveSel(nav, d) {
    const items = nav._items;
    let i = nav._sel;
    for (let k = 0; k < items.length; k++) {
      i = (i + d + items.length) % items.length;
      if (!items[i].disabled) break;
    }
    this.select(nav, i);
  }

  shimmer() {
    if (this.title.hidden) return;
    // a few glyphs in the title flicker like embers
    const rows = this.bannerRows.map((r) => r.split(''));
    const sw = { '#': '%', '%': '#', '@': '%', '*': '+', '+': '*', '=': '-' };
    for (let n = 0; n < 26; n++) {
      const y = Math.floor(Math.random() * rows.length);
      const x = Math.floor(Math.random() * rows[y].length);
      if (sw[rows[y][x]]) rows[y][x] = sw[rows[y][x]];
    }
    this.banner.textContent = rows.map((r) => r.join('')).join('\n');
  }

  showTitle() {
    this.mode = 'title';
    this.closeAll();
    this.title.hidden = false;
    this.pauseEl.hidden = true;
    if (this.pressed) this.showTitleMenu();
    this.checkUpdate();
  }

  hideAll() {
    this.mode = 'hidden';
    this.closeAll();
    this.title.hidden = true;
    this.pauseEl.hidden = true;
  }

  // ---------------- pause ----------------
  buildPause() {
    this.pauseList = h('nav', { class: 'menu-list' });
    this.pauseEl = h('section', { class: 'screen pause', hidden: true },
      h('div', { class: 'pause-box' }, h('div', { class: 'pause-title' }, '— PAUSED —'), this.pauseList, h('div', { class: 'pause-note', id: 'pause-note' })));
    this.root.append(this.pauseEl);
  }

  showPause(note = '') {
    this.mode = 'pause';
    this.pauseEl.hidden = false;
    $('#pause-note').textContent = note;
    this.setList(this.pauseList, [
      { label: 'Resume', act: () => this.cb.onResume() },
      { label: 'Options', act: () => this.openOptions() },
      { label: 'Quit to Title', act: () => this.cb.onQuitToTitle() },
      { label: 'Exit Game', act: () => this.exitGame() },
    ]);
    this.activeList = this.pauseList;
  }

  hidePause() { this.pauseEl.hidden = true; this.mode = 'hidden'; }

  // ---------------- options ----------------
  buildOptions() {
    this.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.optBody = h('div', { class: 'opt-body' });
    this.optEl = h('section', { class: 'screen options', hidden: true },
      h('div', { class: 'opt-panel' },
        h('header', { class: 'opt-head' }, h('div', { class: 'opt-title' }, 'OPTIONS'), this.tabs,
          h('button', { class: 'btn ghost', onclick: () => this.closeOptions() }, 'Back  [Esc]')),
        this.optBody));
    this.root.append(this.optEl);
    this.tabNames = ['Graphics', 'Audio', 'World', 'Controls'];
    this.tab = 'Graphics';
    this.tabs.replaceChildren(...this.tabNames.map((t) => h('button', { class: 'tab', role: 'tab', onclick: () => { this.tab = t; this.renderOptions(); } }, t)));
  }

  openOptions() {
    this.optEl.hidden = false;
    this.stack.push('options');
    this.renderOptions();
  }

  closeOptions() {
    if (this.input.capture) return;
    this.sound('ui_back');
    this.optEl.hidden = true;
    this.stack = this.stack.filter((s) => s !== 'options');
  }

  renderOptions() {
    [...this.tabs.children].forEach((b) => b.classList.toggle('on', b.textContent === this.tab));
    const s = this.settings;
    const body = [];
    const row = (label, hint, control) => h('div', { class: 'opt-row' },
      h('div', { class: 'opt-label' }, h('div', {}, label), hint ? h('div', { class: 'hint' }, hint) : null), h('div', { class: 'opt-ctl' }, control));
    const seg = (section, key, opts) => h('div', { class: 'seg' }, opts.map(([v, l]) =>
      h('button', { class: 'seg-btn' + (s.get(section)[key] === v ? ' on' : ''), onclick: () => { s.set(section, key, v); this.renderOptions(); } }, l)));
    const toggle = (section, key) => seg(section, key, [[true, 'On'], [false, 'Off']]);
    const slider = (section, key, min, max, step, fmt) => {
      const val = h('span', { class: 'val' }, fmt(s.get(section)[key]));
      const inp = h('input', { type: 'range', min, max, step, value: s.get(section)[key],
        oninput: (e) => { const v = Number(e.target.value); s.set(section, key, v); val.textContent = fmt(v); } });
      return h('div', { class: 'slider' }, inp, val);
    };

    if (this.tab === 'Graphics') {
      const pal = h('div', { class: 'palettes' }, PALETTES.map((p) => {
        const cols = p.colors.length ? p.colors : ['#0a0d0b', '#3f7a3a', '#ffb35c', '#9fb6d9'];
        return h('button', { class: 'pal' + (s.get('graphics').palette === p.id ? ' on' : ''), title: p.label,
          onclick: () => { s.set('graphics', 'palette', p.id); this.renderOptions(); } },
          h('span', { class: 'sw' }, cols.map((c) => h('i', { style: `background:${c}` }))), h('span', { class: 'pl' }, p.label));
      }));
      body.push(
        h('div', { class: 'opt-row stack' }, h('div', { class: 'opt-label' }, h('div', {}, 'Colour scheme'),
          h('div', { class: 'hint' }, 'Retro monitor looks, inspired by the 1-bit palettes of Return of the Obra Dinn.')), pal),
        row('Glyph size', 'Smaller is sharper; bigger is faster.', slider('graphics', 'glyphSize', 5, 14, 1, (v) => `${v}px`)),
        row('Detail', 'Auto lowers detail when the frame rate drops.', seg('graphics', 'detail', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
        row('Grass density', null, seg('graphics', 'grass', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
        row('Moon shadows', 'Shadows from trees and ruins.', toggle('graphics', 'shadows')),
        row('Show FPS', null, toggle('graphics', 'showFps')),
      );
      if (this.display.isDesktop) {
        const fs = s.get('graphics').display === 'fullscreen';
        body.unshift(
          row('Display mode', 'Borderless fullscreen covers the whole screen. F11 switches too.', seg('graphics', 'display', [['fullscreen', 'Borderless fullscreen'], ['windowed', 'Windowed']])),
          row('Window size', fs ? 'Used when the display mode is Windowed.' : null, seg('graphics', 'windowSize', WINDOW_SIZES)),
        );
      } else {
        body.push(row('Fullscreen', 'Browser version: hold Esc to leave fullscreen. The desktop app has full display options.',
          h('button', { class: 'btn', onclick: () => this.toggleFullscreen() }, document.fullscreenElement ? 'Exit fullscreen' : 'Go fullscreen')));
      }
    } else if (this.tab === 'Audio') {
      const pct = (v) => `${Math.round(v * 100)}%`;
      body.push(
        row('Mute all', 'Silences the whole game.', toggle('audio', 'muted')),
        row('Master volume', null, slider('audio', 'master', 0, 1, 0.05, pct)),
        row('Music', 'Title theme and the world track.', slider('audio', 'music', 0, 1, 0.05, pct)),
        row('Effects', 'Footsteps, swords, hits, thunder, menus.', slider('audio', 'effects', 0, 1, 0.05, pct)),
        row('Ambience', 'Rain, wind, crickets, birds and fires.', slider('audio', 'ambience', 0, 1, 0.05, pct)),
        h('p', { class: 'note' }, 'All music and sound in ASCII Realm is original, made for this game.'),
      );
    } else if (this.tab === 'World') {
      body.push(
        row('Time of day', null, seg('world', 'time', [['night', 'Night'], ['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk']])),
        row('Weather', null, seg('world', 'weather', [['clear', 'Clear'], ['rain', 'Rain']])),
        h('p', { class: 'note' }, 'Changes apply to your world right away. The title screen keeps its own scenes.'),
      );
    } else {
      body.push(
        row('Capture mouse', 'The cursor locks to the game and moving the mouse turns the camera. Esc frees it.', toggle('camera', 'mouseCapture')),
        row('Mouse sensitivity', 'Also used by the rotate keys and middle-mouse drag.', slider('camera', 'sensitivity', 0.3, 2, 0.1, (v) => v.toFixed(1) + '×')),
        row('Invert horizontal', null, toggle('camera', 'invert')),
        row('Invert vertical', null, toggle('camera', 'invertY')),
      );
      let group = '';
      const table = h('div', { class: 'binds' });
      for (const a of ACTIONS) {
        if (a.group !== group) { group = a.group; table.append(h('div', { class: 'bind-group' }, group)); }
        const keys = s.data.bindings[a.id];
        const keyBtn = (slot) => h('button', { class: 'key' + (keys[slot] ? '' : ' empty'), onclick: (e) => this.rebind(a.id, slot, e.currentTarget) }, keyName(keys[slot]));
        table.append(h('div', { class: 'bind-row' },
          h('div', { class: 'bind-label' }, a.label, a.soon ? h('span', { class: 'soon' }, 'coming soon') : null),
          keyBtn(0), keyBtn(1)));
      }
      table.append(h('div', { class: 'bind-group' }, 'Fixed'),
        h('div', { class: 'bind-row fixed' }, h('div', { class: 'bind-label' }, 'Pause menu'), h('span', { class: 'key fixedkey' }, 'Esc'), h('span', {})),
        h('div', { class: 'bind-row fixed' }, h('div', { class: 'bind-label' }, 'Zoom'), h('span', { class: 'key fixedkey' }, 'Mouse wheel'), h('span', {})),
        h('div', { class: 'bind-row fixed' }, h('div', { class: 'bind-label' }, 'Look around'), h('span', { class: 'key fixedkey' }, 'Mouse'), h('span', { class: 'key fixedkey' }, 'Middle-drag')));
      body.push(
        h('p', { class: 'note' }, 'Click a key to change it, then press the new key or mouse button. Esc cancels, Backspace clears.'),
        table,
        h('div', { class: 'opt-actions' }, h('button', { class: 'btn', onclick: () => { s.resetBindings(); this.renderOptions(); } }, 'Reset controls to default')),
      );
    }
    this.optBody.replaceChildren(...body);
  }

  rebind(id, slot, btn) {
    if (this.input.capture) return;
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    this.input.captureNext((code) => {
      if (code === 'Backspace' || code === 'Delete') this.settings.unbind(id, slot);
      else if (code) this.settings.bind(id, slot, code);
      this.renderOptions();
    });
  }

  toggleFullscreen() {
    this.display.toggleBrowserFullscreen().finally(() => setTimeout(() => this.renderOptions(), 150));
  }

  // ---------------- dialogs ----------------
  confirm(text, okLabel, cancelLabel = 'Cancel') {
    return new Promise((resolve) => {
      const done = (v) => { this.dialog.hidden = true; this.stack = this.stack.filter((s) => s !== 'dialog'); resolve(v); };
      const ok = h('button', { class: 'btn primary', onclick: () => done(true) }, okLabel);
      this.dialog.replaceChildren(h('div', { class: 'dialog' }, h('p', {}, text),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => done(false) }, cancelLabel), ok)));
      this._dialogCancel = () => done(false);
      this.dialog.hidden = false;
      this.stack.push('dialog');
      ok.focus();
    });
  }

  askName(def) {
    return new Promise((resolve) => {
      const inp = h('input', { class: 'name-input', maxlength: 16, value: def, spellcheck: 'false', autocomplete: 'off' });
      const done = (v) => { this.dialog.hidden = true; this.stack = this.stack.filter((s) => s !== 'dialog'); resolve(v); };
      const go = () => done((inp.value.trim() || def).slice(0, 16));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      this.dialog.replaceChildren(h('div', { class: 'dialog' },
        h('div', { class: 'dialog-title' }, 'Name your wanderer'), inp,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Begin'))));
      this._dialogCancel = () => done(null);
      this.dialog.hidden = false;
      this.stack.push('dialog');
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
  }

  async newGameFlow() {
    const save = this.getSave();
    if (save && !(await this.confirm(`Start a new journey? ${save.name}'s save (${formatPlaytime(save.playtime || 0)} played) will be replaced.`, 'Start new'))) return;
    const name = await this.askName(save?.name || 'Wanderer');
    if (name) this.cb.onNewGame(name);
  }

  async exitGame() {
    if (this.display.isDesktop) { this.cb.onExit?.(); window.desktop.quit(); return; }
    await this.confirm('Thanks for playing. You can close this browser tab now; your progress is saved.', 'OK', 'Back');
  }

  // ---------------- keyboard ----------------
  onKey(e) {
    if (this.input.capture || e === this._wakeEvent) return;
    const top = this.stack[this.stack.length - 1];
    if (top === 'dialog') { if (e.key === 'Escape') this._dialogCancel?.(); return; }
    if (top === 'options') { if (e.key === 'Escape') this.closeOptions(); return; }
    if (top === 'credits') { if (e.key === 'Escape' || e.key === 'Enter') this.closeCredits(); return; }
    if (this.mode === 'hidden') return;
    if (this.mode === 'title' && !this.pressed) return;
    const nav = this.activeList;
    if (!nav || nav.hidden) return;
    if (['ArrowDown', 's', 'S'].includes(e.key)) { this.moveSel(nav, 1); e.preventDefault(); }
    else if (['ArrowUp', 'w', 'W'].includes(e.key)) { this.moveSel(nav, -1); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { const it = nav._items[nav._sel]; if (it && !it.disabled) { this.sound('ui_select'); it.act(); } e.preventDefault(); }
    else if (e.key === 'Escape' && this.mode === 'pause') { e.preventDefault(); this.cb.onResume(); }
  }

  // ---------------- credits ----------------
  buildCredits() {
    const groups = CREDITS.map((g) => h('div', { class: 'cred-group' },
      h('div', { class: 'cred-head' }, g.group),
      g.items.map((it) => h('div', { class: 'cred-row' },
        h('div', { class: 'cred-what' }, it.what),
        h('div', { class: 'cred-who' }, it.who, it.url ? h('span', { class: 'cred-url' }, ' · ' + it.url.replace(/^https?:\/\//, '')) : null),
        h('div', { class: 'cred-lic' }, it.license)))));
    this.credEl = h('section', { class: 'screen options credits', hidden: true },
      h('div', { class: 'opt-panel' },
        h('header', { class: 'opt-head' }, h('div', { class: 'opt-title' }, 'CREDITS'), h('div', {}),
          h('button', { class: 'btn ghost', onclick: () => this.closeCredits() }, 'Back  [Esc]')),
        h('div', { class: 'opt-body' },
          h('p', { class: 'note' }, 'ASCII Realm is made from the work of these people and projects. Thank you.'),
          groups,
          h('p', { class: 'note' }, 'Full details and licenses are in CREDITS.md in the game folder.'))));
    this.root.append(this.credEl);
  }

  openCredits() { this.credEl.hidden = false; this.stack.push('credits'); }
  closeCredits() { this.sound('ui_back'); this.credEl.hidden = true; this.stack = this.stack.filter((s) => s !== 'credits'); }

  closeAll() {
    if (this.credEl) this.credEl.hidden = true;
    this.optEl.hidden = true;
    this.dialog.hidden = true;
    this.stack = [];
  }

  get blocking() { return this.stack.length > 0; }
}
