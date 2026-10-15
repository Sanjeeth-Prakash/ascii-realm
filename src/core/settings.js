// Player settings + key bindings, saved in the browser's local storage.

const KEY = 'asciirealm.settings.v1';

// Every bindable action. `soon` = reserved for features still being built.
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', group: 'Movement', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move back', group: 'Movement', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Move left', group: 'Movement', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Move right', group: 'Movement', keys: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Sprint', group: 'Movement', keys: ['ShiftLeft'] },
  { id: 'dodge', label: 'Dodge roll', group: 'Combat', keys: ['Space'] },
  { id: 'light', label: 'Light attack', group: 'Combat', keys: ['Mouse0'] },
  { id: 'heavy', label: 'Heavy attack', group: 'Combat', keys: ['Mouse2'] },
  { id: 'lockon', label: 'Lock on', group: 'Combat', keys: ['KeyQ', 'Mouse1'] },
  { id: 'spell', label: 'Cast spell', group: 'Combat', keys: ['KeyC'], soon: true },
  { id: 'flask', label: 'Drink flask', group: 'Items', keys: ['KeyR'] },
  { id: 'torch', label: 'Torch', group: 'Items', keys: ['KeyF'] },
  { id: 'interact', label: 'Interact', group: 'Items', keys: ['KeyE'] },
  { id: 'steed', label: 'Summon steed', group: 'Items', keys: ['KeyV'], soon: true },
  { id: 'inventory', label: 'Inventory', group: 'Menus', keys: ['KeyI', 'Tab'] },
  { id: 'skills', label: 'Skills', group: 'Menus', keys: ['KeyK'], soon: true },
  { id: 'map', label: 'Map', group: 'Menus', keys: ['KeyM'], soon: true },
  { id: 'quests', label: 'Quests', group: 'Menus', keys: ['KeyJ'], soon: true },
  { id: 'camLeft', label: 'Rotate camera left', group: 'Camera', keys: ['KeyZ'] },
  { id: 'camRight', label: 'Rotate camera right', group: 'Camera', keys: ['KeyX'] },
];

export const DEFAULTS = {
  graphics: {
    display: 'fullscreen', // fullscreen (borderless) | windowed  — desktop app
    windowSize: '1600x900',
    palette: 'full',     // colour scheme (see PALETTES in AsciiRenderer.js)
    glyphSize: 7,        // CSS px per character cell
    detail: 'auto',      // auto | low | medium | high  (scene samples per cell)
    shadows: true,
    grass: 'high',       // low | medium | high
    showFps: true,
  },
  world: {
    time: 'night',       // night | dawn | day | dusk
    weather: 'clear',    // clear | rain
  },
  audio: {
    master: 0.8,
    music: 0.6,
    effects: 0.85,
    ambience: 0.7,
    muted: false,
  },
  camera: {
    mouseCapture: true,  // lock the cursor to the game; the mouse turns the camera
    sensitivity: 1.0,
    invert: false,       // horizontal
    invertY: false,
  },
  bindings: Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])),
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function merge(base, over) {
  const out = clone(base);
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (over[k] === undefined) continue;
    if (k === 'bindings') {
      for (const id of Object.keys(out.bindings)) if (Array.isArray(over.bindings[id])) out.bindings[id] = over.bindings[id].slice(0, 2);
    } else if (typeof out[k] === 'object') out[k] = { ...out[k], ...over[k] };
    else out[k] = over[k];
  }
  return out;
}

export class Settings {
  constructor() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY)); } catch { /* storage unavailable */ }
    this.data = merge(DEFAULTS, stored);
    this.listeners = new Set();
  }

  get(section) { return this.data[section]; }

  set(section, key, value) {
    this.data[section][key] = value;
    this.save();
    this.listeners.forEach((fn) => fn(section, key, value));
  }

  onChange(fn) { this.listeners.add(fn); }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  // Bind `code` to slot `slot` (0 or 1) of action `id`. A key can only do one
  // thing: it's removed from whatever action had it before.
  bind(id, slot, code) {
    const b = this.data.bindings;
    for (const other of Object.keys(b)) b[other] = b[other].map((k) => (k === code ? null : k));
    b[id][slot] = code;
    b[id] = b[id].slice(0, 2);
    this.save();
    this.listeners.forEach((fn) => fn('bindings', id, b[id]));
  }

  unbind(id, slot) {
    this.data.bindings[id][slot] = null;
    this.save();
  }

  resetBindings() {
    this.data.bindings = clone(DEFAULTS.bindings);
    this.save();
    this.listeners.forEach((fn) => fn('bindings', null, null));
  }

  resetAll() {
    const bindings = this.data.bindings;
    this.data = clone(DEFAULTS);
    this.data.bindings = bindings;
    this.save();
    this.listeners.forEach((fn) => fn('all', null, null));
  }
}

const NAMES = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Backspace', Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', Minus: '-', Equal: '=',
};

export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
