# chromium-web-embed `v5.1.0`

**Real Chromium Browser Workspace + Chrome Side Panel + WebMCP + ARIA & Set-of-Mark Grounding + Windows 10/11 Virtual Desktop Computer-Use Agent + Local Folder Brain (`FileSystemObserver` + Surgical Patching) + Multi-Provider AI Runtime (Gemini, Claude, OpenAI/ChatGPT, MCP, MOHO AI).**

## ✨ What's New in `v5.1.0`

- **🌐 Chrome WebMCP Native Integration (`chromium-web-embed/webmcp`)**
  - Registers all Browser, Windows Desktop, and Local Folder Brain tools natively into Chrome's `document.modelContext.registerTool()` API with `AbortSignal` cleanup and `readOnlyHint` annotations, plus `discoverDeclarativeWebMCPForms()` to detect `<form toolname="...">` tools on web pages.
- **🎯 ARIA Accessibility Snapshots, Set-of-Mark (SoM) & Live Diagnostics**
  - **`getAriaSnapshot()`**: Playwright-MCP-style compact YAML accessibility tree with deterministic element refs (`e0`, `e1`...) — slashes LLM token cost and works even with text-only models.
  - **`captureAnnotatedScreenshot()`**: Draws numbered Set-of-Mark bounding boxes over interactive elements before taking a screenshot, then cleans up immediately for dramatically higher Vision LLM click accuracy.
  - **`getDiagnostics()`**: Captures live browser `console.error`/`warn`, uncaught exceptions, and failed HTTP network requests (`>= 400`) via CDP.
- **🧩 Chrome MV3 Side Panel & 20s WebSocket Keepalive**
  - Built-in persistent **Side Panel** (`extension/sidepanel.html`) showing live Windows Virtual Desktop streaming preview, Emergency Kill Switch, ARIA snapshot inspector, and live console error viewer.
  - Automatic 20-second WebSocket keepalive heartbeat (`minimum_chrome_version: "116"`) so Chrome MV3 never kills the Windows Desktop Agent connection after 30s of idle time.
- **🖥️ Windows 10/11 Virtual Desktop Computer-Use Agent (`desktop-agent/` & `chromium-web-embed/desktop`)**
  - Strict **Windows 10 & Windows 11** local loopback broker (`ws://127.0.0.1:47892`) connected through the Chrome extension.
  - **Fresh Empty Virtual Desktop** (`createVirtualDesktop`, `switchVirtualDesktop`, `closeVirtualDesktop`).
  - **Smart Frame-Delta Live Preview (`DesktopLiveViewer`)**: Skips unchanged frames via `adler32` hashing to save bandwidth/CPU while maintaining smooth interactive live streaming.
  - **Win32 Child Control Inspection (`inspectWindowControls`)**: Enumerates native Windows UI controls (`EnumChildWindows`) with captions and coordinates alongside full `SendInput` mouse/drag/Unicode typing/hotkeys.
- **📂 Local Folder Brain (`chromium-web-embed/local-folder`)**
  - Powered by **File System Access API** (`showDirectoryPicker`) + **`FileSystemObserver`** real-time directory change watching (with automatic polling fallback).
  - Automatic **`.gitignore`** parsing, **Surgical Search-and-Replace Patching (`applySearchReplacePatch`)**, Unified Diff previews, **Direct Apply ("تطبيق مباشر")**, and instant **1-click Undo (`undoLastEdit`)**.
- **🤖 Unified AI Platform Toolkit (`src/providers/ai-toolkit.ts`)**
  - Ready-to-use schemas and `UnifiedAIToolExecutor` for **Google Gemini**, **Anthropic Claude**, **OpenAI / ChatGPT / MOHO**, and **MCP**.

## Quick Start

```bash
npm install
npm test
npm run typecheck
npm run build
```

- **Chrome Extension**: Load `extension/` (unpacked) in `chrome://extensions` (Developer Mode), or use `extension-download/real-browser-web-bridge-extension.zip`. Open the **Side Panel** from Chrome's side panel menu.
- **Windows 10/11 Desktop Agent**: Run `desktop-agent/start_agent.bat`.
- **Interactive Demo**: Serve `examples/` locally (`npx serve examples`) and open `windows-desktop-and-folder-brain.html` in Chrome.
- **Full v5 Guide (Arabic)**: See [`docs/V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md`](docs/V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md).
