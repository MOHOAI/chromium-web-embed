# Moho Windows 10/11 Desktop & Sandbox Agent (v6.3.0)

Local Windows agent powering **Live Isolated Desktop Computer-Use** and the **Jailed Sandbox Terminal** for `chromium-web-embed`.

## Choose Your Desktop Mode

| Mode | Command | Requirement | Capabilities |
| :--- | :--- | :--- | :--- |
| **Windows Sandbox Real-Desktop (Recommended)** | `start_sandbox.bat` | **Windows 10/11 Pro, Enterprise, or Education** (NOT Home) + Virtualization enabled | **100% full real Windows desktop** (`SendInput` + `mss`): Start Menu, Taskbar, Drag & Drop, modern Windows 11 apps, Explorer — zero host mouse/screen interference. |
| **Hidden Win32 Desktop + Sandbox Terminal** | `start_agent.bat` | Any Windows 10/11 (including Home) | Lightweight background Win32 desktop (`CreateDesktopW`) + full Jailed Sandbox Terminal (Python/Node/CMD/PowerShell). |
| **Custom VM / Direct Real-Input** | `start_agent.bat --mode real-input --host 0.0.0.0` | Inside VirtualBox / Hyper-V / VMware guest | Full `SendInput` + `mss` inside any Windows VM. |

## Quick Start (Windows 11 Pro / Enterprise / Education)

1. **Enable Windows Sandbox (one-time, Administrator `cmd`):**
   ```cmd
   dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
   ```
   Restart Windows when prompted.

2. **Launch Full Isolated Sandbox Desktop + Host Relay:**
   ```cmd
   cd /d desktop-agent
   start_sandbox.bat
   ```
   Wait until `[READY] Host Relay active on ws://127.0.0.1:47892` appears, copy the Auth Token, and connect from your web app or Chrome extension.

See [`docs/WINDOWS_SANDBOX_MODE.md`](../docs/WINDOWS_SANDBOX_MODE.md) for full configuration options (`--memory-mb`, `--workspace`, `--no-vgpu`, firewall notes).
