@echo off
title Moho Automatic Setup and Launcher v7.0.1
setlocal enabledelayedexpansion

echo ====================================================================
echo   Moho Automatic Setup and Silent Launcher v7.0.1
echo   For Non-Technical Users - Everything runs automatically!
echo ====================================================================
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\MohoDesktopAgent\app"
set "ZIP_URL=https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip"
set "ZIP_TMP=%TEMP%\moho-desktop-agent-windows.zip"

REM Step 1: Check Python and auto-install via winget if missing
where python >nul 2>&1
if not errorlevel 1 goto python_ok
where py >nul 2>&1
if not errorlevel 1 goto python_ok

echo [1/4] Python was not found. Installing Python 3.12 automatically...
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Please install Python 3.12 from https://www.python.org/downloads/ and run this file again.
    pause
    exit /b 1
)
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"

:python_ok
echo [1/4] Python is ready.

REM Step 2: Download latest desktop-agent bundle if not running inside desktop-agent folder
if exist "%~dp0moho_desktop_agent.py" (
    set "INSTALL_DIR=%~dp0"
    goto files_ready
)

echo [2/4] Downloading Moho Desktop Agent to "%INSTALL_DIR%" ...
mkdir "%INSTALL_DIR%" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_TMP%' -UseBasicParsing; Expand-Archive -Path '%ZIP_TMP%' -DestinationPath '%INSTALL_DIR%' -Force"
if errorlevel 1 (
    echo [ERROR] Download failed. Please check your internet connection and try again.
    pause
    exit /b 1
)

:files_ready
cd /d "%INSTALL_DIR%"
echo [2/4] Agent files ready.

REM Step 3: Create venv, persistent folders, and register moho-agent:// protocol
if not exist ".venv\Scripts\python.exe" (
    echo [3/4] Installing required Python packages...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%\install_windows.ps1"
) else (
    echo [3/4] Python packages already installed.
)

mkdir "%USERPROFILE%\MohoSandboxData\Workspace" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\EdgeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\ChromeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\PortableApps" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\Downloads" 2>nul

set "PYW_EXE=%INSTALL_DIR%\.venv\Scripts\pythonw.exe"
if not exist "%PYW_EXE%" set "PYW_EXE=%INSTALL_DIR%\.venv\Scripts\python.exe"
set "DISP=%INSTALL_DIR%\protocol_dispatcher.py"

reg add "HKCU\Software\Classes\moho-agent" /ve /d "URL:Moho Desktop Agent Protocol" /f >nul
reg add "HKCU\Software\Classes\moho-agent" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\moho-agent\shell\open\command" /ve /d "\"%PYW_EXE%\" \"%DISP%\" \"%%1\"" /f >nul

echo [4/4] Starting Moho in silent background mode...
if exist "%SystemRoot%\System32\WindowsSandbox.exe" (
    start "" "%PYW_EXE%" "%INSTALL_DIR%\launch_windows_sandbox.py"
) else (
    start "" "%PYW_EXE%" "%INSTALL_DIR%\moho_desktop_agent.py"
)

echo.
echo [READY] Everything is running silently in the background!
echo Return to your web app and click Connect - authentication is automatic.
timeout /t 4 >nul
exit /b 0
