# EmergentInc V5 Visual Control Deck PowerShell Launcher
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Starting EmergentInc V5 Visual Control Deck..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "[ERROR] Python not found in PATH!" -ForegroundColor Red
    pause
    exit 1
}

python -m ui.app
