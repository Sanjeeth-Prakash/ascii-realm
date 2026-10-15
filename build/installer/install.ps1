# ASCII Realm installer for Windows.
# First run: downloads the Electron runtime once (official GitHub release,
# checksum verified), installs the game and adds Desktop + Start Menu shortcuts.
# Later runs: only replace the game files (fast update, no download).
# Your saves and settings are in %APPDATA%\ASCII Realm and are never touched.

param([switch]$Uninstall, [string]$Source)
# -Source <folder>: install from a copy of the GitHub repository ("Code > Download ZIP")

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Version  = '33.2.1'
$Url      = "https://github.com/electron/electron/releases/download/v$Version/electron-v$Version-win32-x64.zip"
$Sha256   = 'C325A6D905C67107E166267813EA2151AE7FD316C0A88DE0081DB0B9851A9946'
$Here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest     = Join-Path $env:LOCALAPPDATA 'Programs\ASCII Realm'
$Exe      = Join-Path $Dest 'ASCII Realm.exe'
$Marker   = Join-Path $Dest "runtime-$Version.txt"
$Desktop  = [Environment]::GetFolderPath('Desktop')
$Programs = [Environment]::GetFolderPath('Programs')
$Links    = @($Desktop, $Programs) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'ASCII Realm.lnk' }

function Say($msg) { Write-Host "  $msg" }

Write-Host ''
Write-Host '  A S C I I   R E A L M' -ForegroundColor DarkYellow
Write-Host ''

if (Get-Process -Name 'ASCII Realm' -ErrorAction SilentlyContinue) {
  Say 'Please close the game first, then run this again.'
  exit 1
}

if ($Uninstall) {
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  foreach ($l in $Links) { if (Test-Path $l) { Remove-Item $l -Force } }
  Say 'ASCII Realm was removed.'
  Say "Your saves are still in $env:APPDATA\ASCII Realm (delete that folder too to remove them)."
  exit 0
}

# ---- runtime (once) ----
if (-not (Test-Path $Marker)) {
  $zip = Join-Path $env:TEMP "electron-v$Version-win32-x64.zip"
  $ok = (Test-Path $zip) -and ((Get-FileHash $zip -Algorithm SHA256).Hash -eq $Sha256)
  if (-not $ok) {
    Say 'Downloading the game runtime (about 110 MB, one time only)...'
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $Sha256) {
      Remove-Item $zip -Force
      throw 'The download was corrupted (checksum mismatch). Please run the installer again.'
    }
  }
  Say 'Unpacking...'
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  New-Item -ItemType Directory -Path $Dest | Out-Null
  Expand-Archive -Path $zip -DestinationPath $Dest -Force
  Rename-Item (Join-Path $Dest 'electron.exe') 'ASCII Realm.exe'
  $def = Join-Path $Dest 'resources\default_app.asar'
  if (Test-Path $def) { Remove-Item $def -Force }
  Set-Content -Path $Marker -Value "Electron $Version"
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
} else {
  Say 'Runtime already installed - updating game files only.'
}

# ---- game files (every run) ----
$app = Join-Path $Dest 'resources\app'
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
if ($Source) {
  # straight from the repository: copy only what the game needs
  $Source = (Resolve-Path $Source).Path
  New-Item -ItemType Directory -Path $app | Out-Null
  foreach ($item in @('index.html', 'desktop.mjs', 'desktop-preload.cjs', 'updater.mjs', 'server.js', 'CREDITS.md', 'update-feed.json', 'lib', 'src', 'assets')) {
    $p = Join-Path $Source $item
    if (Test-Path $p) { Copy-Item $p (Join-Path $app $item) -Recurse -Force }
  }
  New-Item -ItemType Directory -Path (Join-Path $app 'build') -Force | Out-Null
  Copy-Item (Join-Path $Source 'build\icon.png') (Join-Path $app 'build\icon.png') -Force
  $ver = (Get-Content (Join-Path $Source 'package.json') -Raw | ConvertFrom-Json).version
  Set-Content -Path (Join-Path $app 'package.json') -Value ('{ "name": "ascii-realm", "productName": "ASCII Realm", "version": "' + $ver + '", "type": "module", "main": "desktop.mjs", "private": true }')
  Copy-Item (Join-Path $Source 'build\icon.ico') (Join-Path $Dest 'ASCII Realm.ico') -Force
  Copy-Item (Join-Path $Here 'uninstall.bat') (Join-Path $Dest 'Uninstall ASCII Realm.bat') -Force
} else {
  Copy-Item (Join-Path $Here 'game') $app -Recurse
  Copy-Item (Join-Path $Here 'icon.ico') (Join-Path $Dest 'ASCII Realm.ico') -Force
  Copy-Item (Join-Path $Here 'uninstall.bat') (Join-Path $Dest 'Uninstall ASCII Realm.bat') -Force
}
Copy-Item (Join-Path $Here 'install.ps1') (Join-Path $Dest 'install.ps1') -Force

# ---- shortcuts ----
try { $shell = New-Object -ComObject WScript.Shell } catch { $shell = $null; Say 'Could not create shortcuts; start the game from the install folder.' }
foreach ($l in $(if ($shell) { $Links } else { @() })) {
  $s = $shell.CreateShortcut($l)
  $s.TargetPath = $Exe
  $s.WorkingDirectory = $Dest
  $s.IconLocation = (Join-Path $Dest 'ASCII Realm.ico')
  $s.Description = 'ASCII Realm'
  $s.Save()
}

$ver = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
Say "Installed ASCII Realm v$ver."
if ($shell) { Say 'Shortcuts added to your Desktop and Start Menu.' }
Say "Game folder: $Dest"
Say 'Starting the game...'
Start-Process -FilePath $Exe -WorkingDirectory $Dest
