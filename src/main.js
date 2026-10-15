import * as THREE from 'three';
import { AsciiRenderer, PALETTES } from './render/AsciiRenderer.js';
import { createShared, TRAIL_LEN } from './render/lighting.js';
import { MoonShadows } from './render/shadows.js';
import { createTerrain } from './world/terrain.js';
import { createGrass } from './world/grass.js';
import { createTrees } from './world/trees.js';
import { createRuins } from './world/ruins.js';
import { createWater } from './world/water.js';
import { createFireflies } from './world/fireflies.js';
import { TorchSystem } from './world/torches.js';
import { Cobwebs } from './world/cobwebs.js';
import { Weather } from './world/weather.js';
import { terrainHeight, RUINS } from './world/terrainMath.js';
import { Player } from './entities/player.js';
import { Enemies } from './entities/enemies.js';
import { Combat } from './game/combat.js';
import { Audio } from './core/audio.js';
import { Wildlife } from './entities/wildlife.js';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { Settings } from './core/settings.js';
import { loadSave, writeSave, placeName } from './core/save.js';
import { Cinematic } from './game/cinematic.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Portrait } from './ui/portrait.js';
import { InventoryUI } from './ui/inventory.js';
import { newInventory, countOf, addItem, useItem, setCount, ITEMS } from './game/items.js';
import { newProgress, migrateProgress, derived, attackMult, flaskHeal } from './game/stats.js';
import { ShrineUI } from './ui/shrine.js';
import { Pickups } from './world/pickups.js';
import { shortKey } from './ui/hud.js';
import { Display } from './core/display.js';

const params = new URLSearchParams(location.search); // test hooks only
const settings = new Settings();
const display = new Display(settings);
const hud = new Hud();
hud.loading('Loading models', 0);
const audio = new Audio(settings);
audio.playMusic('theme');

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
document.body.prepend(renderer.domElement);

const ascii = new AsciiRenderer(renderer);
const camera = new THREE.PerspectiveCamera(38, ascii.aspect, 0.5, 400);
const scene = new THREE.Scene();
const shared = createShared();
const shadows = new MoonShadows(renderer, shared);

const assets = await loadAssets({
  hero: './assets/models/hero.glb',
  skelMinion: './assets/kaykit/skeletons/Skeleton_Minion.glb',
  skelWarrior: './assets/kaykit/skeletons/Skeleton_Warrior.glb',
  skelBlade: './assets/kaykit/skeletons/props/Skeleton_Blade.gltf',
  skelAxe: './assets/kaykit/skeletons/props/Skeleton_Axe.gltf',
  fox: './assets/models/fox.glb',
  stork: './assets/models/stork.glb',
}, (n, total) => hud.loading('Loading models', n / total));

// ---------- world ----------
const colliders = [];
scene.add(createTerrain(shared));
const GRASS_DENSITY = { low: 18, medium: 28, high: 40 };
const overlay = new THREE.Scene();   // glyph-art layer: grass strokes, web threads, sparks
const OU = ascii.overlayUniforms;
let grass = createGrass(shared, OU, { density: GRASS_DENSITY[settings.get('graphics').grass] });
overlay.add(grass);
const trees = createTrees(shared, colliders);
scene.add(trees);
const ruins = createRuins(shared, colliders);
scene.add(ruins.group);
scene.add(createWater(shared));
const fireflies = createFireflies(shared, OU);
overlay.add(fireflies);

const torches = new TorchSystem(scene, shared, overlay, OU);
ruins.torches.forEach((t) => torches.add(t));
const weather = new Weather(shared);

const player = new Player(scene, shared, colliders, assets.hero);
const enemies = new Enemies(scene, shared, assets, colliders);
const heldTorch = torches.add({ carried: true, radius: 9, intensity: 1.05 });
const wildlife = new Wildlife(scene, shared, assets);
const cobwebs = new Cobwebs(overlay, shared, OU, trees.userData.trees, torches);

const input = new Input(settings, renderer.domElement);
const portrait = new Portrait(renderer, assets.hero, document.createElement('canvas'), { cw: 7, ch: 10 });
hud.showGpu(renderer);

// ---------- camera rig (gameplay) ----------
const cam = {
  yaw: 0, yawTarget: 0,
  dist: 17, distTarget: 17,
  pitch: THREE.MathUtils.degToRad(52),
  pitchTarget: THREE.MathUtils.degToRad(52),
  target: new THREE.Vector3(),
};

// ---------- game state ----------
let state = 'title';          // title | playing | paused
let save = loadSave();
const game = { name: 'Wanderer', playtime: 0, autosave: 0, inv: newInventory(), lostRunes: null, dying: null, rested: null, progress: newProgress(), regen: null };
const SHRINE = { x: 0, z: -2.5 };                 // the altar: rest here
const RESPAWN = { x: 0, z: 0.4, yaw: 0 };
const diedEl = document.getElementById('died');
const fadeEl = document.getElementById('fade');
const cinematic = new Cinematic({ player, weather, camera, fadeEl, cobwebs });

function snapshot() {
  return {
    name: game.name,
    pos: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw,
    torch: player.torchOn,
    stats: JSON.parse(JSON.stringify(hud.stats)),
    playtime: game.playtime,
    inv: JSON.parse(JSON.stringify(game.inv)),
    lostRunes: game.lostRunes,
    progress: JSON.parse(JSON.stringify(game.progress)),
  };
}

// max HP / FP / stamina and level follow the attributes; `fill` tops everything up
function applyProgress(fill) {
  const d = derived(game.progress), s = hud.stats;
  s.hp[1] = d.hp; s.fp[1] = d.fp; s.st[1] = d.st; s.level = d.level;
  for (const k of ['hp', 'fp', 'st']) s[k][0] = fill ? s[k][1] : Math.min(s[k][0], s[k][1]);
}
const weaponPower = () => Math.round((player.weapon === 'sword' ? 28 : 14) * attackMult(game.progress.attrs, player.weapon));
function saveGame() {
  if (state === 'title') return;
  writeSave(snapshot());
  save = loadSave();
}

function enterWorld({ name, pos, yaw, torch, stats, playtime, inv, lostRunes, progress }) {
  cinematic.stop();
  game.name = name; game.playtime = playtime || 0; game.autosave = 0;
  game.inv = inv ? JSON.parse(JSON.stringify(inv)) : newInventory();
  game.lostRunes = lostRunes || null;
  game.dying = null; game.rested = null;
  diedEl.classList.remove('on', 'rest');
  player.revive();
  player.lockTarget = null;
  enemies.resetAll();
  equipWeapon();
  bloodstain.on = !!game.lostRunes;
  if (game.lostRunes) bloodstain.pos.set(game.lostRunes.x, terrainHeight(game.lostRunes.x, game.lostRunes.z) + 0.3, game.lostRunes.z);
  player.pos.set(pos[0], terrainHeight(pos[0], pos[2]), pos[2]);
  player.vel.set(0, 0, 0);
  player.yaw = yaw;
  player.torchOn = torch;
  player.winded = false;
  if (stats) Object.assign(hud.stats, JSON.parse(JSON.stringify(stats)));
  game.progress = migrateProgress(progress);
  pickups.load(game.progress.picked);
  game.regen = null;
  applyProgress(false);
  hud.stats.st[0] = hud.stats.st[1];
  if (hud.stats.hp[0] <= 0) hud.stats.hp[0] = hud.stats.hp[1];
  hud.setName(name);
  cam.yaw = cam.yawTarget = 0;
  cam.pitch = cam.pitchTarget = THREE.MathUtils.degToRad(52);
  cam.target.copy(player.pos).add(new THREE.Vector3(0, 1, 0));
  cobwebs.resetAll();
  applyWorldSettings(true);
  trail.length = 0;
  state = 'playing';
  menu.hideAll();
  hud.setMenuMode(false);
  input.setEnabled(true);
  captureMouse();
  refreshHud();
  audio.playMusic('world', 3);
  audio.setDuck(1);
  hud.toast(placeName(pos[0], pos[2]));
}

function newGame(name) {
  const p = newProgress(), d = derived(p);
  hud.stats.hp = [d.hp, d.hp]; hud.stats.fp = [d.fp, d.fp]; hud.stats.st = [d.st, d.st];
  hud.stats.level = d.level; hud.stats.runes = 0;
  enterWorld({ name, pos: [0, 0, 4.5], yaw: Math.PI, torch: true, stats: hud.stats, playtime: 0, inv: newInventory(), progress: p });
  saveGame();
}

function continueGame() {
  save = loadSave();
  if (save) enterWorld(save);
}

function pause() {
  if (state !== 'playing') return;
  if (inventory.open) closeInventory(false);
  saveGame();
  state = 'paused';
  input.setEnabled(false);
  input.unlock();
  menu.showPause('Progress saved.');
  audio.setDuck(0.45);
}

function resume() {
  if (state !== 'paused') return;
  menu.hidePause();
  menu.closeAll();
  state = 'playing';
  input.setEnabled(true);
  captureMouse();
  audio.setDuck(1);
}

// ---------- mouse capture: the cursor locks to the game while you play ----------
function captureMouse() {
  if (settings.get('camera').mouseCapture && state === 'playing' && !inventory.open && !shrine?.open) input.lock();
}
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('cursor-locked', input.locked);
  // Esc (or alt-tab) released the cursor: open the pause menu, like any PC game
  if (!input.locked && state === 'playing' && !inventory.open && !shrine.open && settings.get('camera').mouseCapture) pause();
});
renderer.domElement.addEventListener('mousedown', () => { if (state === 'playing') captureMouse(); });

// ---------- inventory ----------
function openInventory() {
  audio.play('ui_open', { vol: 0.7 });
  inventory.show();
  portrait.update(1, player);   // draw right away, not on the next tick
  document.body.classList.add('inv-open');
  input.unlock();
}
function closeInventory(recapture = true) {
  audio.play('ui_back', { vol: 0.6 });
  inventory.hide();
  document.body.classList.remove('inv-open');
  if (recapture) captureMouse();
}
function refreshHud() { hud.refreshEquip(game.inv, settings.data.bindings, player.torchOn); }
function equipWeapon() { player.setWeapon(game.inv.equip.right === 'worn_longsword' ? 'sword' : 'unarmed'); }

function quitToTitle() {
  input.unlock();
  saveGame();
  state = 'title';
  input.setEnabled(false);
  hud.setMenuMode(true);
  game.dying = null; game.rested = null;
  diedEl.classList.remove('on', 'rest');
  hud.prompt(null);
  shrine.hide();
  player.revive();
  player.lockTarget = null;
  bloodstain.on = false;
  enemies.resetAll();
  cinematic.start();
  menu.showTitle();
  audio.playMusic('theme', 3);
  audio.setDuck(1);
}

const menu = new Menu({
  settings, input, display,
  onExit: saveGame,
  getSave: () => save,
  onContinue: continueGame,
  onNewGame: newGame,
  onResume: resume,
  onQuitToTitle: quitToTitle,
  sound: (n) => audio.play(n, { vol: n === 'ui_move' ? 0.45 : 0.7 }),
});

const inventory = new InventoryUI({
  settings,
  portraitCanvas: portrait.canvas,
  getInv: () => game.inv,
  getStats: () => ({ ...hud.stats, attack: weaponPower() }),
  onUse: (id) => useConsumable(id),
  onChange: () => { if (game.inv.equip.left !== 'pitch_torch') player.torchOn = false; equipWeapon(); refreshHud(); audio.play('ui_select', { vol: 0.5 }); },
});
inventory.onRequestClose = () => closeInventory();
document.querySelectorAll('.mmo [data-action]').forEach((b) => b.addEventListener('click', () => {
  if (state !== 'playing') return;
  if (b.dataset.action === 'inventory') (inventory.open ? closeInventory() : openInventory());
  if (b.dataset.action === 'menu') pause();
}));

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || state !== 'playing' || input.capture || shrine.open || e.shrineHandled) return;
  e.preventDefault();
  if (inventory.open) closeInventory(); else pause();
});
window.addEventListener('beforeunload', saveGame);

// drop an ASCII-Realm-Update-x.y.z.zip on the window to install it
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  const m = f && /^ASCII-Realm-Update-(\d+\.\d+\.\d+)/i.exec(f.name);
  if (!m || !window.desktop?.pathForFile) { if (f) hud.toast('Drop an ASCII-Realm-Update zip here'); return; }
  if (state === 'playing') pause();
  menu.installUpdate(window.desktop.pathForFile(f), m[1]);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

// ---------- settings, applied live ----------
const perf = { t: 0, frames: 0, cooldown: 3 };
const DETAIL = { low: 2, medium: 3, high: 4 };

// HUD and menus take on the colours of the chosen scheme
function applyTheme(p) {
  const root = document.documentElement.style;
  const vars = ['--ember', '--ink', '--dim', '--hp', '--fp', '--st', '--hi', '--panel'];
  if (!p.colors.length) { vars.forEach((v) => root.removeProperty(v)); portrait.palette = null; return; }
  const c = p.colors, fg = c[c.length - 1], mid = c[Math.max(1, c.length - 2)];
  const hex = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  root.setProperty('--ember', fg); root.setProperty('--ink', fg); root.setProperty('--hi', fg);
  root.setProperty('--dim', c.length > 2 ? mid : hex(fg, 0.55));
  ['--hp', '--fp', '--st'].forEach((v) => root.setProperty(v, fg));
  root.setProperty('--panel', hex(c[0], 0.85));
  portrait.palette = c;
}

function applyGraphics() {
  const g = settings.get('graphics');
  applyTheme(ascii.setPalette(g.palette));
  ascii.setCellSize(g.glyphSize);
  if (g.detail !== 'auto') ascii.setQuality(DETAIL[g.detail]);
  onResize();
  hud.setShowFps(g.showFps);
  if (!g.shadows) shared.uShadowOn.value = 0;
}

function rebuildGrass() {
  overlay.remove(grass);
  grass.userData.dispose();
  grass = createGrass(shared, OU, { density: GRASS_DENSITY[settings.get('graphics').grass] });
  overlay.add(grass);
}

function applyWorldSettings(instant) {
  const w = settings.get('world');
  if (instant) weather.setTime(w.time); else weather.timeName = w.time;
  weather.rainTarget = w.weather === 'rain' ? 1 : 0;
  if (instant) weather.rain = weather.rainTarget;
}

settings.onChange((section, key) => {
  if (section === 'graphics' && (key === 'display' || key === 'windowSize')) { display.apply(); return; }
  if (section === 'graphics' || section === 'all') {
    if (key === 'grass' || section === 'all') rebuildGrass();
    applyGraphics();
  }
  if (section === 'bindings' && state !== 'title') refreshHud();
  if ((section === 'world' || section === 'all') && state !== 'title') applyWorldSettings(false);
});

// ---------- combat ----------
const bloodstain = torches.add({ noFlame: true, radius: 3.2, intensity: 0.8, on: false, color: new THREE.Vector3(1.0, 0.32, 0.18) });
const combat = new Combat({
  player, enemies, torches, audio, camera,
  hooks: {
    attackMult: () => attackMult(game.progress.attrs, player.weapon),
    onPlayerHit(dmg, from, heavy) {
      const hp = hud.stats.hp;
      hp[0] = Math.max(0, hp[0] - dmg);
      if (hp[0] <= 0) playerDied();
      else player.takeHit(from.pos.x, from.pos.z, heavy);
    },
    onKill(e) {
      hud.stats.runes += e.def.runes;
      audio.play('runes', { vol: 0.55, delay: 0.35 });
      // monster materials, and now and then something useful
      const n = e.kind === 'warrior' ? 2 : Math.random() < 0.5 ? 1 : 0;
      if (n && addItem(game.inv, 'bone_shard', n)) setTimeout(() => hud.toast(`${ITEMS.bone_shard.name}  ×${n}`), 900);
      if (Math.random() < (e.kind === 'warrior' ? 0.5 : 0.15) && addItem(game.inv, 'amber_moss', 1)) setTimeout(() => hud.toast(`${ITEMS.amber_moss.name}  ×1`), 1900);
      if (inventory.open) inventory.render?.();
    },
  },
});

function playerDied() {
  player.die();
  audio.play('died', { vol: 0.9, delay: 0.6 });
  audio.setDuck(0.25);
  game.dying = 0;
  // runes stay where you fell; die again before reaching them and they're gone
  const r = hud.stats.runes;
  game.lostRunes = r > 0 ? { x: player.pos.x, z: player.pos.z, amount: r } : null;
  hud.stats.runes = 0;
  bloodstain.on = false;
}

function updateDeath(dt) {
  if (game.dying === null) return;
  game.dying += dt;
  const t = game.dying;
  if (t > 1.3 && !diedEl.classList.contains('on')) { diedEl.querySelector('.w').textContent = 'YOU DIED'; diedEl.classList.remove('rest'); diedEl.classList.add('on'); }
  if (t > 5.0) fadeEl.style.opacity = Math.min(1, (t - 5.0) / 0.9).toFixed(3);
  if (t > 6.2) {
    // wake at the shrine: full health, flasks refilled, the dead walk again
    game.dying = null;
    diedEl.classList.remove('on');
    player.revive();
    player.pos.set(RESPAWN.x, terrainHeight(RESPAWN.x, RESPAWN.z), RESPAWN.z);
    player.yaw = RESPAWN.yaw;
    cam.yaw = cam.yawTarget = RESPAWN.yaw;
    cam.target.copy(player.pos).add(new THREE.Vector3(0, 1, 0));
    refill();
    enemies.resetAll();
    if (game.lostRunes) {
      bloodstain.on = true;
      bloodstain.pos.set(game.lostRunes.x, terrainHeight(game.lostRunes.x, game.lostRunes.z) + 0.3, game.lostRunes.z);
    }
    audio.setDuck(1);
    trail.length = 0;
    fadeEl.style.opacity = 0;
    fadeEl.style.transition = 'opacity 1.4s';
    setTimeout(() => { fadeEl.style.transition = ''; }, 1500);
    refreshHud();
    saveGame();
  }
}

function refill() {
  const s = hud.stats;
  s.hp[0] = s.hp[1]; s.fp[0] = s.fp[1]; s.st[0] = s.st[1];
  setCount(game.inv, 'crimson_flask', game.progress.flaskMax);
  game.regen = null;
  refreshHud();
}

function restAtShrine() {
  player.startRest();
  audio.play('rest', { vol: 0.8 });
  refill();
  enemies.resetAll();
  game.rested = 0;
  diedEl.querySelector('.w').textContent = 'FLAME OF FIRST LIGHT';
  diedEl.classList.add('rest', 'on');
  saveGame();
  // once seated, the shrine menu opens (level up, flasks)
  setTimeout(() => {
    if (state !== 'playing' || player.state !== 'rest' || player.standing) return;
    diedEl.classList.remove('on');
    input.unlock();
    shrine.show();
  }, 1600);
}

const shrine = new ShrineUI({
  getProgress: () => game.progress,
  getStats: () => hud.stats,
  getInv: () => game.inv,
  getWeapon: () => player.weapon,
  sound: (n) => audio.play(n, { vol: n === 'ui_move' ? 0.45 : 0.7 }),
  onLevel(attrs, cost) {
    hud.stats.runes -= cost;
    game.progress.attrs = attrs;
    applyProgress(true);
    hud.toast(`Level ${hud.stats.level}`);
    saveGame();
  },
  onFlask(kind, n) {
    const p = game.progress;
    if (kind === 'seed' && useItem(game.inv, 'golden_seed', n)) p.flaskMax++;
    if (kind === 'tear' && useItem(game.inv, 'sacred_tear', 1)) p.flaskLvl++;
    setCount(game.inv, 'crimson_flask', p.flaskMax);
    refreshHud();
    saveGame();
  },
  onClose() { player.standUp(); captureMouse(); },
});

const pickups = new Pickups(torches);

function useConsumable(id) {
  const def = ITEMS[id];
  if (!def?.use || !player.alive || !useItem(game.inv, id)) return;
  if (def.use === 'regen') {
    // heal 30% of max HP over 12 seconds
    game.regen = { t: 12, rate: hud.stats.hp[1] * 0.3 / 12 };
    audio.play('flask', { vol: 0.5, rate: 1.2 });
    hud.toast('Amber Moss: healing over time');
  } else if (def.use === 'runes') {
    hud.stats.runes += 400;
    audio.play('runes', { vol: 0.8 });
    torches.burst(player.pos.clone().setY(player.pos.y + 1.2), 20, 0.6);
    hud.toast('+400 runes');
  }
  refreshHud();
}

// "[E] Rest" / "[E] Retrieve runes" prompts, and acting on them
function updateInteract(ctl) {
  const key = shortKey(settings.data.bindings.interact?.[0]);
  const pressed = input.tapped('interact');
  if (shrine.open) { hud.prompt(null); return; }
  if (game.rested !== null) {
    if (game.rested > 2.6) diedEl.classList.remove('on');
    if (player.state === 'rest') {
      hud.prompt(key, 'Stand up');
      if (game.rested > 1.2 && (pressed || Math.hypot(ctl.x, ctl.z) > 0.3 || input.tapped('dodge'))) player.standUp();
      return;
    }
    if (game.rested > 2.6) { game.rested = null; diedEl.classList.remove('rest'); }
  }
  if (!player.alive || player.busy || game.dying !== null) { hud.prompt(null); return; }
  if (game.lostRunes && Math.hypot(player.pos.x - game.lostRunes.x, player.pos.z - game.lostRunes.z) < 1.8) {
    hud.prompt(key, `Retrieve lost runes (${game.lostRunes.amount.toLocaleString()})`);
    if (pressed) {
      hud.stats.runes += game.lostRunes.amount;
      game.lostRunes = null;
      bloodstain.on = false;
      audio.play('runes', { vol: 0.8 });
      torches.burst(bloodstain.pos, 24, 0.9);
    }
    return;
  }
  const item = pickups.nearest(player.pos);
  if (item) {
    const def = ITEMS[item.item];
    hud.prompt(key, `Pick up ${def.name}${item.n > 1 ? ` ×${item.n}` : ''}`);
    if (pressed && addItem(game.inv, item.item, item.n)) {
      pickups.take(item);
      game.progress.picked.push(item.id);
      audio.play('runes', { vol: 0.5, rate: 1.3 });
      hud.toast(`${def.name}  ×${item.n}`);
      refreshHud();
    }
    return;
  }
  if (Math.hypot(player.pos.x - SHRINE.x, player.pos.z - SHRINE.z) < 3.3) {
    hud.prompt(key, 'Rest at the shrine');
    if (pressed) restAtShrine();
    return;
  }
  hud.prompt(null);
}

// ---------- sound for what happened this frame ----------
const STONE = (x, z) => Math.hypot(x, z) < 7.6 || (Math.abs(x - RUINS.x) < 11 && Math.abs(z - RUINS.z) < 9);
let lastFlash = 0;
const fireSpots = ruins.torches.map((t) => ({ x: t.x, z: t.z }));

function playerEvents() {
  for (const ev of player.events) {
    if (ev.type === 'stamina') { hud.stats.st[0] = Math.max(0, hud.stats.st[0] - ev.cost); player.stRegenDelay = 0.75; }
    else if (ev.type === 'sound') audio.play(ev.name === 'swing' ? audio.pick('swing', 3) : ev.name, { vol: ev.name === 'dodge' ? 0.7 : 0.75 });
    else if (ev.type === 'step') {
      const surf = STONE(player.pos.x, player.pos.z) ? 'step_stone' : 'step_grass';
      audio.play(audio.pick(surf, 4), { vol: ev.run ? 0.3 : 0.2, rate: ev.run ? 1.06 : 1 });
    } else if (ev.type === 'torch') { audio.play('torch', { vol: 0.6 }); refreshHud(); }
    else if (ev.type === 'drink') {
      if (useItem(game.inv, 'crimson_flask')) {
        const hp = hud.stats.hp;
        hp[0] = Math.min(hp[1], hp[0] + Math.round(hp[1] * flaskHeal(game.progress.flaskLvl)));
        audio.play('flask', { vol: 0.8 });
        torches.burst(player.pos.clone().setY(player.pos.y + 1.2), 10, 0.4);
        refreshHud();
      }
    } else if (ev.type === 'charged') {
      // fully charged heavy: a spark runs up the blade
      torches.burst(player.sword.position.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(player.sword.quaternion), 0.8), 14, 0.5);
      audio.play('clang', { vol: 0.3, rate: 1.4 });
    } else if (ev.type === 'noflask') { hud.toast('No flasks left'); audio.play('ui_back', { vol: 0.5 }); }
  }
  for (const ev of enemies.events) {
    if (ev.type !== 'enemySound') continue;
    audio.play(ev.name === 'swing' ? audio.pick('swing', 3) : ev.name, { vol: ev.vol, pos: ev.pos, range: 36 });
  }
  enemies.events.length = 0;
}

function updateAmbience() {
  const x = state === 'title' ? camera.position.x : player.pos.x;
  const z = state === 'title' ? camera.position.z : player.pos.z;
  let yaw = cam.yaw;
  if (state === 'title') { camera.getWorldDirection(tmp); yaw = Math.atan2(-tmp.x, -tmp.z); }
  audio.setListener(x, z, yaw);
  const rain = weather.rain, night = weather.night;
  audio.setLoop('rain', rain * 0.8);
  // wind is barely there, and only swells a little when a gust passes
  audio.setLoop('wind', 0.015 + 0.09 * (weather.gust || 0) + rain * 0.05, 1.5);
  audio.setLoop('night', night * (1 - rain) * 0.5);
  audio.setLoop('day', (1 - night) * (1 - rain) * 0.4);
  let d = 99;
  for (const f of fireSpots) d = Math.min(d, Math.hypot(f.x - x, f.z - z));
  audio.setLoop('fire', Math.pow(Math.max(0, 1 - d / 11), 1.5) * 0.6 + (state !== 'title' && player.torchOn ? 0.05 : 0), 0.3);
  // thunder follows the lightning, later the further away it struck
  if (weather.flash > 0.9 && lastFlash < 0.5) {
    const delay = 0.3 + Math.random() * 2.4;
    audio.play(audio.pick(delay < 1.2 ? 'thunder_near' : 'thunder_far', 2), { vol: delay < 1.2 ? 0.6 : 0.45, delay });
  }
  lastFlash = weather.flash;
  for (const ev of cobwebs.events) audio.play(ev.type, { vol: 0.6, pos: ev.pos, range: 20 });
}

// ---------- footstep trail (grass springs back slowly) ----------
const trail = [];
let trailTimer = 0;

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = ascii.resize();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
applyGraphics();

// Auto detail: if the frame rate sags, render the 3D scene with fewer samples
// per character cell (the glyph grid itself never changes).
function autoQuality(dt) {
  if (fixedDt || settings.get('graphics').detail !== 'auto') return;
  perf.t += dt; perf.frames++; perf.cooldown -= dt;
  if (perf.t < 2) return;
  const fps = perf.frames / perf.t;
  perf.t = 0; perf.frames = 0;
  if (perf.cooldown > 0) return;
  if (fps < 45 && ascii.setQuality(ascii.quality - 1)) { onResize(); perf.cooldown = 4; }
  else if (fps > 80 && ascii.setQuality(ascii.quality + 1)) { onResize(); perf.cooldown = 8; }
}

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const look = new THREE.Vector3();
const ctl = { x: 0, z: 0, run: false, toggleTorch: false, light: false, heavy: false, dodge: false, flask: false, flasks: 0 };
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
let lockFlick = 0;
let time = 0;

const maxFrames = Number(params.get('frames')) || Infinity; // for automated testing
const fixedDt = Number(params.get('dt')) || 0;
let frameCount = 0;
let frameMs = 0;

function playControls(dt) {
  const c = settings.get('camera');
  const dir = c.invert ? -1 : 1;
  if (input.tapped('inventory')) (inventory.open ? closeInventory() : openInventory());
  const free = !inventory.open && !shrine.open;   // menus open: the hero stands still
  // with mouse capture on, the click that grabs the cursor doesn't also swing
  const ready = free && (input.locked || !c.mouseCapture);
  if (ready && input.tapped('lockon')) {
    const t = combat.toggleLock(cam.yaw);
    if (!t && !player.lockTarget) cam.yawTarget = cam.yaw + angDiff(cam.yaw, player.yaw + Math.PI);  // no target: recentre behind the hero
    audio.play('ui_move', { vol: t ? 0.5 : 0.3 });
  }
  const target = player.lockTarget;
  if (target) {
    // locked on: the camera keeps the target in view; flick the mouse to switch
    const want = Math.atan2(player.pos.x - target.pos.x, player.pos.z - target.pos.z);
    cam.yawTarget = cam.yaw + angDiff(cam.yaw, want);
    lockFlick = lockFlick * Math.exp(-dt * 6) + input.lookX * dir;
    if (Math.abs(lockFlick) > 120) { combat.switchTarget(cam.yaw, Math.sign(lockFlick)); lockFlick = 0; }
  } else if (free) {
    if (input.held('camLeft')) cam.yawTarget += dt * 1.8 * c.sensitivity * dir;
    if (input.held('camRight')) cam.yawTarget -= dt * 1.8 * c.sensitivity * dir;
    cam.yawTarget -= input.dragX * 0.006 * c.sensitivity * dir;
    // captured mouse: move it to look around
    cam.yawTarget -= input.lookX * 0.0024 * c.sensitivity * dir;
  }
  if (free) {
    cam.pitchTarget = THREE.MathUtils.clamp(cam.pitchTarget + input.lookY * 0.0018 * c.sensitivity * (c.invertY ? -1 : 1), 0.38, 1.22);
    cam.distTarget = THREE.MathUtils.clamp(cam.distTarget + input.wheel * 2.5, 9, 34);
  }
  cam.yaw += (cam.yawTarget - cam.yaw) * (1 - Math.exp(-(target ? 7 : 14) * dt));
  cam.pitch += (cam.pitchTarget - cam.pitch) * (1 - Math.exp(-14 * dt));
  // the camera eases back a little while sprinting
  const want = cam.distTarget + (player.sprinting ? 1.6 : 0);
  cam.dist += (want - cam.dist) * (1 - Math.exp(-4 * dt));

  // camera-relative movement
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const f = free ? (input.held('forward') ? 1 : 0) - (input.held('back') ? 1 : 0) : 0;
  const r = free ? (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0) : 0;
  ctl.x = fx * f - fz * r;
  ctl.z = fz * f + fx * r;
  ctl.run = free && input.held('sprint');
  ctl.toggleTorch = free && input.tapped('torch') && game.inv.equip.left === 'pitch_torch';
  ctl.light = ready && input.tapped('light');
  ctl.heavy = ready && input.tapped('heavy');
  ctl.heavyHeld = ready && input.held('heavy');
  ctl.dodge = free && input.tapped('dodge');
  ctl.flask = free && input.tapped('flask') && game.inv.equip.item === 'crimson_flask';
  ctl.flasks = countOf(game.inv, 'crimson_flask');
  return ctl;
}

function updateStamina(dt) {
  const st = hud.stats.st;
  const sprinting = player.sprinting;
  if (sprinting) { st[0] = Math.max(0, st[0] - 18 * dt); player.stRegenDelay = 0.9; if (st[0] <= 0) player.winded = true; }
  else {
    player.stRegenDelay = (player.stRegenDelay || 0) - dt;
    // slower recovery mid-action, like holding up a guard
    if (player.stRegenDelay <= 0) st[0] = Math.min(st[1], st[0] + (player.busy ? 14 : 38) * dt);
  }
  if (player.winded && st[0] > st[1] * 0.3) player.winded = false;
  player.canRun = st[0] > 0 && !player.winded;
}

function frame() {
  const frameStart = performance.now();
  const realDt = fixedDt || Math.min(clock.getDelta(), 1 / 20);
  const dt = state === 'paused' ? 0 : realDt;   // the world freezes while paused
  time += dt;
  shared.uTime.value = time;
  ascii.uniforms.uTime.value = time;

  let focus;
  if (state === 'title') {
    weather.update(dt);
    focus = cinematic.update(dt);
    player.update(dt, cinematic.ctl);
    for (const ev of player.events) {
      if (ev.type === 'step') audio.play(audio.pick(STONE(player.pos.x, player.pos.z) ? 'step_stone' : 'step_grass', 4), { vol: 0.22, pos: player.pos, range: 40 });
    }
  } else {
    if (state === 'playing') {
      game.playtime += dt;
      game.autosave += dt;
      if (game.autosave > 30 && game.dying === null) { game.autosave = 0; saveGame(); }
      if (game.rested !== null) game.rested += dt;
      weather.update(dt);
      // hitstop: the world all but freezes for a few frames when a blow lands
      const wdt = combat.hitstop > 0 ? dt * 0.08 : dt;
      const c = playControls(dt);
      updateInteract(c);
      player.update(wdt, c, hud.stats.st[0]);
      enemies.update(wdt, player);
      combat.update(dt);
      playerEvents();
      updateStamina(dt);
      updateDeath(dt);
      if (bloodstain.on && Math.random() < dt * 6) torches.burst(bloodstain.pos, 1, 0.35);
      pickups.update(dt, player.pos);
      if (game.regen && player.alive) {
        const hp = hud.stats.hp;
        hp[0] = Math.min(hp[1], hp[0] + game.regen.rate * dt);
        if ((game.regen.t -= dt) <= 0) game.regen = null;
      }
    }
    // camera follows with a little look-ahead; when locked on it frames both of you
    look.set(player.pos.x + player.vel.x * 0.22, player.pos.y + 1, player.pos.z + player.vel.z * 0.22);
    if (player.lockTarget) look.lerp(tmp.copy(player.lockTarget.pos).setY(player.lockTarget.pos.y + 1), 0.3);
    cam.target.lerp(look, 1 - Math.exp(-5 * realDt));
    const cp = Math.cos(cam.pitch) * cam.dist, sp = Math.sin(cam.pitch) * cam.dist;
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp, cam.target.y + sp, cam.target.z + Math.cos(cam.yaw) * cp);
    camera.lookAt(cam.target);
    if (combat.shake > 0.01) {
      const a = combat.shake * 0.22;
      camera.position.x += Math.sin(time * 71) * a; camera.position.y += Math.sin(time * 53) * a * 0.6; camera.position.z += Math.cos(time * 67) * a;
    }
    camera.updateMatrixWorld();
    focus = cam.target;
  }

  wildlife.update(dt, time, player.pos);
  heldTorch.on = player.torchOn;
  player.torchWorldPos(heldTorch.pos);
  cobwebs.update(dt, player, heldTorch.pos);
  updateAmbience();

  // grass interaction
  shared.uPlayerPos.value.copy(player.pos);
  trailTimer += dt;
  const moved = trail.length === 0 || Math.hypot(trail[0].x - player.pos.x, trail[0].z - player.pos.z) > 0.35;
  if (trailTimer > 0.08 && moved) {
    trailTimer = 0;
    trail.unshift({ x: player.pos.x, z: player.pos.z, t: time });
    if (trail.length > TRAIL_LEN - 1) trail.pop();
  }
  shared.uTrail.value[0].set(player.pos.x, player.pos.y, player.pos.z, 1);
  for (let i = 1; i < TRAIL_LEN; i++) {
    const p = trail[i - 1];
    if (p && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 6) shared.uTrail.value[i].set(p.x, 0, p.z, Math.max(0, 1 - (time - p.t) / 2.2) * 0.85);
    else shared.uTrail.value[i].w = 0;
  }
  grass.userData.update(focus);
  const pxScale = ascii.gridPx.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  fireflies.userData.update(focus, weather.night, pxScale);

  torches.dayFactor = weather.cur.torch;
  torches.update(dt, player.pos, camera, ascii);

  if (settings.get('graphics').shadows) shadows.render(scene, focus);
  else shared.uShadowOn.value = 0;
  ascii.uniforms.uGain.value = weather.cur.gain;
  ascii.uniforms.uRain.value = weather.rain;
  ascii.uniforms.uFlash.value = weather.flash;
  ascii.uniforms.uSlant.value = 0.12 + 0.18 * shared.uWindStrength.value;
  ascii.render(scene, camera, overlay);

  autoQuality(realDt);
  // (your own name sits above the health bar, souls-style; no floating nameplate)
  combat.draw(camera, state !== 'title');
  if (inventory.open) portrait.update(realDt, player);
  frameMs += ((performance.now() - frameStart) - frameMs) * 0.1;
  hud.update(realDt, `${weather.timeName}${weather.rainTarget ? ' · rain' : ''}`, frameMs);
  input.endFrame();
  if (++frameCount < maxFrames) requestAnimationFrame(frame);
  else window.__done = true;
}

// ---------- start ----------
// build every shader now (skeletons included) so nothing stalls when they first appear
hud.loading('Preparing shaders', 1);
try { renderer.compile(scene, camera); renderer.compile(overlay, camera); } catch { /* compiled on first use instead */ }
hud.loading(null);
cinematic.start();
menu.showTitle();

// test hooks (?play=1 skips the title, ?shot=N starts the film at shot N)
if (params.get('shot')) { for (let i = 0; i < Number(params.get('shot')); i++) cinematic.next(); }
if (params.get('play') === '1') { menu.pressed = true; newGame('Wanderer'); }
if (params.get('spawn') && state === 'playing') {
  const [sx, sz] = params.get('spawn').split(',').map(Number);
  player.pos.set(sx, terrainHeight(sx, sz), sz); cam.target.set(sx, player.pos.y + 1, sz);
}

window.__camera = camera; window.__scene = scene; window.__renderer = renderer;
window.__portrait = portrait;
window.__game = { player, enemies, combat, audio, hud, game, weather, ascii, cam, torches, input, wildlife, cobwebs, menu, settings, cinematic, overlay, get grass() { return grass; }, get state() { return state; } };
window.__frame = frame;
requestAnimationFrame(frame);
