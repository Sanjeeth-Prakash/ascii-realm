// One save slot in local storage: character name, where you stood, your stats
// and how long you've played.

const KEY = 'asciirealm.save.v1';

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.version === 1 ? s : null;
  } catch { return null; }
}

export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), ...data })); return true; } catch { return false; }
}

export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function formatPlaytime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function placeName(x, z) {
  if (Math.hypot(x, z) < 12) return 'Shrine of First Light';
  if (Math.hypot(x + 48, z + 22) < 18) return 'The Fallen Keep';
  if (Math.hypot(x - 55, z + 30) < 30) return 'Stillwater Mere';
  return 'The Whispering Wilds';
}
