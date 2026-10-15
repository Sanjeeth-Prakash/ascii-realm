@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org then run this again. & pause & exit /b)
if not exist node_modules\electron (
  echo First run: downloading the desktop runtime, about 100 MB, one time only...
  call npm install
)
call npx electron .
