# Moho Windows 10/11 Desktop & Sandbox Agent (v7.0.2)

Local Windows agent powering **Silent Persistent Windows Sandbox Computer-Use**, **One-Click Web Launch (`moho-agent://`)**, **Auto-Token Extension Handshake**, and the **Jailed Sandbox Terminal** for `chromium-web-embed`.

## Fastest Setup for End Users (Zero Coding)
1. Double-click **`Moho-OneClick-Installer.bat`** (or **`setup_one_click.bat`** if you already cloned the repo).
2. It automatically checks/installs Python (via `winget`), creates `.venv` and `%USERPROFILE%\MohoSandboxData`, registers `moho-agent://` (no Admin needed), and launches silently.
3. Click **Launch Isolated Computer** in your web app — authentication and live streaming start automatically!

## Available Modes

| Mode | Command | Requirement | Capabilities |
| :--- | :--- | :--- | :--- |
| **Silent Persistent Windows Sandbox (Recommended)** | `moho-agent://start-sandbox` or `start_sandbox.bat` | **Windows 10/11 Pro, Enterprise, or Education** (NOT Home) | **100% full real Windows desktop** (`SendInput` + `mss`), stealth-hidden in background, persistent files & browser logins (`MohoSandboxData`), Single-Instance Guard, auto-token auth (`127.0.0.1:47893`). |
| **Visible Windows Sandbox (Developer Debug)** | `start_sandbox.bat --visible` | Windows 10/11 Pro/Enterprise/Education | Same as above with Sandbox window kept visible. |
| **Hidden Win32 Desktop + Sandbox Terminal** | `start_agent.bat` | Any Windows 10/11 (including Home) | Lightweight background desktop + full Jailed Sandbox Terminal. |

See [`docs/WINDOWS_SANDBOX_MODE.md`](../docs/WINDOWS_SANDBOX_MODE.md) and [`docs/troubleshooting.md`](../docs/troubleshooting.md) for full details.
