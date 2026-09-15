@echo off
chcp 65001 > nul
title EmergentInc V5 Visual Control Deck
echo ========================================================
echo  Starting EmergentInc V5 Visual Control Deck...
echo ========================================================

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in PATH! Please install Python 3.10+.
    pause
    exit /b 1
)

python -m emergentinc.ui.app
if %errorlevel% neq 0 (
    echo.
    echo [SERVER STOPPED OR ERRORED]
    pause
)
