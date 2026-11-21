@echo off
title Moho Windows Sandbox Real-Desktop Agent Launcher (v6.3.0)
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Virtual environment not found. Running install_windows.ps1 first...
    powershell -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

echo [INFO] Launching Windows Sandbox Real-Desktop Mode (Requires Windows 10/11 Pro, Enterprise, or Education)...
".venv\Scripts\python.exe" "%~dp0launch_windows_sandbox.py" %*
pause
