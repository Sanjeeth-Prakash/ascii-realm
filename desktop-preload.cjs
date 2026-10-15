// Small bridge that lets the game page control its own window (display mode,
// window size, quit) and install update zips.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setDisplay: (opts) => ipcRenderer.invoke('set-display', opts),
  getDisplay: () => ipcRenderer.invoke('get-display'),
  quit: () => ipcRenderer.invoke('quit'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  applyUpdate: (file) => ipcRenderer.invoke('update-apply', file),
  pickUpdate: () => ipcRenderer.invoke('update-pick'),
  checkOnline: () => ipcRenderer.invoke('update-online-check'),
  installOnline: (plan) => ipcRenderer.invoke('update-online-install', plan),
  onUpdateProgress: (fn) => ipcRenderer.on('update-progress', (_e, f) => fn(f)),
  pathForFile: (f) => webUtils.getPathForFile(f),
  onDisplayChange: (fn) => ipcRenderer.on('display-changed', (_e, mode) => fn(mode)),
});
