#!/usr/bin/env python3
"""
Moho Custom URI Protocol Dispatcher (moho-agent://) — v7.0.1
------------------------------------------------------------
Safely handles 1-click SILENT launch links triggered from any web app or browser:
  - moho-agent://start-sandbox      -> Silently launches Windows Sandbox Real-Desktop + Host Relay (no CMD window)
  - moho-agent://start-sandbox-vis  -> Launches Windows Sandbox with visible window
  - moho-agent://start-agent        -> Silently launches Hidden Desktop + Sandbox Terminal Agent (no CMD window)
  - moho-agent://open-workspace     -> Opens %USERPROFILE%\\MohoSandboxData\\Workspace in Explorer
  - moho-agent://open-persistent    -> Opens %USERPROFILE%\\MohoSandboxData in Explorer

Security: Strictly allowlisted actions only; ignores any unknown actions or injected shell characters.
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

CREATE_NO_WINDOW = 0x08000000


def get_persistent_root() -> Path:
    root = Path.home() / "MohoSandboxData"
    for sub in ("Workspace", "EdgeProfile", "ChromeProfile", "PortableApps", "Downloads"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def _resolve_pythonw(agent_dir: Path) -> str:
    pyw = agent_dir / ".venv" / "Scripts" / "pythonw.exe"
    if pyw.exists():
        return str(pyw)
    py = agent_dir / ".venv" / "Scripts" / "python.exe"
    if py.exists():
        return str(py)
    return sys.executable


def dispatch_uri(raw_uri: str) -> str:
    parsed = urlparse((raw_uri or "").strip())
    if parsed.scheme.lower() != "moho-agent":
        raise ValueError(f"Unsupported scheme: {parsed.scheme}")
    action = (parsed.netloc or parsed.path.lstrip("/")).strip().lower()
    agent_dir = Path(__file__).resolve().parent
    persistent = get_persistent_root()
    pyw = _resolve_pythonw(agent_dir)
    flags = CREATE_NO_WINDOW if sys.platform == "win32" else 0

    if action == "start-sandbox":
        if sys.platform == "win32":
            subprocess.Popen([pyw, str(agent_dir / "launch_windows_sandbox.py")], cwd=str(agent_dir), creationflags=flags, close_fds=True)
        return "start-sandbox"

    if action == "start-sandbox-vis":
        if sys.platform == "win32":
            subprocess.Popen([pyw, str(agent_dir / "launch_windows_sandbox.py"), "--visible"], cwd=str(agent_dir), creationflags=flags, close_fds=True)
        return "start-sandbox-vis"

    if action == "start-agent":
        if sys.platform == "win32":
            subprocess.Popen([pyw, str(agent_dir / "moho_desktop_agent.py")], cwd=str(agent_dir), creationflags=flags, close_fds=True)
        return "start-agent"

    if action == "open-workspace":
        target = persistent / "Workspace"
        if sys.platform == "win32":
            os.startfile(str(target))  # type: ignore[attr-defined]
        return "open-workspace"

    if action == "open-persistent":
        if sys.platform == "win32":
            os.startfile(str(persistent))  # type: ignore[attr-defined]
        return "open-persistent"

    raise ValueError(f"Unknown moho-agent action: {action}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: protocol_dispatcher.py moho-agent://<start-sandbox|start-sandbox-vis|start-agent|open-workspace|open-persistent>")
        sys.exit(1)
    try:
        act = dispatch_uri(sys.argv[1])
        print(f"[moho-agent://] Dispatched action: {act}")
    except Exception as exc:
        print(f"[moho-agent:// ERROR] {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
