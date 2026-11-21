# Moho Windows 10/11 Desktop Agent Installer
$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Moho Windows 10/11 Desktop Agent Installer v5.0.0 " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Verify Windows 10 / Windows 11
$os = [System.Environment]::OSVersion.Version
if ($os.Major -lt 10 -or $os.Build -lt 10240) {
    Write-Error "Unsupported Windows version ($($os.ToString())). Windows 10 or Windows 11 is required."
    exit 1
}
$edition = if ($os.Build -ge 22000) { "Windows 11" } else { "Windows 10" }
Write-Host "[OK] Detected $edition (Build $($os.Build))" -ForegroundColor Green

# 2. Verify Python 3.10+
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Error "Python 3.10+ was not found in PATH. Install Python from https://www.python.org/downloads/windows/ and retry."
    exit 1
}
Write-Host "[OK] Found Python at $($pythonCmd.Source)" -ForegroundColor Green

# 3. Create virtual environment & install dependencies
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDir = Join-Path $scriptDir ".venv"

if (-not (Test-Path $venvDir)) {
    Write-Host "[...] Creating isolated Python virtual environment..." -ForegroundColor Yellow
    & python -m venv $venvDir
}

$venvPython = Join-Path $venvDir "Scripts\python.exe"
Write-Host "[...] Installing dependencies (websockets, mss, Pillow)..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $scriptDir "requirements.txt") --quiet

Write-Host ""
Write-Host "[DONE] Installation complete!" -ForegroundColor Green
Write-Host "Run 'start_agent.bat' (or '.\.venv\Scripts\python.exe moho_desktop_agent.py') to launch." -ForegroundColor Cyan
