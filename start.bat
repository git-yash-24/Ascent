@echo off
rem Ascent: install once, then run the live dev server and open the game.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  echo Or just double-click "Play Ascent.html" to play without installing anything.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing, this happens once...
  call npm install
)
start "" http://localhost:5173
call npm run dev -- --port 5173
