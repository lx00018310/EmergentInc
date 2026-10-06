@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title EmergentInc Approved Runtime
echo ========================================================
echo  Starting the approved EmergentInc release...
echo ========================================================

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in PATH! Please install Node.js 22+.
    pause
    exit /b 1
)

rem Guard: refuse to start a second server on the same port (EADDRINUSE protection).
netstat -ano | findstr /R /C:":8765 .*LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo [ERROR] Port 8765 is already in use - EmergentInc server is probably already running.
    echo         Close the existing server window first, or check: netstat -ano ^| findstr 8765
    pause
    exit /b 1
)

rem Existing workspaces boot the approved frozen release; only fresh installations need a build.
node scripts/launch-approved.mjs --check
if %errorlevel% equ 1 (
    echo [ERROR] Approved release validation failed. Use explicit controlled upgrade or recovery.
    pause
    exit /b 1
)
if %errorlevel% equ 2 (
    call npm.cmd run build
    if errorlevel 1 exit /b 1
    call npm.cmd --prefix frontend run build
    if errorlevel 1 exit /b 1
)

start "" http://127.0.0.1:8765

rem Print every real LLM request/response/error to this console window.
rem Set EMERGENT_LLM_TRACE=0 before launching to silence it.
if not defined EMERGENT_LLM_TRACE set EMERGENT_LLM_TRACE=1

node scripts/launch-approved.mjs %*
if %errorlevel% neq 0 (
    echo.
    echo [SERVER STOPPED OR ERRORED]
    pause
)
