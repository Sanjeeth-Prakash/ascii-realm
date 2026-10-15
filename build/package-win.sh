#!/bin/sh
# Assemble a ready-to-play Windows build: "ASCII Realm/ASCII Realm.exe".
# Usage: build/package-win.sh path/to/electron-vXX-win32-x64.zip out_dir
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$1"; OUT="${2:-$SRC/dist}"
GAME="$OUT/ASCII Realm"
rm -rf "$GAME"; mkdir -p "$GAME"
unzip -q "$ZIP" -d "$GAME"
mv "$GAME/electron.exe" "$GAME/ASCII Realm.exe"
rm -f "$GAME/resources/default_app.asar"
APP="$GAME/resources/app"
mkdir -p "$APP/build"
cp -r "$SRC/index.html" "$SRC/desktop.mjs" "$SRC/desktop-preload.cjs" "$SRC/server.js" "$SRC/lib" "$SRC/src" "$SRC/assets" "$SRC/CREDITS.md" "$APP/"
cp "$SRC/build/icon.png" "$APP/build/"
cat > "$APP/package.json" <<JSON
{ "name": "ascii-realm", "productName": "ASCII Realm", "version": "0.4.0", "type": "module", "main": "desktop.mjs", "private": true }
JSON
cp "$SRC/build/icon.ico" "$GAME/ASCII Realm.ico"
cat > "$GAME/README.txt" <<TXT
ASCII REALM  v0.4 (early build)

To play: double-click "ASCII Realm.exe".

Windows may show "Windows protected your PC" the first time, because the game
isn't signed by a paid certificate. Click "More info", then "Run anyway".

Your saves and settings live in %APPDATA%\\ASCII Realm, so they carry over when
you replace this folder with a newer version.

Updating: replace this whole folder with the new one, or, for small updates,
replace only the "resources\\app" folder.

Esc opens the menu in-game. All controls can be changed under Options.
TXT
echo "built: $GAME"
