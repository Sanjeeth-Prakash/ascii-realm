// Display mode + window size. In the desktop app this drives the real window
// (borderless fullscreen that Esc never exits). In a browser it falls back to
// page fullscreen with Esc locked to the game where the browser allows it.

export const WINDOW_SIZES = [['1280x720', '1280×720'], ['1600x900', '1600×900'], ['1920x1080', '1920×1080'], ['max', 'Maximized']];

export class Display {
  constructor(settings) {
    this.settings = settings;
    this.desktop = window.desktop || null;
    this.syncing = false;
    if (this.desktop) {
      // F11 or the OS changed the window: keep the setting in step
      this.desktop.onDisplayChange((mode) => this.adopt({ mode }));
      // the window remembers its own mode; the game copies it at startup
      this.ready = this.desktop.getDisplay().then((p) => this.adopt(p)).catch(() => {});
    }
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) navigator.keyboard?.lock?.(['Escape']).catch(() => {});
    });
  }

  adopt({ mode, size }) {
    const g = this.settings.get('graphics');
    this.syncing = true;
    if (mode && g.display !== mode) this.settings.set('graphics', 'display', mode);
    if (size && g.windowSize !== size) this.settings.set('graphics', 'windowSize', size);
    this.syncing = false;
  }

  get isDesktop() { return !!this.desktop; }

  apply() {
    if (this.syncing) return;
    const g = this.settings.get('graphics');
    if (this.desktop) this.desktop.setDisplay({ mode: g.display, size: g.windowSize });
  }

  // Browser only (needs a click): toggle page fullscreen.
  toggleBrowserFullscreen() {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return Promise.resolve(p).catch(() => {});
  }
}
