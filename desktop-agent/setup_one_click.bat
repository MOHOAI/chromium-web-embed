@echo off
title Moho One-Click Setup v7.0.1
cd /d "%~dp0"

echo ====================================================================
echo   Moho Desktop Agent and Windows Sandbox - One-Click Setup v7.0.1
echo ====================================================================
echo.

if exist ".venv\Scripts\python.exe" goto venv_ready
echo [1/3] Installing local Python environment...
powershell -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
if errorlevel 1 (
    echo [ERROR] Python setup failed. Make sure Python 3.10 or newer is installed.
    pause
    exit /b 1
)
goto after_venv

:venv_ready
echo [1/3] Local Python environment is already ready.

:after_venv
echo [2/3] Creating persistent Sandbox folders in "%USERPROFILE%\MohoSandboxData" ...
mkdir "%USERPROFILE%\MohoSandboxData\Workspace" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\EdgeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\ChromeProfile" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\PortableApps" 2>nul
mkdir "%USERPROFILE%\MohoSandboxData\Downloads" 2>nul

echo [3/3] Registering moho-agent:// 1-click web launch protocol...
set "PYW_EXE=%~dp0.venv\Scripts\pythonw.exe"
if not exist "%PYW_EXE%" set "PYW_EXE=%~dp0.venv\Scripts\python.exe"
set "DISP=%~dp0protocol_dispatcher.py"

reg add "HKCU\Software\Classes\moho-agent" /ve /d "URL:Moho Desktop Agent Protocol" /f >nul
reg add "HKCU\Software\Classes\moho-agent" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\moho-agent\shell\open\command" /ve /d "\"%PYW_EXE%\" \"%DISP%\" \"%%1\"" /f >nul

echo.
echo [DONE] Setup complete!
echo   - Persistent AI/User data folder: %USERPROFILE%\MohoSandboxData
echo   - One-click silent web launch enabled: moho-agent://start-sandbox
echo                                          moho-agent://start-agent
echo                                          moho-agent://open-workspace
echo.
echo You can now close this window and click Launch directly inside your web app!
pause
