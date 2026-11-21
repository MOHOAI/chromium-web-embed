# Windows Sandbox Real-Desktop Mode (v6.3.0)

> **System Requirement Notice:** Windows Sandbox Mode requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education edition** with hardware virtualization enabled in BIOS/UEFI. **Windows Home edition is NOT supported** by Microsoft for Windows Sandbox ([Microsoft Learn: Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)).

## Why Windows Sandbox Mode?
Standard Win32 hidden desktops (`CreateDesktopW`) share a single Windows session (`WinSta0`), where Windows allows only one active Input Desktop at a time ([Microsoft Learn: Desktops](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)). As a result, modern Windows 11 UI elements (Start Menu, WinUI Taskbar, OLE Drag & Drop, UWP/Store apps, and Chrome/Electron windows) ignore background `PostMessageW` clicks.

**Windows Sandbox Mode** solves this cleanly without installing a heavy virtual machine or downloading an ISO:
- Boots a clean, isolated Windows 10/11 desktop in seconds directly from your existing OS image.
- Runs `moho_desktop_agent.py --mode real-input` **inside** Windows Sandbox using native Win32 `SendInput` and per-capture `mss` live screen streaming.
- **100% Full Native Control:** Start Menu, Taskbar, Explorer, double-clicking icons/files, drag-and-drop, window closing/resizing, Arabic/English Unicode typing, and all modern Windows 11 apps work identically to a physical PC.
- **Zero Host Interference:** Your host mouse cursor, keyboard focus, and primary screen are never touched.
- **Zero Downloads Inside Sandbox:** `start_sandbox.bat` maps your host Python installation read-only (`C:\MohoPython`) and your `desktop-agent` folder (`C:\MohoAgent`) via a generated `.wsb` configuration file ([Microsoft Learn: Configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)).
- **Transparent Host Relay:** Runs a local WebSocket relay on `ws://127.0.0.1:47892` that automatically discovers and forwards traffic to the Sandbox's internal IP (`ws://<SANDBOX_IP>:47892`).

## 1. Enable Windows Sandbox (One-Time Setup on Windows 10/11 Pro/Enterprise/Education)
Open **Command Prompt (`cmd`) as Administrator** and run ([Microsoft Learn: Install Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)):

```cmd
dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
```

Restart your PC when prompted.

## 2. Launch Windows Sandbox Real-Desktop Mode
Open **Command Prompt (`cmd`)** and run:

```cmd
cd /d desktop-agent
start_sandbox.bat
```

Optional flags:
```cmd
start_sandbox.bat --memory-mb 6144 --workspace "C:\path\to\your\project"
```

Wait ~8–15 seconds until the console prints:
```text
[READY] Windows Sandbox Real-Desktop Agent is ONLINE at ws://<SANDBOX_IP>:47892
[READY] Host Relay active on ws://127.0.0.1:47892
```

Then copy the displayed **Auth Token**, paste it into the Chrome Extension / Studio UI, and click **Connect + Live Stream** (`ws://127.0.0.1:47892`).

## 3. Important Operational Tips
- **Do not minimize the Windows Sandbox window:** Keep the Windows Sandbox window open in the background (behind your browser) rather than minimized to the taskbar so Windows DWM keeps live frame rendering active at full FPS.
- **Ephemeral Isolation:** Everything created inside Windows Sandbox (outside mapped folders like `C:\MohoWorkspace`) is automatically wiped when you close the Sandbox window.
- **Fallback for Windows Home Users:** If you are on **Windows 10/11 Home**, use `start_agent.bat` for the **Browser Workspace Bridge + Local Folder Brain + Isolated Sandbox Terminal**, or run `moho_desktop_agent.py --mode real-input --host 0.0.0.0` inside an Oracle VirtualBox / VMware guest.
