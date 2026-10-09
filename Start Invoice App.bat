@echo off
title Invoice Generator
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo  Download and install it from https://nodejs.org ^(LTS version^), then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  First-time setup: installing, please wait a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)

node --disable-warning=ExperimentalWarning scripts\start.js
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo  Something went wrong - see the messages above.
pause
