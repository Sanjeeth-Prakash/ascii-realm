// Keyboard + mouse state, read through named actions so every control can be
// rebound in Options. Mouse buttons appear as 'Mouse0' (left), 'Mouse1'
// (middle), 'Mouse2' (right).

export class Input {
  constructor(settings, canvas) {
    this.settings = settings;
    this.keys = new Set();
    this.justPressed = new Set();
    this.wheel = 0;
    this.dragX = 0;
    this.lookX = 0; this.lookY = 0;   // mouse movement while the cursor is captured
    this.canvas = canvas;
    this.enabled = false;  // only gathers game input while playing
    this.capture = null;   // when set, the next key/button goes here (rebinding)

    window.addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); this.finishCapture(e.code); return; }
      if (e.target instanceof HTMLInputElement) return;
      if (!this.enabled) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (this.capture) { e.preventDefault(); this.finishCapture(code); return; }
      if (!this.enabled || e.target !== canvas) return;
      if (!this.keys.has(code)) this.justPressed.add(code);
      this.keys.add(code);
      if (e.button === 1) e.preventDefault(); // stop middle-click autoscroll
    });
    window.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) { this.lookX += e.movementX; this.lookY += e.movementY; }
      else if (this.keys.has('Mouse1')) this.dragX += e.movementX;
    });
    canvas.addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEnabled(on) {
    this.enabled = on;
    this.keys.clear();
    this.justPressed.clear();
  }

  // raw state
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }

  // action state
  bound(id) { return this.settings.data.bindings[id] || []; }
  held(id) { return this.bound(id).some((c) => c && this.keys.has(c)); }
  tapped(id) { return this.bound(id).some((c) => c && this.justPressed.has(c)); }

  // capture the next key or mouse button (used by the rebind screen)
  captureNext(fn) { this.capture = fn; }
  finishCapture(code) {
    const fn = this.capture;
    this.capture = null;
    fn(code === 'Escape' ? null : code);
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  // capture the cursor (must be called from a click or key press)
  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* not allowed right now */ } });
    } catch { /* not allowed right now */ }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  endFrame() { this.justPressed.clear(); this.wheel = 0; this.dragX = 0; this.lookX = 0; this.lookY = 0; }
}
