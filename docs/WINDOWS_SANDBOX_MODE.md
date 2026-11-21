# Windows Sandbox Persistent Real-Desktop Mode & One-Click Launch (v7.0.0)

> **System Requirement Notice:** Windows Sandbox Mode requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education edition** with hardware virtualization enabled in BIOS/UEFI. **Windows Home edition is NOT supported** by [Microsoft Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/).

## 1. Automatic Persistent Storage (Never Lose AI Files, Logins, or Apps)
By default, Windows Sandbox discards everything inside the temporary container when closed. To give AI agents and users **full persistence** while keeping the OS isolated, `start_sandbox.bat` automatically creates and maps **`%USERPROFILE%\MohoSandboxData`** on your host to **`C:\MohoPersistent`** inside Windows Sandbox ([Microsoft Learn: Configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)):

| Host Folder (`%USERPROFILE%\MohoSandboxData\...`) | Inside Windows Sandbox | Purpose |
| :--- | :--- | :--- |
| `Workspace\` | `C:\MohoPersistent\Workspace` | Default persistent workspace for AI agents & Sandbox Terminal — all created files stay permanently on your PC. |
| `EdgeProfile\` | `C:\MohoPersistent\EdgeProfile` | Persistent Microsoft Edge profile (`--user-data-dir`) — keeps logins, cookies, bookmarks, and extensions across Sandbox sessions. |
| `ChromeProfile\` | `C:\MohoPersistent\ChromeProfile` | Persistent Google Chrome profile for Chrome Portable. |
| `PortableApps\` | `C:\MohoPersistent\PortableApps` | Auto-added to `PATH` inside Sandbox — drop portable apps (Chrome Portable, VS Code Portable, Git Portable, 7-Zip, etc.) here once and use them on every boot. |
| `Downloads\` | `C:\MohoPersistent\Downloads` | Persistent downloads folder accessible from Desktop shortcut. |
| `startup_apps.bat` | `C:\MohoPersistent\startup_apps.bat` | Optional script executed automatically every time Windows Sandbox boots (auto-launch apps or silent installers). |

On every Sandbox logon, `sandbox_bootstrap.bat` automatically places ready-to-use shortcuts on the Sandbox Desktop:
- **Moho Persistent Workspace**
- **Moho Persistent Downloads**
- **Edge (Saved Login & Profile)**
- **Chrome (Saved Login & Profile)** *(when `C:\MohoPersistent\PortableApps\Chrome\chrome.exe` is present)*

## 2. One-Click Launch from Any Web App (`moho-agent://`)
Non-technical users do not need to open Command Prompt or type commands:
1. Download and unzip [moho-desktop-agent-windows.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip).
2. Double-click **`setup_one_click.bat`** once. It sets up `.venv`, creates `%USERPROFILE%\MohoSandboxData`, and registers the per-user `moho-agent://` URI scheme under `HKCU\Software\Classes\moho-agent` (no Administrator privileges required; [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/shell/reg-middleware-apps)).
3. Click any 1-click launch button in your web app:
   - `moho-agent://start-sandbox` — Starts Windows Sandbox + Transparent Host Relay (`ws://127.0.0.1:47892`).
   - `moho-agent://start-agent` — Starts the lightweight Hidden Desktop + Sandbox Terminal Agent.
   - `moho-agent://open-workspace` — Opens your persistent AI workspace folder in Windows Explorer.

## 3. Enabling Windows Sandbox (One-Time on Windows 10/11 Pro/Enterprise/Education)
Open **Command Prompt (`cmd`) as Administrator** and run ([Microsoft Learn: Install Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)):
```cmd
dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
```
Restart your PC when prompted.

## 4. Operational Best Practices
- **Do not minimize the Windows Sandbox window:** Keep the Sandbox window open behind your browser (not minimized to the taskbar) so Windows DWM keeps live frame streaming smooth at full FPS.
- **Keep Chrome/Edge logins:** Always open the **Edge (Saved Login & Profile)** desktop shortcut inside Sandbox so your sessions persist in `C:\MohoPersistent\EdgeProfile`.
- **Custom RAM / Extra Folder:** `start_sandbox.bat --memory-mb 6144 --workspace "C:\MyProject"`
