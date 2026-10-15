// The shrine menu (Elden Ring's site of grace): opens when you rest.
//   Level Up   spend runes on attributes, with a preview of every stat
//   Flasks     grow the flask with Golden Seeds / Sacred Tears
//   Leave      stand up
// Keyboard: arrows / W S to pick, A D or ← → to lower / raise, Enter to confirm, Esc to go back.

import { ATTRS, MAX_ATTR, levelCost, levelOf, maxHp, maxFp, maxStamina, attackMult,
  FLASK_CAP, TEAR_CAP, flaskHeal, seedsForNext } from '../game/stats.js';
import { countOf } from '../game/items.js';

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

const WEAPON_BASE = { sword: 28, unarmed: 14 };

export class ShrineUI {
  constructor({ getProgress, getStats, getInv, getWeapon, onLevel, onFlask, onClose, sound }) {
    Object.assign(this, { getProgress, getStats, getInv, getWeapon, onLevel, onFlask, onClose });
    this.sound = sound || (() => {});
    this.open = false;
    this.view = 'root';
    this.el = h('section', { class: 'shrine', hidden: true });
    document.getElementById('ui').append(this.el);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  show() { this.open = true; this.view = 'root'; this.sel = 0; this.el.hidden = false; this.render(); this.sound('ui_open'); }
  hide() { this.open = false; this.el.hidden = true; }

  // ---------------- views ----------------
  render() {
    if (this.view === 'level') return this.renderLevel();
    if (this.view === 'flask') return this.renderFlask();
    const items = [
      ['Level Up', () => this.openLevel()],
      ['Flasks', () => { this.view = 'flask'; this.sel = 0; this.render(); }],
      ['Leave', () => this.close()],
    ];
    this.items = items;
    const p = this.getProgress(), st = this.getStats();
    this.el.replaceChildren(h('div', { class: 'shr-root' },
      h('div', { class: 'shr-title' }, 'Shrine of First Light'),
      h('nav', { class: 'shr-list' }, items.map(([label, act], i) => h('button', { class: 'shr-item' + (i === this.sel ? ' sel' : ''),
        onmouseenter: () => this.select(i), onclick: () => { this.sound('ui_select'); act(); } }, label))),
      h('div', { class: 'shr-foot' }, `Level ${levelOf(p.attrs)}  ·  Runes ${st.runes.toLocaleString()}`)));
  }

  select(i) { if (this.sel !== i) { this.sel = i; this.sound('ui_move'); this.render(); } }

  openLevel() {
    this.view = 'level';
    this.sel = 0;
    this.draft = { ...this.getProgress().attrs };
    this.render();
  }

  // runes needed to buy the levels in the draft
  draftCost() {
    const p = this.getProgress();
    let lvl = levelOf(p.attrs), cost = 0;
    const target = levelOf(this.draft);
    while (lvl < target) cost += levelCost(lvl++);
    return cost;
  }

  adjust(d) {
    const a = ATTRS[this.sel];
    if (!a) return;
    const base = this.getProgress().attrs[a.id];
    const v = this.draft[a.id] + d;
    if (v < base || v > MAX_ATTR) return;
    if (d > 0) {
      const next = levelCost(levelOf(this.draft));
      if (this.draftCost() + next > this.getStats().runes) { this.sound('ui_back'); return; }
    }
    this.draft[a.id] = v;
    this.sound('ui_move');
    this.render();
  }

  renderLevel() {
    const p = this.getProgress(), st = this.getStats();
    const cur = p.attrs, nxt = this.draft;
    const cost = this.draftCost();
    const nextCost = levelCost(levelOf(nxt));
    const held = st.runes;
    const w = this.getWeapon();
    const atk = (attrs) => Math.round(WEAPON_BASE[w] * attackMult(attrs, w));
    const cmp = (label, a, b) => h('div', { class: 'shr-stat' + (b > a ? ' up' : '') }, h('span', {}, label), h('b', {}, String(a)), h('i', {}, '→'), h('b', {}, String(b)));
    const rows = ATTRS.map((a, i) => h('div', { class: 'shr-attr' + (i === this.sel ? ' sel' : '') + (nxt[a.id] > cur[a.id] ? ' up' : ''),
      onmouseenter: () => { if (this.sel !== i) { this.sel = i; this.render(); } } },
    h('span', { class: 'an' }, a.name),
    h('button', { class: 'pm', onclick: () => { this.sel = i; this.adjust(-1); } }, '‹'),
    h('b', {}, String(nxt[a.id])),
    h('button', { class: 'pm', onclick: () => { this.sel = i; this.adjust(1); } }, '›')));
    const desc = ATTRS[this.sel] ? ATTRS[this.sel].desc : '';
    this.el.replaceChildren(h('div', { class: 'shr-panel' },
      h('header', { class: 'shr-head' }, h('div', { class: 'shr-title' }, 'Level Up'),
        h('button', { class: 'btn ghost', onclick: () => this.back() }, 'Back  [Esc]')),
      h('div', { class: 'shr-cols' },
        h('div', { class: 'shr-col' },
          h('div', { class: 'shr-sub' }, 'Attributes'),
          rows,
          h('p', { class: 'shr-desc' }, desc),
          h('p', { class: 'shr-help' }, '← → or the arrows change a value  ·  Enter to confirm')),
        h('div', { class: 'shr-col' },
          h('div', { class: 'shr-sub' }, 'Level'),
          cmp('Level', levelOf(cur), levelOf(nxt)),
          h('div', { class: 'shr-stat' }, h('span', {}, 'Runes held'), h('b', {}, held.toLocaleString()), h('i', {}, '→'), h('b', {}, (held - cost).toLocaleString())),
          h('div', { class: 'shr-stat' + (held - cost < nextCost ? ' short' : '') }, h('span', {}, 'Next level costs'), h('b', {}, nextCost.toLocaleString())),
          h('div', { class: 'shr-sub' }, 'Base stats'),
          cmp('HP', maxHp(cur.vigor), maxHp(nxt.vigor)),
          cmp('FP', maxFp(cur.mind), maxFp(nxt.mind)),
          cmp('Stamina', maxStamina(cur.endurance), maxStamina(nxt.endurance)),
          cmp('Attack power', atk(cur), atk(nxt)),
          h('button', { class: 'btn primary shr-ok', disabled: cost === 0, onclick: () => this.confirmLevel() }, cost ? `Confirm  (${cost.toLocaleString()} runes)` : 'Confirm')))));
  }

  confirmLevel() {
    const cost = this.draftCost();
    if (!cost) return;
    this.onLevel({ ...this.draft }, cost);
    this.sound('runes');
    this.draft = { ...this.getProgress().attrs };
    this.render();
  }

  renderFlask() {
    const p = this.getProgress(), inv = this.getInv();
    const seeds = countOf(inv, 'golden_seed'), tears = countOf(inv, 'sacred_tear');
    const need = seedsForNext(p.flaskMax);
    const canSeed = p.flaskMax < FLASK_CAP && seeds >= need, canTear = p.flaskLvl < TEAR_CAP && tears > 0;
    const items = [
      ['seed', canSeed], ['tear', canTear], ['back', true],
    ];
    this.items = items;
    const btn = (i, label, sub, ok, act) => h('button', { class: 'shr-item wide' + (i === this.sel ? ' sel' : '') + (ok ? '' : ' off'),
      onmouseenter: () => this.select(i), onclick: () => { if (ok) act(); else this.sound('ui_back'); } }, h('span', {}, label), h('small', {}, sub));
    this.el.replaceChildren(h('div', { class: 'shr-panel narrow' },
      h('header', { class: 'shr-head' }, h('div', { class: 'shr-title' }, 'Flask of Crimson Tears'),
        h('button', { class: 'btn ghost', onclick: () => this.back() }, 'Back  [Esc]')),
      h('div', { class: 'shr-stat' }, h('span', {}, 'Charges'), h('b', {}, `${p.flaskMax} / ${FLASK_CAP}`)),
      h('div', { class: 'shr-stat' }, h('span', {}, 'Each sip heals'), h('b', {}, `${Math.round(flaskHeal(p.flaskLvl) * 100)}% HP`), h('i', {}, `+${p.flaskLvl}`)),
      h('div', { class: 'shr-sub' }, 'Strengthen'),
      btn(0, `Plant Golden Seeds  (have ${seeds}, need ${need})`, p.flaskMax >= FLASK_CAP ? 'Flask is full' : '+1 charge', canSeed, () => { this.onFlask('seed', need); this.sound('runes'); this.render(); }),
      btn(1, `Pour a Sacred Tear  (have ${tears})`, p.flaskLvl >= TEAR_CAP ? 'Flask is at full strength' : `Heal ${Math.round(flaskHeal(p.flaskLvl + 1) * 100)}% per sip`, canTear, () => { this.onFlask('tear', 1); this.sound('runes'); this.render(); }),
      btn(2, 'Back', '', true, () => this.back()),
      h('p', { class: 'shr-help' }, 'Golden Seeds and Sacred Tears are found glowing around the world.')));
  }

  back() {
    this.sound('ui_back');
    if (this.view === 'root') { this.close(); return; }
    const from = this.view;
    this.view = 'root'; this.sel = from === 'flask' ? 1 : 0; this.render();
  }

  close() { this.hide(); this.onClose?.(); }

  onKey(e) {
    if (!this.open) return;
    const k = e.key;
    const n = this.view === 'level' ? ATTRS.length : this.items?.length || 1;
    if (['ArrowDown', 's', 'S'].includes(k)) { this.select((this.sel + 1) % n); e.preventDefault(); }
    else if (['ArrowUp', 'w', 'W'].includes(k)) { this.select((this.sel - 1 + n) % n); e.preventDefault(); }
    else if (this.view === 'level' && ['ArrowLeft', 'a', 'A'].includes(k)) { this.adjust(-1); e.preventDefault(); }
    else if (this.view === 'level' && ['ArrowRight', 'd', 'D'].includes(k)) { this.adjust(1); e.preventDefault(); }
    else if (k === 'Enter') {
      e.preventDefault();
      if (this.view === 'level') this.confirmLevel();
      else this.el.querySelectorAll('.shr-item')[this.sel]?.click();
    } else if (k === 'Escape') { e.preventDefault(); e.shrineHandled = true; this.back(); }
  }
}

