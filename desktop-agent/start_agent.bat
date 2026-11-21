@echo off
title Moho Windows 10/11 Desktop & Sandbox Terminal Agent v6.3.0
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Virtual environment not found. Running install_windows.ps1 first...
    powershell -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

echo [INFO] Starting Moho Desktop Agent v6.3.0 on ws://127.0.0.1:47892 ...
echo [TIP] On Windows 10/11 Pro/Enterprise/Education, run start_sandbox.bat for 100%% full Windows Sandbox desktop control!
".venv\Scripts\python.exe" "%~dp0moho_desktop_agent.py" %*
pause
