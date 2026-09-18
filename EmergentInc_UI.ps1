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

# Guard: refuse to start a second server on the same port (EADDRINUSE protection).
$portBusy = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
    Write-Host "[ERROR] Port 8765 is already in use - EmergentInc server is probably already running." -ForegroundColor Red
    Write-Host "        Close the existing server window first (PID: $($portBusy.OwningProcess))."
    pause
    exit 1
}

# Build the frontend so the UI always matches current source code.
Write-Host "Building frontend UI..." -ForegroundColor Cyan
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host ""
    Write-Host "[BUILD FAILED] Frontend build error - NOT starting server with a stale UI." -ForegroundColor Red
    pause
    exit 1
}
Pop-Location

Start-Process "http://127.0.0.1:8765"

# Print every real LLM request/response/error to this console window.
# Set EMERGENT_LLM_TRACE=0 before launching to silence it.
if (-not $env:EMERGENT_LLM_TRACE) { $env:EMERGENT_LLM_TRACE = "1" }

node apps/server/dist/main.js $args
