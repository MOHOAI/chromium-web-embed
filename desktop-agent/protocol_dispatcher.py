#!/usr/bin/env python3
"""
Moho Custom URI Protocol Dispatcher (moho-agent://) — v7.0.0
------------------------------------------------------------
Safely handles 1-click launch links triggered from any web app or browser:
  - moho-agent://start-sandbox      -> Launches Windows Sandbox Real-Desktop + Host Relay
  - moho-agent://start-agent        -> Launches Hidden Desktop + Sandbox Terminal Agent
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


def get_persistent_root() -> Path:
    root = Path.home() / "MohoSandboxData"
    for sub in ("Workspace", "EdgeProfile", "ChromeProfile", "PortableApps", "Downloads"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def dispatch_uri(raw_uri: str) -> str:
    parsed = urlparse((raw_uri or "").strip())
    if parsed.scheme.lower() != "moho-agent":
        raise ValueError(f"Unsupported scheme: {parsed.scheme}")
    action = (parsed.netloc or parsed.path.lstrip("/")).strip().lower()
    agent_dir = Path(__file__).resolve().parent
    persistent = get_persistent_root()

    if action == "start-sandbox":
        bat = agent_dir / "start_sandbox.bat"
        if sys.platform == "win32":
            subprocess.Popen(["cmd", "/c", "start", "", str(bat)], cwd=str(agent_dir), close_fds=True)
        return "start-sandbox"

    if action == "start-agent":
        bat = agent_dir / "start_agent.bat"
        if sys.platform == "win32":
            subprocess.Popen(["cmd", "/c", "start", "", str(bat)], cwd=str(agent_dir), close_fds=True)
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
        print("Usage: protocol_dispatcher.py moho-agent://<start-sandbox|start-agent|open-workspace|open-persistent>")
        sys.exit(1)
    try:
        act = dispatch_uri(sys.argv[1])
        print(f"[moho-agent://] Dispatched action: {act}")
    except Exception as exc:
        print(f"[moho-agent:// ERROR] {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
