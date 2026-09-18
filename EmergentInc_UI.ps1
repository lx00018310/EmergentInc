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

# Print every real LLM request/response/error to this console window.
# Set EMERGENT_LLM_TRACE=0 before launching to silence it.
if (-not $env:EMERGENT_LLM_TRACE) { $env:EMERGENT_LLM_TRACE = "1" }

node apps/server/dist/main.js $args
