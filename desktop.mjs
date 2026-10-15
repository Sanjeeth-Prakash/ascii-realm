// Desktop app: the same game in its own window, forced onto the dedicated
// graphics card (laptop browsers often pick the weaker built-in GPU).
// Run with "Play Desktop.bat" (Windows) or ./play-desktop.sh (Mac/Linux).

import { app, BrowserWindow, Menu, ipcMain, screen, dialog, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { findUpdate, applyUpdate, peekUpdate, checkOnline, download } from './updater.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
app.setName('ASCII Realm');

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
if (process.argv.includes('--uncapped')) {
  // run faster than the screen refresh rate (useful to measure raw FPS)
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

app.whenReady().then(async () => {
  // fixed port: saves and settings are stored per address, so keep it stable
  const port = await startServer({ port: 51731 }).catch(() => startServer({ port: 0 }));
  Menu.setApplicationMenu(null);
  // reopen in the display mode the player chose last time (no flash of a window)
  const prefsFile = path.join(app.getPath('userData'), 'display.json');
  let prefs = { mode: 'fullscreen', size: '1600x900' };
  try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) }; } catch { /* first launch */ }
  const [pw, ph] = String(prefs.size).split('x').map(Number);
  const win = new BrowserWindow({
    fullscreen: prefs.mode === 'fullscreen',
    show: false,
    width: pw || 1600,
    height: ph || 900,
    useContentSize: true,
    backgroundColor: '#000000',
    title: 'ASCII Realm',
    autoHideMenuBar: true,
    icon: path.join(HERE, 'build', 'icon.png'),
    webPreferences: { backgroundThrottling: false, preload: path.join(HERE, 'desktop-preload.cjs') },
  });

  // display mode requests from the game's Options screen
  win.once('ready-to-show', () => { win.show(); if (prefs.size === 'max' && prefs.mode !== 'fullscreen') win.maximize(); });
  ipcMain.handle('set-display', (_e, { mode, size }) => {
    prefs = { mode, size };
    try { fs.writeFileSync(prefsFile, JSON.stringify(prefs)); } catch { /* ignore */ }
    if (!win.isVisible()) return;  // window opens in the saved mode anyway
    if (mode === 'fullscreen') { if (!win.isFullScreen()) win.setFullScreen(true); return; }
    if (win.isFullScreen()) win.setFullScreen(false);
    const apply = () => {
      if (size === 'max') { win.maximize(); return; }
      if (win.isMaximized()) win.unmaximize();
      const [w, h] = String(size || '1600x900').split('x').map(Number);
      const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
      win.setContentSize(Math.min(w, area.width), Math.min(h, area.height));
      win.center();
    };
    // leaving fullscreen is animated on some systems; resize once it's done
    setTimeout(apply, 150);
  });
  ipcMain.handle('get-display', () => prefs);

  // ---- updates: ASCII-Realm-Update-x.y.z.zip in Downloads / Desktop / <game>/updates ----
  const version = () => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } };
  const updateDirs = () => {
    const dirs = [path.join(HERE, '..', '..', 'updates')];
    for (const k of ['downloads', 'desktop']) { try { dirs.push(app.getPath(k)); } catch { /* not on this system */ } }
    return dirs;
  };
  ipcMain.handle('update-check', () => ({ current: version(), update: findUpdate(updateDirs(), version()), dirs: updateDirs() }));
  // pick an update zip by hand (anywhere on the computer)
  ipcMain.handle('update-pick', async () => {
    let start; try { start = app.getPath('downloads'); } catch { start = undefined; }
    const r = await dialog.showOpenDialog(win, { title: 'Choose an ASCII Realm update', defaultPath: start, properties: ['openFile'], filters: [{ name: 'ASCII Realm update', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { const info = peekUpdate(r.filePaths[0]); return { path: r.filePaths[0], version: info.version }; } catch (err) { return { error: String(err.message || err) }; }
  });
  // online: where releases are published (update-feed.json next to the game files)
  const feed = () => {
    if (process.env.ASCII_REALM_FEED) return { url: process.env.ASCII_REALM_FEED };
    try { const f = JSON.parse(fs.readFileSync(path.join(HERE, 'update-feed.json'), 'utf8')); return f.github || f.url ? f : null; } catch { return null; }
  };
  ipcMain.handle('update-online-check', async () => {
    const f = feed();
    if (!f) return { configured: false };
    try { return { configured: true, update: await checkOnline(f, version(), net.fetch) }; } catch (err) { return { configured: true, error: String(err.message || err) }; }
  });
  ipcMain.handle('update-online-install', async (e, plan) => {
    try {
      const tmp = path.join(app.getPath('temp'), 'ascii-realm-update');
      fs.rmSync(tmp, { recursive: true, force: true });
      const total = plan.size || 1;
      let done = 0;
      for (const step of plan.steps) {
        const file = path.join(tmp, step.name || `step-${step.version}.zip`);
        await download(step.url, file, net.fetch, (got) => e.sender.send('update-progress', Math.min(1, (done + got) / total)));
        done += step.size || 0;
        applyUpdate(file, HERE, version());
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
      return { ok: true, version: version() };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('update-apply', (_e, file) => {
    try {
      const v = applyUpdate(file, HERE, version());
      setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
      return { ok: true, version: v };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('quit', () => app.quit());
  const tell = (mode) => win.webContents.send('display-changed', mode);
  win.on('enter-full-screen', () => tell('fullscreen'));
  win.on('leave-full-screen', () => tell('windowed'));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); event.preventDefault(); }
  });
  const query = process.argv.find((a) => a.startsWith('--query='))?.slice(8) ?? '';
  await win.loadURL(`http://127.0.0.1:${port}/${query ? '?' + query : ''}`);
});

app.on('window-all-closed', () => app.quit());
