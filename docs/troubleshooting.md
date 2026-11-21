# Troubleshooting & Common Errors (v7.0.2)

Quick solutions for end users, developers, and AI agents.

## 1. Windows Sandbox & Automatic Launch

### *"Only one instance of Windows Sandbox is allowed"* (`Une seule instance de Bac à sable Windows est autorisée`)
- **Cause:** A previous Windows Sandbox instance is still running in the background.
- **Fix:** `v7.0.2` includes an automatic Single-Instance Guard and launch-button lock. If a stale instance from an older version is stuck, close it once in `cmd`:
  ```cmd
  taskkill /F /IM WindowsSandboxClient.exe 2>nul
  taskkill /F /IM pythonw.exe 2>nul
  ```

### `WindowsSandbox.exe was not found`
- **Cause:** Windows Sandbox is not enabled yet, or your PC runs **Windows 10/11 Home** ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)).
- **Fix (Pro / Enterprise / Education):** Open **Command Prompt (`cmd`) as Administrator**, run:
  ```cmd
  dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
  ```
  and restart Windows.
- **Fix (Windows Home):** `Moho-OneClick-Installer.bat` automatically runs the lightweight Hidden Desktop + Sandbox Terminal mode instead.

### Live Stream Freezes or Turns Black
- **Cause:** Minimizing the Windows Sandbox window pauses DWM rendering.
- **Fix:** Never minimize Windows Sandbox manually — `v7.0.2` hides it stealthily without minimizing so DWM keeps streaming at full FPS.

### Files or Browser Logins Disappeared After Closing Sandbox
- **Fix:** Always save files inside **`C:\MohoPersistent\Workspace`** (Desktop shortcut: *Moho Persistent Workspace*) and browse using the **Edge (Saved Login)** desktop shortcut so everything persists in `%USERPROFILE%\MohoSandboxData`.

## 2. Local Testing & Extension Issues

### `python -m http.server 8080` Does Not Open in Chrome (`Serving HTTP on :: port 8080`)
- **Cause:** Python 3.14 on Windows defaults to IPv6 (`::`) or port `8080` is busy.
- **Fix:** Bind explicitly to IPv4 `127.0.0.1`:
  ```cmd
  python -m http.server 8085 --bind 127.0.0.1
  ```
  Then open `http://127.0.0.1:8085/...`.

### `Unauthorized: invalid desktop agent token`
- **Fix:** Leave the token field **empty** and click **Connect** — the Chrome Extension (`v7.0.2`) automatically fetches the active token from `http://127.0.0.1:47893/session`.

### `Bridge error` or Extension Not Responding
- **Fix:** Open `chrome://extensions`, click **Reload** on **Moho Browser Workspace (v7.0.2)**, then refresh (`F5`) your web app tab.
