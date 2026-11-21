# chromium-web-embed `v6.1.0`

**Real Chromium Browser Workspace + TRUE Hidden Windows 10/11 Isolated Desktop + Windows Job-Object Sandbox Terminal (Python/Node/Multi-Language) + Local Folder Brain + Chrome WebMCP & Side Panel + Multi-Provider AI Runtime (Gemini, Claude, OpenAI/ChatGPT, MCP, MOHO AI).**

📚 **Documentation Index:** See [`docs/INDEX.md`](docs/INDEX.md) and [`docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md`](docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md).

## ✨ What's New in `v6.1.0`

- **🖥️ TRUE Hidden Windows 10/11 Isolated Desktop (`CreateDesktopW` + `PrintWindow` + `PostMessageW`)**
  - Creates a real background Win32 desktop (`MohoIsolatedDesktop`) **without switching your visible screen or moving your physical mouse cursor**.
  - Launches apps directly into the hidden desktop (`launchApp`), composites all hidden windows into a live stream, and dispatches clicks, drags, wheel scroll, and Unicode typing directly via `PostMessageW`.
- **⚡ Isolated Local Sandbox Terminal & Multi-Language Code Runner (`chromium-web-embed/terminal`)**
  - Run installed **Python, Node.js, TypeScript, PowerShell, Batch, Go, PHP**, and shell commands strictly jailed inside your connected project folder (`LocalFolderBrain` workspace).
  - Protected by **Windows Job Objects** (`KILL_ON_JOB_CLOSE` + memory cap), strict path-escape blocking, hard timeouts, live `stdout`/`stderr` streaming, and instant kill controls.
- **🌐 Dedicated-Window Browser Live Stream Fix**
  - `workspaceCreate` opens managed browser workspaces in their own non-focus-stealing Chrome window (`focused: false`) with ultra-fast `captureVisibleTab` + CDP `fromSurface: true` fallback so live browser preview and interactive clicking always work smoothly.
- **📂 Local Folder Brain + WebMCP + ARIA/SoM + Chrome Side Panel**
  - Full `File System Access API` + `FileSystemObserver` + `.gitignore` + surgical `applySearchReplacePatch` + 1-click Undo, alongside `document.modelContext` WebMCP, Playwright-MCP-style ARIA YAML snapshots, Set-of-Mark overlays, and live CDP Console/Network error diagnostics.

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run build
```

1. **Chrome Extension (`v6.1.0`)**: Load `extension/` in `chrome://extensions` (Developer Mode), or download [`extension-download/real-browser-web-bridge-extension.zip`](extension-download/real-browser-web-bridge-extension.zip).
2. **Windows 10/11 Agent**: Run `desktop-agent/start_agent.bat` (supports `--no-auth` and `--workspace "C:\path\to\project"`).
3. **Interactive Studio**: Serve `examples/` (`python -m http.server 8080`) and open the studio HTML page in Chrome.
