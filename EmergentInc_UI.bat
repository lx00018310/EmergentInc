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

rem Build the frontend so the UI always matches current source code.
rem (Stale bundles previously showed outdated controls - e.g. the removed one-click reconcile.)
echo Building frontend UI...
pushd frontend
call npm run build
if %errorlevel% neq 0 (
    popd
    echo.
    echo [BUILD FAILED] Frontend build error - NOT starting server with a stale UI.
    pause
    exit /b 1
)
popd

start "" http://127.0.0.1:8765

rem Print every real LLM request/response/error to this console window.
rem Set EMERGENT_LLM_TRACE=0 before launching to silence it.
if not defined EMERGENT_LLM_TRACE set EMERGENT_LLM_TRACE=1

node apps/server/dist/main.js %*
if %errorlevel% neq 0 (
    echo.
    echo [SERVER STOPPED OR ERRORED]
    pause
)
