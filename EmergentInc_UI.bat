@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title EmergentInc V10 Small Runtime Console
echo ========================================================
echo  Starting EmergentInc V10 Visual Control Deck...
echo ========================================================

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in PATH! Please install Node.js 22+.
    pause
    exit /b 1
)

start "" http://127.0.0.1:8765

node apps/server/dist/main.js
if %errorlevel% neq 0 (
    echo.
    echo [SERVER STOPPED OR ERRORED]
    pause
)
