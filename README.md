# chromium-web-embed (`v6.3.0`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-6.3.0-emerald.svg)](package.json)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3%20%2B%20Side%20Panel%20%2B%20WebMCP-sky.svg)](extension/manifest.json)
[![Windows 10/11](https://img.shields.io/badge/Desktop%20Agent-Windows%2010%20%26%2011-indigo.svg)](desktop-agent/README.md)

**`chromium-web-embed`** is an open-source TypeScript library, Chrome Manifest V3 extension (**Moho Browser Workspace**), and Windows 10/11 local broker that turns any web application or AI platform into a full-stack **Browser + Hidden Windows Desktop + Local Project Files + Sandboxed Code Terminal** control center.

Built for **users**, **web developers**, and **all AI agents** — natively supporting **Google Gemini**, **Anthropic Claude**, **OpenAI / ChatGPT**, **Model Context Protocol (MCP)**, **Chrome WebMCP**, **MOHO AI**, and **any custom or open-source LLM/VLM** via universal structured tool calling.

---


## Windows Sandbox Real-Desktop Mode (v6.3.0 — Recommended)

> **Edition Requirement:** Full Windows Sandbox desktop isolation requires **Windows 10 (build 18342+) or Windows 11 — Pro, Enterprise, or Education** with hardware virtualization enabled. **Windows Home edition is not supported** by [Microsoft Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/). On Windows Home, use `start_agent.bat` (Browser Workspace + Local Folder Brain + Sandbox Terminal) or run `--mode real-input` inside VirtualBox/VMware.

Run `desktop-agent\start_sandbox.bat` to launch a clean, disposable Windows 11 desktop with:
- **100% Real Native Input (`SendInput` + `mss`):** Start Menu, Taskbar, Explorer, double-clicking icons/files, OLE drag-and-drop, window resizing/closing, and Arabic/English Unicode typing work identically to a physical PC — with **zero interference** to your host mouse, keyboard, or screen.
- **Zero Setup Inside Sandbox:** Automatically maps your host Python + `.venv` read-only and starts a transparent local relay on `ws://127.0.0.1:47892`.
- **One-Time Activation (Admin `cmd`):** `dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All` (restart PC).

Full guide: [`docs/WINDOWS_SANDBOX_MODE.md`](./docs/WINDOWS_SANDBOX_MODE.md).

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Any Web App / AI Platform (React, Plain HTML, MOHO AI, Gemini, Claude) │
│   • RealBrowserClient / ManagedBrowserAgent / SharedTabViewer           │
│   • WindowsDesktopAgentClient / DesktopLiveViewer                       │
│   • LocalFolderBrain (File System Access API + FileSystemObserver)      │
│   • SandboxTerminalClient (Multi-Language Isolated Code Runner)         │
│   • UnifiedAIToolExecutor (Gemini / Claude / OpenAI / MCP / WebMCP / *) │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ window.postMessage ("real-browser-web/v5")
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Moho Browser Workspace — Chrome MV3 Extension (Popup + Side Panel)     │
│   • Dedicated-window Browser Workspaces + Live Stream + ARIA + SoM      │
│   • CDP Console/Network Error Diagnostics + Focus Emulation             │
│   • 20s Keepalive WebSocket Broker -> ws://127.0.0.1:47892              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Local Loopback WebSocket + Auth Token
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Moho Windows 10/11 Agent (desktop-agent/moho_desktop_agent.py)         │
│   1. HiddenDesktopEngine (CreateDesktopW + PrintWindow + PostMessageW)  │
│      - True background isolated desktop (never switches screen/mouse!)  │
│      - Full resolution + Taskbar + Start Menu + App Launcher + Drag/Type│
│   2. SandboxTerminalEngine (Windows Job Objects + Workspace Jail)       │
│      - Run Python, Node.js, TypeScript, PowerShell, Batch, Go, PHP      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Real Chromium Browser Workspace (`chromium-web-embed`)
- **Isolated Dedicated Windows:** Opens managed browser workspaces in their own non-focus-stealing Chrome window (`focused: false`) with tab grouping, pinning, muting, navigation, zoom, and PDF printing.
- **Live Interactive Preview (`SharedTabViewer`):** Fast `captureVisibleTab` + CDP `Page.captureScreenshot({ fromSurface: true })` streaming with exact `object-fit: contain` coordinate mapping for clicks, right-clicks, double-clicks, scrolling, and keyboard input.
- **AI Perception & Debugging:**
  - **ARIA YAML Snapshots (`getAriaSnapshot`)**: Compact Playwright-MCP-style accessibility tree with deterministic element refs (`e0`, `e1`, ...) for low-token text or multimodal agents.
  - **Set-of-Mark Visual Grounding (`captureAnnotatedScreenshot`)**: Overlays numbered bounding boxes on interactive elements for high-accuracy Vision LLM clicks.
  - **Live Diagnostics (`getDiagnostics`)**: Captures `console.error`, uncaught exceptions, and failed HTTP requests (`>= 400`).
- **Persistent Chrome Side Panel:** Inspect live Windows desktop streams, ARIA snapshots, and console errors right inside Chrome's native Side Panel.

### 2. True Hidden Windows 10/11 Isolated Desktop (`chromium-web-embed/desktop`)
- **Zero Disruption:** Uses Win32 `CreateDesktopW` + `SetThreadDesktop` (`MohoIsolatedDesktop`) so the AI works on a completely separate Windows desktop in the background **without ever switching your visible screen or moving your physical mouse cursor**.
- **Full Native Display & Shell:** Auto-detects your Windows screen resolution (`SM_CXSCREEN × SM_CYSCREEN`) and runs `explorer.exe` so the **Taskbar (`Shell_TrayWnd`), Start Menu (`SC_TASKLIST`), and Desktop Icons** are fully visible and interactive.
- **Complete Mouse, Window & Keyboard Control:**
  - All clicks (`click`, `double_click` with 4-message sequence + `SysListView32` icon launch, `triple_click`, `right_click`, `middle_click`, `x1_click`, `x2_click`, `long_press`, `mouse_down`, `mouse_up`, `move`, `drag_and_drop`, vertical/horizontal `scroll`).
  - Window dragging (`WM_NCHITTEST` `HTCAPTION`), close/maximize/minimize buttons (`HTCLOSE`/`HTMAXBUTTON`/`HTMINBUTTON`), corner resizing (`HTBOTTOMRIGHT`), app launching (`launch_app`), clipboard read/write, cropped vision zoom (`zoom`), and `observe_rich`.
  - Real `MapVirtualKeyW` scan-code keyboard dispatch (`WM_KEYDOWN`/`WM_KEYUP`/`WM_CHAR` Unicode Arabic & English) + smart hotkeys (`Alt+F4`, `Win`, `Ctrl+C/V/X/Z/A`).
  - **Emergency Kill Switch:** Halts all desktop/terminal activity immediately.

### 3. Local Folder Brain (`chromium-web-embed/local-folder`)
- Powered by the browser **File System Access API** (`showDirectoryPicker`) with explicit user consent and IndexedDB handle persistence.
- Automatic **`.gitignore`** parsing, real-time directory watching via **`FileSystemObserver`** (with polling fallback), project-wide search, token-budgeted Markdown context builder, **Surgical Search-and-Replace Patching (`applySearchReplacePatch`)**, Unified Diff previews, **Direct Apply to disk**, and **1-click Undo (`undoLastEdit`)**.

### 4. Isolated Local Sandbox Terminal (`chromium-web-embed/terminal`)
- Strictly jailed to the user-approved project folder (`workspaceRoot`), blocking any `..` path traversal outside the folder.
- Wraps every spawned process inside a **Windows Job Object** (`CreateJobObjectW` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `1024 MB` memory limit + hard timeout).
- Auto-detects installed Windows runtimes (`python`, `node`, `npm`, `npx`, `git`, `tsc`, `powershell`, `gcc`, `g++`, `go`, `rustc`, `java`, `php`) and executes commands, project files, or inline code snippets with live streaming `stdout`/`stderr`.

### 5. Universal AI Agent Integration (`chromium-web-embed/providers` & `chromium-web-embed/webmcp`)
| Platform / Standard | Integration API |
| :--- | :--- |
| **Google Gemini** | `GeminiComputerUseAdapter`, `toGeminiFunctionDeclarations()` |
| **Anthropic Claude** | `AnthropicComputerUseAdapter`, `toAnthropicTools()` |
| **OpenAI / ChatGPT / MOHO / DeepSeek / Ollama** | `OpenAIComputerUseAdapter`, `toOpenAITools()` |
| **Model Context Protocol (MCP)** | `toMcpTools()`, `getMcpBrowserTools()`, `handleMcpToolCall()` |
| **Chrome WebMCP (`document.modelContext`)** | `registerWithChromeWebMCP()`, `discoverDeclarativeWebMCPForms()` |
| **Any Custom / Unsupported LLM or VLM** | `toUniversalSystemPrompt()`, `parseUniversalToolCalls()`, `UnifiedAIToolExecutor` |

---

## Installation & Quick Start

```bash
npm install chromium-web-embed
```

Or build from source:
```bash
git clone https://github.com/MOHOAI/chromium-web-embed.git
cd chromium-web-embed
npm install
npm run typecheck
npm test
npm run build
```

### 1. Load the Chrome Extension
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `extension/` (or unzip [`extension-download/real-browser-web-bridge-extension.zip`](extension-download/real-browser-web-bridge-extension.zip)).

### 2. Launch the Windows 10/11 Agent (Optional, for Hidden Desktop & Sandbox Terminal)
```bat
cd desktop-agent
start_agent.bat
```
Copy the printed **Auth Token** into the extension popup or your web app (or run `start_agent.bat --no-auth` for local-only testing).

### 3. Connect in Code
```ts
import {
  RealBrowserClient,
  createManagedBrowserAgent,
  createWindowsDesktopAgent,
  createLocalFolderBrain,
  createSandboxTerminalClient,
  createUnifiedAIToolExecutor,
  toGeminiFunctionDeclarations,
  toAnthropicTools,
  toOpenAITools,
  toUniversalSystemPrompt,
  registerWithChromeWebMCP,
} from "chromium-web-embed";

const client = new RealBrowserClient({ label: "Moho AI Workspace" });
await client.connect();

const desktopAgent = createWindowsDesktopAgent({ bridge: client, token: "YOUR_TOKEN" });
await desktopAgent.connect();
await desktopAgent.createVirtualDesktop();

const folderBrain = createLocalFolderBrain();
const terminal = createSandboxTerminalClient(client);

const executor = createUnifiedAIToolExecutor({
  browserAgent: createManagedBrowserAgent(client),
  desktopAgent,
  folderBrain,
  terminal,
});

// Works with Chrome WebMCP, Gemini, Claude, ChatGPT, MCP, and custom LLMs:
registerWithChromeWebMCP(executor);
const geminiTools = [{ functionDeclarations: toGeminiFunctionDeclarations() }];
const claudeTools = toAnthropicTools();
const openaiTools = toOpenAITools();
const customModelPrompt = toUniversalSystemPrompt();
```

---

## Documentation Index

All developer, operational, and architecture guides are organized in **[`docs/INDEX.md`](docs/INDEX.md)**:
- [`docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md`](docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md) — Hidden Win32 Desktop & Job-Object Sandbox Terminal architecture
- [`docs/V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md`](docs/V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md) — Local Folder Brain & AI Toolkit guide
- [`docs/FULL_DEVELOPER_GUIDE.md`](docs/FULL_DEVELOPER_GUIDE.md) — Complete API reference
- [`docs/guides/ai-agent.md`](docs/guides/ai-agent.md) — `ComputerUseAgentRunner` & `SafetyPolicyEngine`
- [`desktop-agent/README.md`](desktop-agent/README.md) — Windows 10/11 agent setup & security
- [`PUBLISHING.md`](PUBLISHING.md) — Release & npm publishing checklist

## License
MIT © [MOHOAI](https://github.com/MOHOAI)
