// Item definitions, rarity tiers and the player's bag + equipment.
// Later steps add random stat rolls, sets and crafting on top of this.

export const RARITY = {
  common: { label: 'Common', color: '#c9cdc3' },
  uncommon: { label: 'Uncommon', color: '#7fc25a' },
  rare: { label: 'Rare', color: '#5b9be8' },
  epic: { label: 'Epic', color: '#b37cf0' },
  legendary: { label: 'Legendary', color: '#ffb35c' },
};

export const SLOTS = {
  right: { label: 'Right hand', key: 'light' },
  left: { label: 'Left hand', key: 'torch' },
  spell: { label: 'Spell', key: 'spell' },
  item: { label: 'Quick item', key: 'flask' },
};

export const ITEMS = {
  worn_longsword: {
    name: 'Worn Longsword', glyph: '†', type: 'Weapon', slot: 'right', rarity: 'common',
    stats: [['Damage', '28 physical'], ['Attack speed', 'Medium'], ['Weight', '3.5']],
    desc: 'A plain blade, nicked from long use. Better than bare hands.',
  },
  pitch_torch: {
    name: 'Pitch Torch', glyph: '¡', type: 'Torch', slot: 'left', rarity: 'common',
    stats: [['Light radius', '9 m']],
    desc: 'Lights the dark and burns away cobwebs. Toggle it to see by moonlight.',
  },
  crimson_flask: {
    name: 'Crimson Flask', glyph: 'ô', type: 'Consumable', slot: 'item', rarity: 'uncommon', stack: true,
    stats: [['Restores', '40% HP']],
    desc: 'A flask of warm red draught. Refills when you rest at a shrine.',
  },
  golden_seed: {
    name: 'Golden Seed', glyph: '♠', type: 'Key item', rarity: 'rare', stack: true,
    stats: [['Use', 'At a shrine: +1 flask charge']],
    desc: 'A seed of the golden tree, still warm. Rest at a shrine to grow your flask.',
  },
  sacred_tear: {
    name: 'Sacred Tear', glyph: '◊', type: 'Key item', rarity: 'epic', stack: true,
    stats: [['Use', 'At a shrine: flasks heal more']],
    desc: 'A tear wept by a forgotten saint. Pour it into your flask at a shrine.',
  },
  amber_moss: {
    name: 'Amber Moss', glyph: '♣', type: 'Consumable', rarity: 'uncommon', stack: true, use: 'regen',
    stats: [['Restores', '30% HP over 12 s']],
    desc: 'Soft glowing moss from old stones. Chew it to heal slowly. Click it in the bag to use.',
  },
  golden_rune: {
    name: 'Golden Rune', glyph: '◈', type: 'Consumable', rarity: 'rare', stack: true, use: 'runes',
    stats: [['Use', 'Gain 400 runes']],
    desc: 'A fragment of grace pressed into gold. Crush it to claim the runes inside.',
  },
  bone_shard: {
    name: 'Bone Shard', glyph: '¤', type: 'Material', rarity: 'common', stack: true,
    stats: [['Dropped by', 'Skeletons']],
    desc: 'A splinter of a restless dead. Smiths will want these once the forge is lit.',
  },
};

export const FLASK_MAX = 4;

export function newInventory() {
  return {
    bag: [
      { id: 'worn_longsword', count: 1 },
      { id: 'pitch_torch', count: 1 },
      { id: 'crimson_flask', count: 4 },
    ],
    equip: { right: 'worn_longsword', left: 'pitch_torch', spell: null, item: 'crimson_flask' },
    size: 30,
  };
}

export function countOf(inv, id) {
  return inv.bag.filter((s) => s.id === id).reduce((n, s) => n + s.count, 0);
}

// Equip an item into its slot (or take it off if it's already there).
export function toggleEquip(inv, id) {
  const def = ITEMS[id];
  if (!def?.slot) return false;
  inv.equip[def.slot] = inv.equip[def.slot] === id ? null : id;
  return true;
}

// Add `n` of a stackable item (or a new slot for anything else).
export function addItem(inv, id, n = 1) {
  const def = ITEMS[id];
  const slot = def.stack && inv.bag.find((s) => s.id === id);
  if (slot) slot.count += n;
  else if (inv.bag.length < inv.size) inv.bag.push({ id, count: n });
  else return false;
  return true;
}

// Use up `n` of a stack (stacks can sit at 0, like an empty flask).
export function useItem(inv, id, n = 1) {
  const slot = inv.bag.find((s) => s.id === id && s.count >= n);
  if (!slot) return false;
  slot.count -= n;
  return true;
}

export function setCount(inv, id, n) {
  const slot = inv.bag.find((s) => s.id === id);
  if (slot) slot.count = n; else addItem(inv, id, n);
}
