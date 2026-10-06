@echo off
chcp 65001 > nul
cd /d "%~dp0"
node scripts/version-upgrade.mjs %*
if "%~1"=="" pause
