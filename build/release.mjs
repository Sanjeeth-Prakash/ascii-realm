// Release tooling.
//   node build/release.mjs manifest            record the files of this version (build/releases/<v>.json)
//   node build/release.mjs update <fromVer> [out.zip]
//        make ASCII-Realm-Update-<v>.zip with only what changed since <fromVer>
//
// An installed game picks the update zip up from Downloads / Desktop (or a drop
// on its window) and patches itself; see updater.mjs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = path.join(ROOT, 'build', 'releases');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

// what ships inside resources/app (same list as the installer)
const ITEMS = ['index.html', 'desktop.mjs', 'desktop-preload.cjs', 'updater.mjs', 'server.js', 'CREDITS.md', 'lib', 'src', 'assets', 'build/icon.png', 'update-feed.json']
  .filter((f) => fs.existsSync(path.join(ROOT, f)));
const SKIP = (rel) => rel.startsWith('assets/models/') && !/\/(hero|fox|stork)\.glb$/.test(rel);

export const gamePackageJson = () => JSON.stringify({ name: 'ascii-realm', productName: 'ASCII Realm', version: VERSION, type: 'module', main: 'desktop.mjs', private: true }) + '\n';

function listFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) for (const n of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, n));
    else if (!SKIP(rel)) out.push(rel);
  };
  ITEMS.forEach(walk);
  return out;
}

function manifest() {
  const files = {};
  for (const rel of listFiles()) files[rel] = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
  return { version: VERSION, files };
}

function writeManifest() {
  fs.mkdirSync(REL, { recursive: true });
  const m = manifest();
  fs.writeFileSync(path.join(REL, `${VERSION}.json`), JSON.stringify(m, null, 1));
  return m;
}

// zip a staged set of game files; `files` null = everything
function makeZip(out, files, info) {
  const stage = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ar-update-'));
  for (const rel of files) {
    const dest = path.join(stage, 'app', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  fs.mkdirSync(path.join(stage, 'app'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'app', 'package.json'), gamePackageJson());
  fs.writeFileSync(path.join(stage, 'update.json'), JSON.stringify(info, null, 1));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-rq', out, 'update.json', 'app'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}

const [cmd, from, outArg] = process.argv.slice(2);
if (cmd === 'publish') {
  // publish to everyone: write release.json, commit, tag v<version>, push.
  // Installed games read release.json from the repo and fetch the changed files.
  const notes = from || '';
  const cur = writeManifest();
  const sizes = Object.fromEntries(Object.keys(cur.files).map((f) => [f, fs.statSync(path.join(ROOT, f)).size]));
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8')); } catch { return null; } })();
  const remove = prev ? Object.keys(prev.files).filter((f) => !(f in cur.files)) : [];
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: 'inherit' });
  const out = (...a) => execFileSync('git', a, { cwd: ROOT }).toString().trim();
  const sign = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
  // 1) commit the game files; players download them from this exact commit
  git('add', '-A');
  if (out('status', '--porcelain')) git('commit', '-q', '-m', `v${VERSION} game files${notes ? `\n\n${notes}` : ''}${sign}`);
  const sha = out('rev-parse', 'HEAD');
  // 2) point release.json at that commit and push both
  const rel = { version: VERSION, tag: sha, date: new Date().toISOString().slice(0, 10), notes, files: cur.files, sizes, remove, packageJson: gamePackageJson() };
  fs.writeFileSync(path.join(ROOT, 'release.json'), JSON.stringify(rel, null, 1) + '\n');
  git('add', 'release.json');
  git('commit', '-q', '-m', `Release v${VERSION}${sign}`);
  git('push', 'origin', 'HEAD:main');
  console.log(`published v${VERSION}: ${Object.keys(cur.files).length} files`);
} else if (cmd === 'release') {
  // online release: small update from <from> + full game zip, ready for GitHub
  const oldFile = path.join(REL, `${from}.json`);
  if (!fs.existsSync(oldFile)) { console.error(`no manifest for v${from} in build/releases`); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  const cur = writeManifest();
  const changed = Object.keys(cur.files).filter((f) => old.files[f] !== cur.files[f]);
  const removed = Object.keys(old.files).filter((f) => !(f in cur.files));
  const dir = path.join(ROOT, 'dist', `release-${VERSION}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const d = makeZip(path.join(dir, `ASCII-Realm-Update-${VERSION}-from-${from}.zip`), changed, { version: VERSION, from, requires: from, delete: removed });
  const f = makeZip(path.join(dir, `ASCII-Realm-Game-${VERSION}.zip`), Object.keys(cur.files), { version: VERSION });
  for (const z of [d, f]) console.log(`${path.basename(z)}  ${(fs.statSync(z).size / 1048576).toFixed(2)} MB`);
} else if (cmd === 'manifest') {
  const m = writeManifest();
  console.log(`recorded ${Object.keys(m.files).length} files for v${VERSION}`);
} else if (cmd === 'update') {
  const oldFile = path.join(REL, `${from}.json`);
  if (!fs.existsSync(oldFile)) { console.error(`no manifest for v${from} in build/releases`); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  const cur = writeManifest();
  const changed = Object.keys(cur.files).filter((f) => old.files[f] !== cur.files[f]);
  const removed = Object.keys(old.files).filter((f) => !(f in cur.files));
  const stage = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ar-update-'));
  for (const rel of changed) {
    const dest = path.join(stage, 'app', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  fs.writeFileSync(path.join(stage, 'app', 'package.json'), gamePackageJson());
  fs.writeFileSync(path.join(stage, 'update.json'), JSON.stringify({ version: VERSION, from, requires: from, delete: removed }, null, 1));
  const out = path.resolve(outArg || path.join(ROOT, 'dist', `ASCII-Realm-Update-${VERSION}.zip`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-rq', out, 'update.json', 'app'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`v${from} -> v${VERSION}: ${changed.length} changed, ${removed.length} removed -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
} else {
  console.log('usage: node build/release.mjs manifest | update <fromVersion> [out.zip] | release <previousVersion>');
}
