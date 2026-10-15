#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
[ -d node_modules/electron ] || { echo "First run: downloading the desktop runtime (about 100 MB, one time only)..."; npm install; }
npx electron .
