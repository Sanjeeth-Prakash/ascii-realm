@echo off
title ASCII Realm installer
rem Installs the game from this folder (a copy of the GitHub repository).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\installer\install.ps1" -Source "%~dp0."
if errorlevel 1 (
  echo.
  echo   Something went wrong. Read the message above, then press any key.
  pause >nul
) else (
  timeout /t 4 >nul
)
