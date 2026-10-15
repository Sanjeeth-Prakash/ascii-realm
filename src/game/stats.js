// Character attributes and levelling, modelled on Elden Ring:
//  - five attributes, each raised by one point per level at a shrine
//  - HP / FP / stamina follow Elden Ring's curves (fast gains early, soft caps
//    later: Vigor 40 / 60, Mind 35 / 60, Endurance 30 / 50)
//  - the rune cost of the next level uses Elden Ring's formula (673 runes for
//    level 2, rising steeply)

export const ATTRS = [
  { id: 'vigor', name: 'Vigor', short: 'VIG', desc: 'Maximum HP.' },
  { id: 'mind', name: 'Mind', short: 'MND', desc: 'Maximum FP (for spells and skills).' },
  { id: 'endurance', name: 'Endurance', short: 'END', desc: 'Maximum stamina: more attacks and rolls in a row.' },
  { id: 'strength', name: 'Strength', short: 'STR', desc: 'Damage with heavy and strength-scaling weapons.' },
  { id: 'dexterity', name: 'Dexterity', short: 'DEX', desc: 'Damage with swords and dexterity-scaling weapons.' },
];

export const START_ATTRS = { vigor: 10, mind: 10, endurance: 10, strength: 12, dexterity: 12 };
export const START_LEVEL = 1;
export const MAX_ATTR = 99;

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export function maxHp(v) {
  if (v <= 25) return Math.floor(300 + 500 * ((v - 1) / 24) ** 1.5);
  if (v <= 40) return Math.floor(800 + 650 * (1 - (1 - (v - 25) / 15) ** 1.1));
  if (v <= 60) return Math.floor(1450 + 450 * (1 - (1 - (v - 40) / 20) ** 1.2));
  return Math.floor(1900 + 200 * (1 - (1 - (v - 60) / 39) ** 1.2));
}

export function maxFp(m) {
  if (m <= 15) return Math.floor(50 + 45 * (m - 1) / 14);
  if (m <= 35) return Math.floor(95 + 105 * (m - 15) / 20);
  if (m <= 60) return Math.floor(200 + 150 * (1 - (1 - (m - 35) / 25) ** 1.2));
  return Math.floor(350 + 100 * (m - 60) / 39);
}

export function maxStamina(e) {
  if (e <= 15) return Math.floor(80 + 25 * (e - 1) / 14);
  if (e <= 30) return Math.floor(105 + 25 * (e - 15) / 15);
  if (e <= 50) return Math.floor(130 + 25 * (e - 30) / 20);
  return Math.floor(155 + 15 * (e - 50) / 49);
}

// how much an attribute adds to weapon damage (0 at 10, ~1 by 55, soft cap after)
function scale(x) {
  if (x <= 10) return 0;
  if (x <= 55) return lerp(0, 1, ((x - 10) / 45) ** 0.9);
  return lerp(1, 1.25, (x - 55) / 44);
}

// attack power multiplier for the weapon (straight sword: D in STR, D/C in DEX)
export function attackMult(attrs, weapon = 'sword') {
  if (weapon === 'unarmed') return 1 + 0.6 * scale(attrs.strength) + 0.4 * scale(attrs.dexterity);
  return 1 + 0.55 * scale(attrs.strength) + 0.75 * scale(attrs.dexterity);
}

// runes needed to go from `level` to level + 1 (Elden Ring's formula)
export function levelCost(level) {
  const x = Math.max(0, (level + 81 - 92) * 0.02);
  return Math.floor((x + 0.1) * (level + 81) ** 2) + 1;
}

export function levelOf(attrs) {
  let n = START_LEVEL;
  for (const a of ATTRS) n += attrs[a.id] - START_ATTRS[a.id];
  return n;
}

// Flasks: Golden Seeds add charges, Sacred Tears make each sip stronger
export const FLASK_BASE = 4, FLASK_CAP = 10;
export const flaskHeal = (lvl) => 0.4 + 0.05 * lvl;            // fraction of max HP
export const seedsForNext = (charges) => (charges < 6 ? 1 : charges < 8 ? 2 : 3);
export const TEAR_CAP = 6;

export function newProgress() {
  return { attrs: { ...START_ATTRS }, flaskMax: FLASK_BASE, flaskLvl: 0, picked: [] };
}

// fill in anything an older save doesn't have
export function migrateProgress(p) {
  const out = newProgress();
  if (!p) return out;
  Object.assign(out.attrs, p.attrs || {});
  out.flaskMax = p.flaskMax ?? FLASK_BASE;
  out.flaskLvl = p.flaskLvl ?? 0;
  out.picked = Array.isArray(p.picked) ? p.picked.slice() : [];
  return out;
}

export function derived(p) {
  return { hp: maxHp(p.attrs.vigor), fp: maxFp(p.attrs.mind), st: maxStamina(p.attrs.endurance), level: levelOf(p.attrs) };
}
