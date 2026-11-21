# chromium-web-embed (v7.0.2)

**Real Chromium Browser Embedding, Silent Persistent Windows Sandbox Computer-Use, Zero-Code One-Click Web Launcher, Local Folder Brain, Jailed Sandbox Terminal, and Universal AI Agent Runtime.**

`chromium-web-embed` lets any web app or AI agent (**Gemini, Claude, ChatGPT/OpenAI, MCP, MOHO AI, or custom/unsupported LLMs**) control an isolated Chromium browser workspace, a **100% real isolated Windows 10/11 desktop** (running silently inside Windows Sandbox with persistent files & browser logins), a local project folder via the File System Access API, and a jailed Windows Terminal — without stealing the user's physical mouse, keyboard, or screen.

## Direct Downloads (Zero-Code One-Click Ready)

| Package | Direct Download | Purpose |
| :--- | :--- | :--- |
| **Chrome Extension (v7.0.2)** | [real-browser-web-bridge-extension.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/extension-download/real-browser-web-bridge-extension.zip) | Isolated Chromium workspaces, live stream, WebMCP, ARIA YAML, Set-of-Mark, Side Panel, and automatic Desktop Agent auth (`127.0.0.1:47893`). |
| **Automatic One-Click Windows Installer** | [Moho-OneClick-Installer.bat](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/Moho-OneClick-Installer.bat) | For non-technical users: auto-installs Python (via `winget` if missing), downloads the agent, creates persistent storage, registers `moho-agent://`, and launches silently. |
| **Windows Desktop & Sandbox Agent ZIP** | [moho-desktop-agent-windows.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip) | Full desktop agent bundle (`setup_one_click.bat`, `start_sandbox.bat`, `start_agent.bat`, `moho_desktop_agent.py`, `launch_windows_sandbox.py`). |

## How Automatic One-Click Launch Works (Zero Coding Required)

1. **Install the Chrome Extension:** Download and unzip [real-browser-web-bridge-extension.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/extension-download/real-browser-web-bridge-extension.zip), open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
2. **Enable Windows Sandbox (Once — Windows 10/11 Pro, Enterprise, or Education ONLY):**
   > **Edition Requirement:** Windows Sandbox requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education** with hardware virtualization enabled. **Windows Home edition is NOT supported** by [Microsoft Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/). On Windows Home, `Moho-OneClick-Installer.bat` automatically falls back to the lightweight Hidden Desktop + Sandbox Terminal agent.

   Open **Command Prompt (`cmd`) as Administrator** and run ([Microsoft Learn: Install Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)):
   ```cmd
   dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
   ```
   Restart your PC when prompted.
3. **Click "Launch Isolated Computer" Inside Any Web App:**
   - If the agent is not installed yet, the button automatically downloads **`Moho-OneClick-Installer.bat`** — double-click it once and everything installs and starts silently in the background.
   - If already installed, `moho-agent://start-sandbox` launches silently via `pythonw.exe` (zero black CMD windows), stealth-hides the Windows Sandbox window in the background while keeping DWM live rendering active, enforces a **Single-Instance Guard** (preventing duplicate Sandbox errors), and locks the button with a loading indicator.
   - **Zero Token Copy-Paste:** The Chrome Extension automatically reads the session token from the localhost-only handshake (`http://127.0.0.1:47893/session`, blocked from untrusted web pages) and **auto-starts the live stream** the moment Windows Sandbox finishes booting.

## Core Pillars

1. **Isolated Chromium Browser Workspace (`RealBrowserClient`)** — Dedicated non-focus-stealing window, live capture, [Playwright-style ARIA YAML snapshots](https://playwright.dev/docs/aria-snapshots), [Set-of-Mark overlays](https://arxiv.org/abs/2310.11441), [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp), and Console/Network diagnostics.
2. **Silent Persistent Windows Sandbox Mode (`RealInputDesktopEngine`)** — 100% real `SendInput` + `mss` control (Start Menu, Taskbar, Explorer, OLE drag-and-drop, modern Windows 11 apps) with automatic persistent storage at **`%USERPROFILE%\MohoSandboxData` <-> `C:\MohoPersistent`** (`Workspace\`, `EdgeProfile\`, `ChromeProfile\`, `PortableApps\`, `Downloads\`, `startup_apps.bat`; [Microsoft Learn](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)).
3. **Local Folder Brain (`LocalFolderBrain`) & Jailed Sandbox Terminal (`SandboxTerminalClient`)** — `.gitignore`-aware project search/diff/patch with [`FileSystemObserver`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver) and multi-language code execution wrapped in [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
4. **Universal AI Agent Runtime** — Native schemas & executor for **Gemini, Claude, OpenAI/ChatGPT, MCP, MOHO AI**, plus `toUniversalSystemPrompt()` / `parseUniversalToolCalls()` for any custom or local LLM.

## Quick Start for Developers

```bash
npm install chromium-web-embed
```

```ts
import {
  WindowsDesktopAgentClient,
  launchOrInstallMohoAgent,
  MOHO_DOWNLOAD_URLS,
} from "chromium-web-embed";

// 1-click silent launch (auto-downloads Moho-OneClick-Installer.bat if not installed):
launchOrInstallMohoAgent("startSandbox");

// Connect (extension automatically retrieves local session token if token is omitted):
const desktop = new WindowsDesktopAgentClient({ url: "ws://127.0.0.1:47892" });
await desktop.connect();
await desktop.startStream({ fps: 10, format: "jpeg", quality: 75 });
```

## Documentation Index

- **[Full Documentation Index](./docs/INDEX.md)**
- **[Windows Sandbox Persistent Mode & Automatic One-Click Launch](./docs/WINDOWS_SANDBOX_MODE.md)**
- **[Troubleshooting & Common Errors](./docs/troubleshooting.md)**
- **[Full Developer Guide](./docs/FULL_DEVELOPER_GUIDE.md)**
- **[Hidden Desktop & Sandbox Terminal Architecture](./docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md)**
- **[Desktop Agent Setup Guide](./desktop-agent/README.md)**

## License
MIT
