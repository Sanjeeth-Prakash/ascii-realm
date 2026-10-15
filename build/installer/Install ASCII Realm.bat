@echo off
title ASCII Realm installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
if errorlevel 1 (
  echo.
  echo   Something went wrong. Read the message above, then press any key.
  pause >nul
) else (
  timeout /t 4 >nul
)
