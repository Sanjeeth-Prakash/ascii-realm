// In-game updater (desktop app).
// An update is a zip named ASCII-Realm-Update-<version>.zip holding
//   update.json   { "version": "0.7.2", "delete": ["old/file.js", ...] }
//   app/...       only the game files that changed
// The game looks for one in Downloads, Desktop and its own "updates" folder
// (or takes one dropped on the window), copies the files over the installed
// game and restarts. Saves and settings live elsewhere and are never touched.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// accepts "ASCII-Realm-Update-0.8.0.zip", "... (1).zip", "ascii realm update v0.8.0.zip",
// and the same names as an unzipped folder
const NAME = /^ascii[-_ ]?realm[-_ ]?update[-_ ]?v?(\d+\.\d+\.\d+)(?:-from-\d+\.\d+\.\d+)?(?:\s*\(\d+\))?[^\d.]*?(\.zip)?$/i;

export function newer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// newest update zip in the given folders that is newer than `current`
export function findUpdate(dirs, current) {
  let best = null;
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const m = NAME.exec(n);
      if (!m || !newer(m[1], current)) continue;
      const full = path.join(dir, n);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      // an unzipped update folder: the files may sit one level down
      if (st.isDirectory() && !updateRoot(full)) continue;
      if (!st.isDirectory() && !m[2]) continue;
      if (!best || newer(m[1], best.version)) best = { version: m[1], path: full, size: st.size };
    }
  }
  return best;
}

// ---- minimal zip reader (stored + deflate), no dependencies ----
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const data0 = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data0, data0 + csize);
    entries.push({ name, data: () => (method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error(`unsupported zip method ${method}`); })()) });
  }
  return entries;
}

// folder containing update.json (the folder itself or one level down)
function updateRoot(dir) {
  if (fs.existsSync(path.join(dir, 'update.json'))) return dir;
  try {
    for (const n of fs.readdirSync(dir)) {
      const sub = path.join(dir, n);
      if (fs.existsSync(path.join(sub, 'update.json'))) return sub;
    }
  } catch { /* unreadable */ }
  return null;
}

// an unzipped update, read like the zip
function readDir(dir) {
  const root = updateRoot(dir);
  if (!root) throw new Error('this folder is not an ASCII Realm update');
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (fs.statSync(abs).isDirectory()) { for (const n of fs.readdirSync(abs)) walk(rel ? `${rel}/${n}` : n); return; }
    out.push({ name: rel, data: () => fs.readFileSync(abs) });
  };
  walk('');
  return out;
}

// what's in an update (zip or folder), without installing it
export function peekUpdate(file) {
  const entries = fs.statSync(file).isDirectory() ? readDir(file) : readZip(file);
  const meta = entries.find((e) => e.name === 'update.json');
  if (!meta) throw new Error('this is not an ASCII Realm update');
  return JSON.parse(meta.data().toString('utf8'));
}

// copy the update into `appDir`; returns the new version
export function applyUpdate(zipFile, appDir, current) {
  const entries = fs.statSync(zipFile).isDirectory() ? readDir(zipFile) : readZip(zipFile);
  const meta = entries.find((e) => e.name === 'update.json');
  if (!meta) throw new Error('this zip is not an ASCII Realm update');
  const info = JSON.parse(meta.data().toString('utf8'));
  if (!info.version || !newer(info.version, current)) throw new Error(`update ${info.version} is not newer than ${current}`);
  if (info.requires && newer(info.requires, current)) throw new Error(`this update needs v${info.requires} or newer first; run the full installer instead`);
  const root = path.resolve(appDir);
  const safe = (rel) => {
    const out = path.resolve(root, rel);
    if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`bad path in update: ${rel}`);
    return out;
  };
  // write to temp names first, then swap in, so a failure halfway leaves the game intact
  const files = entries.filter((e) => e.name.startsWith('app/') && e.name.length > 4);
  const staged = [];
  try {
    for (const e of files) {
      const dest = safe(e.name.slice(4));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + '.updating', e.data());
      staged.push(dest);
    }
  } catch (err) {
    for (const d of staged) fs.rmSync(d + '.updating', { force: true });
    throw err;
  }
  for (const d of staged) fs.renameSync(d + '.updating', d);
  for (const rel of info.delete || []) fs.rmSync(safe(rel), { force: true, recursive: true });
  return info.version;
}

// ---------------------------------------------------------------- online updates
// Releases are published on GitHub (free). Each release v<X> carries
//   ASCII-Realm-Update-<X>-from-<previous>.zip   only what changed since the previous release
//   ASCII-Realm-Game-<X>.zip                      every game file (used if a step is missing)
// The game follows the chain of small updates from its own version up to the
// newest; if the chain is broken it takes the full game zip instead.

const DELTA = /^ASCII-Realm-Update-(\d+\.\d+\.\d+)-from-(\d+\.\d+\.\d+)\.zip$/i;
const FULL = /^ASCII-Realm-Game-(\d+\.\d+\.\d+)\.zip$/i;

// feed: { github: "owner/repo" } or { url: "https://.../releases" } (GitHub API shape)
export async function checkOnline(feed, current, fetchFn) {
  const url = feed.url || `https://api.github.com/repos/${feed.github}/releases?per_page=30`;
  const res = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ASCII-Realm-updater' } });
  if (!res.ok) throw new Error(`update server said ${res.status}`);
  const releases = (await res.json()).filter((r) => !r.draft && !r.prerelease);
  const byVer = new Map();
  for (const r of releases) {
    const v = String(r.tag_name || '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(v)) continue;
    const rel = { version: v, notes: r.body || '', name: r.name || `v${v}`, deltas: [], full: null };
    for (const a of r.assets || []) {
      let m;
      if ((m = DELTA.exec(a.name))) rel.deltas.push({ from: m[2], url: a.browser_download_url, size: a.size, name: a.name });
      else if ((m = FULL.exec(a.name))) rel.full = { url: a.browser_download_url, size: a.size, name: a.name };
    }
    byVer.set(v, rel);
  }
  const newer_ = [...byVer.values()].filter((r) => newer(r.version, current)).sort((a, b) => (newer(a.version, b.version) ? 1 : -1));
  if (!newer_.length) return null;
  const latest = newer_[newer_.length - 1];
  // follow the small updates one by one
  const steps = [];
  let at = current;
  for (const r of newer_) {
    const d = r.deltas.find((x) => x.from === at);
    if (!d) { steps.length = 0; break; }
    steps.push({ version: r.version, ...d });
    at = r.version;
  }
  if (steps.length && at === latest.version) return { version: latest.version, notes: latest.notes, steps, size: steps.reduce((n, x) => n + x.size, 0) };
  if (latest.full) return { version: latest.version, notes: latest.notes, steps: [{ version: latest.version, ...latest.full, full: true }], size: latest.full.size };
  return null;
}

export async function download(url, file, fetchFn, onProgress) {
  const res = await fetchFn(url, { headers: { 'User-Agent': 'ASCII-Realm-updater' } });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    got += value.length;
    onProgress?.(got, total);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}
