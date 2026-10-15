@echo off
title ASCII Realm uninstaller
set "PS1=%~dp0install.ps1"
if not exist "%PS1%" set "PS1=%~dp0installer\install.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Uninstall
pause
