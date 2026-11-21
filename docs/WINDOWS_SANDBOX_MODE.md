# Windows Sandbox Persistent Mode & Automatic One-Click Launch (v7.0.2)

> **System Requirement Notice:** Windows Sandbox Mode requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education edition** with hardware virtualization enabled in BIOS/UEFI. **Windows Home edition is NOT supported** by [Microsoft Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/).

## 1. Zero-Code Automatic Launch Flow (`Moho-OneClick-Installer.bat` + `moho-agent://`)
Designed so non-technical users never touch Command Prompt, Python, or Auth Tokens:

1. **Single Button Click in Any Web App:** Calling `launchOrInstallMohoAgent("startSandbox")` triggers `moho-agent://start-sandbox` (registered per-user under `HKCU\Software\Classes\moho-agent` — no Admin privileges required; [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/shell/reg-middleware-apps)).
2. **Automatic Installer Download Fallback:** If `moho-agent://` is not yet registered on the PC, the web app automatically downloads **[Moho-OneClick-Installer.bat](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/Moho-OneClick-Installer.bat)**, which:
   - Checks for Python 3.10+ and auto-installs Python 3.12 via `winget` if missing.
   - Downloads and extracts `moho-desktop-agent-windows.zip` into `%LOCALAPPDATA%\MohoDesktopAgent\app`.
   - Installs `.venv` packages, creates `%USERPROFILE%\MohoSandboxData`, registers `moho-agent://`, and launches silently.
3. **Silent Stealth Background Execution:**
   - Host relay and Sandbox agent run via `pythonw.exe` (no scary black CMD windows).
   - The Windows Sandbox window is stealth-hidden behind user windows (`WS_EX_TOOLWINDOW | WS_EX_LAYERED` alpha=1 + `HWND_BOTTOM`) **without minimizing it**, so Windows DWM keeps live streaming at full FPS while staying invisible to end users. Pass `--visible` (or `moho-agent://start-sandbox-vis`) if you want to inspect the Sandbox window directly.
4. **Single-Instance Guard + Auto-Connect Live Stream:**
   - Before spawning `WindowsSandbox.exe`, `launch_windows_sandbox.py` checks `http://127.0.0.1:47893/session` and `WindowsSandboxClient.exe` to reuse any active instance and prevent *"Only one instance of Windows Sandbox is allowed"*.
   - The web UI locks the Launch button with a loading spinner, polls automatically, fetches the token via the extension-only localhost endpoint (`http://127.0.0.1:47893/session`), and starts the live stream automatically when ready.

## 2. Automatic Persistent Storage (`%USERPROFILE%\MohoSandboxData` <-> `C:\MohoPersistent`)
Mapped automatically via `<MappedFolders>` ([Microsoft Learn: Configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)) so AI agents and users never lose work when Sandbox closes:

| Host Folder (`%USERPROFILE%\MohoSandboxData\...`) | Inside Windows Sandbox | Purpose |
| :--- | :--- | :--- |
| `Workspace\` | `C:\MohoPersistent\Workspace` | Persistent AI & user project files (default Sandbox Terminal workspace). |
| `EdgeProfile\` | `C:\MohoPersistent\EdgeProfile` | Persistent Microsoft Edge profile (`--user-data-dir`) — keeps logins, cookies, bookmarks, and extensions. |
| `ChromeProfile\` | `C:\MohoPersistent\ChromeProfile` | Persistent Google Chrome profile (for Chrome Portable). |
| `PortableApps\` | `C:\MohoPersistent\PortableApps` | Auto-added to `PATH` inside Sandbox — drop portable apps here once and keep them across sessions. |
| `Downloads\` | `C:\MohoPersistent\Downloads` | Persistent downloads folder. |
| `startup_apps.bat` | `C:\MohoPersistent\startup_apps.bat` | Optional script auto-executed on every Sandbox boot. |

## 3. Enabling Windows Sandbox (One-Time, Administrator `cmd`)
```cmd
dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
```
Restart Windows when prompted ([Microsoft Learn: Install Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)).
