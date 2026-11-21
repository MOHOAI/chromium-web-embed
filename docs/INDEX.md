# Documentation Index — `chromium-web-embed` (v7.0.2)

## Quick Start & End-User Guides
- **[Main README (Overview, Downloads & Quick Start)](../README.md)** — Official overview of the library, direct download links, and 1-click setup.
- **[Windows Sandbox Persistent Mode & One-Click Launch (`moho-agent://`)](./WINDOWS_SANDBOX_MODE.md)** — Full 100% isolated Windows 10/11 desktop with persistent files, Edge/Chrome login profiles, portable apps, and 1-click web launch. *(Requires Windows 10/11 Pro, Enterprise, or Education).*
- **[Desktop Agent Setup Guide](../desktop-agent/README.md)** — Choosing between `start_sandbox.bat`, `setup_one_click.bat`, and `start_agent.bat`.
- **[Troubleshooting & Common Errors](./troubleshooting.md)** — Fast fixes for Windows Sandbox, `moho-agent://`, Chrome Extension, Auth Tokens, and Live Streaming.

## Architecture & Developer Guides
- **[Full Developer Guide](./FULL_DEVELOPER_GUIDE.md)** — TypeScript SDK, providers, safety policies, and production integration.
- **[Hidden Desktop & Jailed Sandbox Terminal](./V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md)** — Win32 hidden desktop architecture and Windows Job Object terminal isolation.
- **[Windows Desktop & Local Folder Brain](./V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md)** — File System Access API, `.gitignore` filtering, diffing, and surgical patching.
- **[Managed Browser Workspace](./managed-browser-workspace.md)** — Dedicated non-focus-stealing browser windows and live capture.
- **[Agent Control & Policies](./agent-control.md)** — Safety rules, allowlists, and emergency stop.
- **[Performance & Reliability](./performance-reliability.md)** — Frame-delta skipping, MV3 WebSocket keepalive, and stream tuning.
- **[Extension Architecture Research](./extension-architecture-research.md)** — Chrome MV3 service worker, Side Panel, and content bridge design.
- **[Popup Diagnostics](./popup-diagnostics.md)** — Reading live status and diagnostics from the extension popup.
- **[Publishing Guide](../PUBLISHING.md)** — Building, testing, and publishing releases to GitHub and npm.
