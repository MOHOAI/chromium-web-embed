@echo off
title Moho Desktop Agent (Inside Windows Sandbox - Persistent Real Input Mode v7.0.0)
set "PATH=C:\MohoPython;C:\MohoPython\Scripts;C:\MohoPersistent\PortableApps;%PATH%"
set "PYTHONPATH=C:\MohoAgent\.venv\Lib\site-packages;C:\MohoPython\Lib\site-packages"
set "PYTHONUTF8=1"

echo [Moho Sandbox Bootstrap] Opening Firewall port 47892...
netsh advfirewall firewall delete rule name="MohoDesktopAgent" >nul 2>&1
netsh advfirewall firewall add rule name="MohoDesktopAgent" dir=in action=allow protocol=TCP localport=47892 >nul 2>&1

echo [Moho Sandbox Bootstrap] Creating Desktop shortcuts to Persistent Storage and Browser Profiles...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop');" ^
  "$s1 = $ws.CreateShortcut((Join-Path $desk 'Moho Persistent Workspace.lnk')); $s1.TargetPath = 'C:\MohoPersistent\Workspace'; $s1.Save();" ^
  "$s2 = $ws.CreateShortcut((Join-Path $desk 'Moho Persistent Downloads.lnk')); $s2.TargetPath = 'C:\MohoPersistent\Downloads'; $s2.Save();" ^
  "$s3 = $ws.CreateShortcut((Join-Path $desk 'Edge (Saved Login & Profile).lnk')); $s3.TargetPath = 'msedge.exe'; $s3.Arguments = '--user-data-dir=\"C:\MohoPersistent\EdgeProfile\"'; $s3.Save();" ^
  "if (Test-Path 'C:\MohoPersistent\PortableApps\Chrome\chrome.exe') { $s4 = $ws.CreateShortcut((Join-Path $desk 'Chrome (Saved Login & Profile).lnk')); $s4.TargetPath = 'C:\MohoPersistent\PortableApps\Chrome\chrome.exe'; $s4.Arguments = '--user-data-dir=\"C:\MohoPersistent\ChromeProfile\"'; $s4.Save(); }" >nul 2>&1

if exist "C:\MohoPersistent\startup_apps.bat" (
    echo [Moho Sandbox Bootstrap] Running custom persistent startup_apps.bat...
    start "" cmd /c "C:\MohoPersistent\startup_apps.bat"
)

set "MOHO_TOKEN="
if exist "C:\MohoAgent\_sandbox_bridge\token.txt" (
    set /p MOHO_TOKEN=<"C:\MohoAgent\_sandbox_bridge\token.txt"
)

set "WORKSPACE_ARG=--workspace C:\MohoPersistent\Workspace"
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
