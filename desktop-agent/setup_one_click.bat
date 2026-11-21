@echo off
title Moho One-Click Setup (v7.0.0)
cd /d "%~dp0"

echo ====================================================================
echo   Moho Desktop Agent & Windows Sandbox — One-Click Setup (v7.0.0)
echo ====================================================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Installing local Python environment (.venv)...
    powershell -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
    if errorlevel 1 (
        echo [ERROR] Python setup failed. Make sure Python 3.10+ is installed from python.org.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Local Python environment (.venv) already ready.
)

echo [2/3] Creating persistent Sandbox folders in "%USERPROFILE%\MohoSandboxData" ...
mkdir "%USERPROFILE%\MohoSandboxData\Workspace" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\EdgeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\ChromeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\PortableApps" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\Downloads" 2>nul

echo [3/3] Registering moho-agent:// 1-click web launch protocol (current user, no Admin needed)...
set "PY_EXE=%~dp0.venv\Scripts\python.exe"
set "DISP=%~dp0protocol_dispatcher.py"

reg add "HKCU\Software\Classes\moho-agent" /ve /d "URL:Moho Desktop Agent Protocol" /f >nul
reg add "HKCU\Software\Classes\moho-agent" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\moho-agent\shell\open\command" /ve /d "\"%PY_EXE%\" \"%DISP%\" \"%%1\"" /f >nul

echo.
echo [DONE] Setup complete!
echo   - Persistent AI/User data folder: %USERPROFILE%\MohoSandboxData
echo   - One-click web launch enabled:   moho-agent://start-sandbox
echo                                     moho-agent://start-agent
echo                                     moho-agent://open-workspace
echo.
echo You can now launch Windows Sandbox or the Desktop Agent with 1 click directly from your web app!
pause
