@echo off
set "PATH=C:\MohoPython;C:\MohoPython\Scripts;C:\MohoPersistent\PortableApps;%PATH%"
set "PYTHONPATH=C:\MohoAgent\.venv\Lib\site-packages;C:\MohoPython\Lib\site-packages"
set "PYTHONUTF8=1"

netsh advfirewall firewall delete rule name="MohoDesktopAgent" >nul 2>&1
netsh advfirewall firewall add rule name="MohoDesktopAgent" dir=in action=allow protocol=TCP localport=47892 >nul 2>&1

powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop');" ^
  "$s1 = $ws.CreateShortcut((Join-Path $desk 'Moho Persistent Workspace.lnk')); $s1.TargetPath = 'C:\MohoPersistent\Workspace'; $s1.Save();" ^
  "$s2 = $ws.CreateShortcut((Join-Path $desk 'Moho Persistent Downloads.lnk')); $s2.TargetPath = 'C:\MohoPersistent\Downloads'; $s2.Save();" ^
  "$s3 = $ws.CreateShortcut((Join-Path $desk 'Edge (Saved Login).lnk')); $s3.TargetPath = 'msedge.exe'; $s3.Arguments = '--user-data-dir=\"C:\MohoPersistent\EdgeProfile\"'; $s3.Save();" ^
  "if (Test-Path 'C:\MohoPersistent\PortableApps\Chrome\chrome.exe') { $s4 = $ws.CreateShortcut((Join-Path $desk 'Chrome (Saved Login).lnk')); $s4.TargetPath = 'C:\MohoPersistent\PortableApps\Chrome\chrome.exe'; $s4.Arguments = '--user-data-dir=\"C:\MohoPersistent\ChromeProfile\"'; $s4.Save(); }" >nul 2>&1

if exist "C:\MohoPersistent\startup_apps.bat" (
    start "" /B cmd /c "C:\MohoPersistent\startup_apps.bat"
)

set "MOHO_TOKEN="
if exist "C:\MohoAgent\_sandbox_bridge\token.txt" (
    set /p MOHO_TOKEN=<"C:\MohoAgent\_sandbox_bridge\token.txt"
)

set "WORKSPACE_ARG=--workspace C:\MohoPersistent\Workspace"
if exist "C:\MohoWorkspace" (
    set "WORKSPACE_ARG=--workspace C:\MohoWorkspace"
)

set "PYW=C:\MohoPython\pythonw.exe"
if not exist "%PYW%" set "PYW=C:\MohoPython\python.exe"

if "%MOHO_TOKEN%"=="" (
    start "" "%PYW%" "C:\MohoAgent\moho_desktop_agent.py" --host 0.0.0.0 --port 47892 --mode real-input --no-auth --announce-file "C:\MohoAgent\_sandbox_bridge\sandbox_endpoint.json" %WORKSPACE_ARG%
) else (
    start "" "%PYW%" "C:\MohoAgent\moho_desktop_agent.py" --host 0.0.0.0 --port 47892 --mode real-input --token "%MOHO_TOKEN%" --announce-file "C:\MohoAgent\_sandbox_bridge\sandbox_endpoint.json" %WORKSPACE_ARG%
)
exit /b 0
