# chromium-web-embed (v7.0.0)

**Real Chromium Browser Embedding, Persistent Windows Sandbox Computer-Use, Local Folder Brain, Jailed Sandbox Terminal, and Universal AI Agent Runtime.**

`chromium-web-embed` lets any web app or AI agent (**Gemini, Claude, ChatGPT/OpenAI, MCP, MOHO AI, or custom/unsupported LLMs**) control an isolated Chromium browser workspace, a **100% real isolated Windows 10/11 desktop** (via Windows Sandbox with persistent files & browser logins), a local project folder via the File System Access API, and a jailed Windows Terminal — without stealing the user's physical mouse or screen.

## Direct Downloads (One-Click Ready)

| Package | Direct Download | Purpose |
| :--- | :--- | :--- |
| **Chrome Extension (v7.0.0)** | [real-browser-web-bridge-extension.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/extension-download/real-browser-web-bridge-extension.zip) | Isolated Chromium workspaces, live stream, WebMCP, ARIA YAML, Set-of-Mark, Side Panel, and Desktop Agent broker. |
| **Windows Desktop & Sandbox Agent (v7.0.0)** | [moho-desktop-agent-windows.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip) | Windows Sandbox Real-Desktop launcher (`start_sandbox.bat`), One-Click `moho-agent://` setup (`setup_one_click.bat`), Hidden Desktop, and Jailed Sandbox Terminal. |

## Core Pillars

1. **Isolated Chromium Browser Workspace (`RealBrowserClient`)**
   - Opens isolated tabs in a dedicated non-focus-stealing window, streams live frames, and executes full DOM/CDP actions, [Playwright-style ARIA YAML snapshots](https://playwright.dev/docs/aria-snapshots), [Set-of-Mark visual overlays](https://arxiv.org/abs/2310.11441), [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp), and Console/Network diagnostics.
2. **Windows Sandbox Persistent Real-Desktop Mode (v7.0.0 — Recommended)**
   - **Edition Requirement:** Requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education** with hardware virtualization enabled. **Windows Home edition is NOT supported** by [Microsoft Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/).
   - Runs `moho_desktop_agent.py --mode real-input` inside Windows Sandbox with native `SendInput` + `mss` live streaming: **Start Menu, Taskbar, Explorer, double-clicking, OLE drag-and-drop, and modern Windows 11 apps work 100% natively** with zero interference to your host mouse or screen.
   - **Automatic Persistent Storage (`%USERPROFILE%\MohoSandboxData` <-> `C:\MohoPersistent`):** Automatically creates and maps `Workspace\`, `EdgeProfile\`, `ChromeProfile\`, `PortableApps\`, `Downloads\`, and `startup_apps.bat` so AI-generated files, browser logins/cookies, and portable apps are **never lost** when Windows Sandbox closes ([Microsoft Learn: Configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)).
3. **One-Click Web Launch for Non-Technical Users (`moho-agent://`)**
   - Double-click `setup_one_click.bat` once (no Administrator rights needed) to register the per-user `moho-agent://` URI protocol (`HKCU\Software\Classes\moho-agent`, per [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/shell/reg-middleware-apps)).
   - Web apps can now launch Windows Sandbox, the Desktop Agent, or the Persistent Workspace folder with a single click (`triggerMohoProtocol("startSandbox")`).
4. **Local Folder Brain (`LocalFolderBrain`) & Jailed Sandbox Terminal (`SandboxTerminalClient`)**
   - Read/search/diff/patch local project folders with `.gitignore` filtering, 1-click undo, and [`FileSystemObserver`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver) live watching.
   - Run Python, Node.js, TypeScript, PowerShell, Batch, Go, and shell commands strictly jailed to the approved workspace folder inside [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) with live streaming output.
5. **Universal AI Agent Integration**
   - Native tool schemas & unified executor for **Google Gemini**, **Anthropic Claude**, **OpenAI / ChatGPT**, **MCP**, **MOHO AI**, plus `toUniversalSystemPrompt()` and `parseUniversalToolCalls()` for any custom or local LLM.

## Quick Start for End Users (Zero Coding Required)

1. **Install the Chrome Extension:** Download and unzip [real-browser-web-bridge-extension.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/extension-download/real-browser-web-bridge-extension.zip), open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
2. **Install the Windows Agent (Once):** Download and unzip [moho-desktop-agent-windows.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip), then double-click **`setup_one_click.bat`**.
3. **Enable Windows Sandbox (Once, Windows 10/11 Pro/Enterprise/Education only):** Open **Command Prompt (`cmd`) as Administrator**, run:
   ```cmd
   dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
   ```
   and restart your PC ([Microsoft Learn: Install Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)).
4. **Launch in 1 Click:** Click **"Launch Windows Sandbox"** inside your web app (triggers `moho-agent://start-sandbox`) or double-click `start_sandbox.bat`, wait ~10 seconds for `[READY]`, paste the Auth Token, and connect!

## Quick Start for Developers

```bash
npm install chromium-web-embed
```

```ts
import {
  RealBrowserClient,
  WindowsDesktopAgentClient,
  LocalFolderBrain,
  SandboxTerminalClient,
  triggerMohoProtocol,
  MOHO_DOWNLOAD_URLS,
} from "chromium-web-embed";

// 1-click launch Windows Sandbox from any web button:
triggerMohoProtocol("startSandbox");

// Connect to the transparent host relay (forwards to Windows Sandbox automatically):
const desktop = new WindowsDesktopAgentClient({ url: "ws://127.0.0.1:47892", token: "YOUR_TOKEN" });
await desktop.connect();
await desktop.startStream({ fps: 10, format: "jpeg", quality: 75 });
await desktop.openStartMenu();
```

## Documentation Index

- **[Full Documentation Index](./docs/INDEX.md)**
- **[Windows Sandbox Persistent Mode & 1-Click Protocol Guide](./docs/WINDOWS_SANDBOX_MODE.md)**
- **[Troubleshooting & Common Errors](./docs/troubleshooting.md)**
- **[Full Developer Guide](./docs/FULL_DEVELOPER_GUIDE.md)**
- **[Hidden Desktop & Sandbox Terminal Architecture](./docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md)**
- **[Desktop Agent Setup Guide](./desktop-agent/README.md)**

## License
MIT
