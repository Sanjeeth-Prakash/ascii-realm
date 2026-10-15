// Inventory window: equipment (with the live hero portrait) on the left, the bag
// grid on the right, item details on hover. Click an item to equip / unequip.

import { ITEMS, RARITY, SLOTS, toggleEquip } from '../game/items.js';
import { keyName } from '../core/settings.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};

export class InventoryUI {
  constructor({ settings, portraitCanvas, getInv, getStats, onChange, onUse }) {
    this.onUse = onUse;
    this.settings = settings;
    this.getInv = getInv;
    this.getStats = getStats;
    this.onChange = onChange;
    this.open = false;
    this.portraitCanvas = portraitCanvas;

    this.equipEl = h('div', { class: 'inv-equip' });
    this.statsEl = h('div', { class: 'inv-stats' });
    this.gridEl = h('div', { class: 'inv-grid' });
    this.tipEl = h('div', { class: 'inv-tip', hidden: true });
    this.el = h('section', { class: 'inv', hidden: true },
      h('div', { class: 'inv-panel' },
        h('header', { class: 'inv-head' }, h('div', { class: 'inv-title' }, 'INVENTORY'), h('div', { class: 'inv-hint', id: 'inv-hint' }, ''),
          h('button', { class: 'btn ghost', onclick: () => this.onRequestClose?.() }, 'Close')),
        h('div', { class: 'inv-body' },
          h('div', { class: 'inv-left' }, h('div', { class: 'inv-portrait' }, portraitCanvas), this.equipEl, this.statsEl),
          h('div', { class: 'inv-right' }, h('div', { class: 'inv-sub' }, 'Bag'), this.gridEl))),
      this.tipEl);
    document.getElementById('ui').append(this.el);
    this.el.addEventListener('mousemove', (e) => this.placeTip(e));
  }

  show() { this.open = true; this.el.hidden = false; this.render(); }
  hide() { this.open = false; this.el.hidden = true; this.tipEl.hidden = true; }

  render() {
    const inv = this.getInv();
    const b = this.settings.data.bindings;
    document.getElementById('inv-hint').textContent = `Click to equip, or to use consumables · ${keyName(b.inventory[0])} or Esc to close`;
    // equipment slots
    this.equipEl.replaceChildren(...Object.entries(SLOTS).map(([slot, s]) => {
      const id = inv.equip[slot];
      const def = id && ITEMS[id];
      return h('div', { class: 'eq' + (def ? '' : ' empty'), style: def ? `--rc:${RARITY[def.rarity].color}` : '',
        onmouseenter: () => def && this.showTip(id), onmouseleave: () => this.hideTip(),
        onclick: () => { if (id) { toggleEquip(inv, id); this.changed(); } } },
      h('span', { class: 'g' }, def ? def.glyph : '·'),
      h('span', { class: 'l' }, h('b', {}, s.label), h('span', {}, def ? def.name : 'Empty')));
    }));
    // stats
    const st = this.getStats();
    const weapon = ITEMS[inv.equip.right];
    const dmg = weapon ? weapon.stats.find((x) => x[0] === 'Damage')?.[1] : 'bare hands';
    this.statsEl.replaceChildren(
      ...[['Level', st.level], ['Runes', st.runes], ['HP', `${st.hp[1]}`], ['FP', `${st.fp[1]}`], ['Stamina', `${st.st[1]}`], ['Attack', st.attack ?? dmg]]
        .map(([k, v]) => h('div', { class: 'stat' }, h('span', {}, k), h('b', {}, String(v)))));
    // bag grid
    const cells = [];
    for (let i = 0; i < inv.size; i++) {
      const s = inv.bag[i];
      const def = s && ITEMS[s.id];
      if (!def) { cells.push(h('div', { class: 'cell empty' })); continue; }
      const equipped = Object.values(inv.equip).includes(s.id);
      cells.push(h('button', { class: 'cell' + (equipped ? ' equipped' : ''), style: `--rc:${RARITY[def.rarity].color}`,
        onmouseenter: () => this.showTip(s.id), onmouseleave: () => this.hideTip(),
        onclick: () => { if (def.use) { this.onUse?.(s.id); this.render(); } else if (toggleEquip(inv, s.id)) this.changed(); } },
      h('span', { class: 'g' }, def.glyph),
      (def.stack || s.count > 1) ? h('span', { class: 'c' }, String(s.count)) : null,
      equipped ? h('span', { class: 'e' }, 'E') : null));
    }
    this.gridEl.replaceChildren(...cells);
  }

  changed() { this.onChange?.(); this.render(); }

  showTip(id) {
    const def = ITEMS[id];
    const r = RARITY[def.rarity];
    this.tipEl.replaceChildren(
      h('div', { class: 'tn', style: `color:${r.color}` }, def.name),
      h('div', { class: 'tt' }, `${r.label} ${def.type}`),
      h('div', { class: 'ts' }, def.stats.map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v)))),
      h('div', { class: 'td' }, def.desc));
    this.tipEl.hidden = false;
  }

  hideTip() { this.tipEl.hidden = true; }

  placeTip(e) {
    if (this.tipEl.hidden) return;
    const w = this.tipEl.offsetWidth, hgt = this.tipEl.offsetHeight;
    let x = e.clientX + 18, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + hgt > window.innerHeight - 8) y = window.innerHeight - hgt - 8;
    this.tipEl.style.left = `${x}px`;
    this.tipEl.style.top = `${y}px`;
  }
}
