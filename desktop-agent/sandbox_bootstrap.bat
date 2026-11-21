@echo off
title Moho Desktop Agent (Inside Windows Sandbox - Real Input Mode)
set "PATH=C:\MohoPython;C:\MohoPython\Scripts;%PATH%"
set "PYTHONPATH=C:\MohoAgent\.venv\Lib\site-packages;C:\MohoPython\Lib\site-packages"
set "PYTHONUTF8=1"

echo [Moho Sandbox Bootstrap] Opening Firewall port 47892...
netsh advfirewall firewall delete rule name="MohoDesktopAgent" >nul 2>&1
netsh advfirewall firewall add rule name="MohoDesktopAgent" dir=in action=allow protocol=TCP localport=47892 >nul 2>&1

set "MOHO_TOKEN="
if exist "C:\MohoAgent\_sandbox_bridge\token.txt" (
    set /p MOHO_TOKEN=<"C:\MohoAgent\_sandbox_bridge\token.txt"
)

set "WORKSPACE_ARG="
if exist "C:\MohoWorkspace" (
    set "WORKSPACE_ARG=--workspace C:\MohoWorkspace"
)

echo [Moho Sandbox Bootstrap] Starting Real-Input Desktop Agent on 0.0.0.0:47892 ...
if "%MOHO_TOKEN%"=="" (
    "C:\MohoPython\python.exe" "C:\MohoAgent\moho_desktop_agent.py" --host 0.0.0.0 --port 47892 --mode real-input --no-auth --announce-file "C:\MohoAgent\_sandbox_bridge\sandbox_endpoint.json" %WORKSPACE_ARG%
) else (
    "C:\MohoPython\python.exe" "C:\MohoAgent\moho_desktop_agent.py" --host 0.0.0.0 --port 47892 --mode real-input --token "%MOHO_TOKEN%" --announce-file "C:\MohoAgent\_sandbox_bridge\sandbox_endpoint.json" %WORKSPACE_ARG%
)
pause
