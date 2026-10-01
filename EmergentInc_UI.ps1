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

# Existing workspaces boot the approved frozen release. Build only a fresh installation.
node scripts/launch-approved.mjs --check
if ($LASTEXITCODE -eq 1) {
    Write-Host "[ERROR] Approved release validation failed. Use explicit controlled upgrade or recovery." -ForegroundColor Red
    exit 1
}
if ($LASTEXITCODE -eq 2) {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Start-Process "http://127.0.0.1:8765"

# Print every real LLM request/response/error to this console window.
# Set EMERGENT_LLM_TRACE=0 before launching to silence it.
if (-not $env:EMERGENT_LLM_TRACE) { $env:EMERGENT_LLM_TRACE = "1" }

node scripts/launch-approved.mjs $args
exit $LASTEXITCODE
