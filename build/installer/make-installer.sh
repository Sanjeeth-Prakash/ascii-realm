#!/bin/sh
# Build the small installer zip: build/installer/make-installer.sh out.zip
set -e
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$SRC/dist/ASCII-Realm-Installer.zip}"
STAGE="$(mktemp -d)/ASCII Realm Installer"
mkdir -p "$STAGE/installer/game/build"
cp "$SRC/build/installer/Install ASCII Realm.bat" "$STAGE/"
cp "$SRC/build/installer/install.ps1" "$SRC/build/installer/uninstall.bat" "$SRC/build/icon.ico" "$STAGE/installer/"
cp -r "$SRC/index.html" "$SRC/desktop.mjs" "$SRC/desktop-preload.cjs" "$SRC/updater.mjs" "$SRC/server.js" "$SRC/lib" "$SRC/src" "$SRC/assets" "$SRC/CREDITS.md" "$STAGE/installer/game/"
if [ -f "$SRC/update-feed.json" ]; then cp "$SRC/update-feed.json" "$STAGE/installer/game/"; fi
cp "$SRC/build/icon.png" "$STAGE/installer/game/build/"
# ship only the models the game uses and credits (others stay in the project)
for f in "$STAGE/installer/game/assets/models/"*; do
  case "$(basename "$f")" in hero.glb|fox.glb|stork.glb) ;; *) rm -f "$f" ;; esac
done
VER=$(node -e "console.log(require('$SRC/package.json').version)")
# remember exactly what this version contains, so later updates only carry changes
node "$SRC/build/release.mjs" manifest
printf '{ "name": "ascii-realm", "productName": "ASCII Realm", "version": "%s", "type": "module", "main": "desktop.mjs", "private": true }\n' "$VER" > "$STAGE/installer/game/package.json"
cat > "$STAGE/README.txt" <<TXT
ASCII REALM  v$VER

INSTALL
  Double-click "Install ASCII Realm.bat".
  The first time, it downloads the game runtime (about 110 MB) from the
  official Electron releases on GitHub, installs the game and puts an
  "ASCII Realm" shortcut on your Desktop and in the Start Menu.

UPDATE (no reinstall, no uninstall)
  Updates come as a small "ASCII-Realm-Update-x.y.z.zip".
  Just leave it in your Downloads folder (or on your Desktop) and start the
  game: the title screen shows "Install update". Pick it and the game patches
  itself and restarts. You can also drag the zip onto the game window.
  Saves are kept.

PLAY
  Use the shortcut. Esc opens the menu in-game; every control can be changed
  under Options.

UNINSTALL
  Run "Uninstall ASCII Realm.bat" in the game folder
  (%LOCALAPPDATA%\\Programs\\ASCII Realm).

Saves and settings: %APPDATA%\\ASCII Realm
TXT
rm -f "$OUT"
(cd "$(dirname "$STAGE")" && zip -rq "$OUT" "ASCII Realm Installer")
echo "built: $OUT"
