# EmergentInc V10 Visual Control Deck PowerShell Launcher
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Starting EmergentInc V10 Visual Control Deck..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js not found in PATH!" -ForegroundColor Red
    pause
    exit 1
}

Start-Process "http://127.0.0.1:8765"
node apps/server/dist/main.js $args
