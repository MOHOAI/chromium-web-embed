#!/usr/bin/env python3
"""
Moho Windows Sandbox Launcher & Transparent Host WebSocket Relay (v7.0.0)
-------------------------------------------------------------------------
Launches a TRUE isolated Windows 10/11 desktop inside Windows Sandbox with:
  - 100% real Win32 SendInput (Start Menu, Taskbar, Drag & Drop, UWP/WinUI apps, Explorer)
  - Automatic Persistent Shared Storage (%USERPROFILE%\\MohoSandboxData -> C:\\MohoPersistent):
      * Workspace\\     -> Persistent AI & user files (never deleted when Sandbox closes)
      * EdgeProfile\\   -> Persistent Microsoft Edge logins, cookies, bookmarks & extensions
      * ChromeProfile\\ -> Persistent Google Chrome profile (for Chrome Portable)
      * PortableApps\\  -> Portable apps auto-added to PATH inside Sandbox
      * Downloads\\     -> Persistent downloads folder
      * startup_apps.bat-> Optional auto-run script executed on every Sandbox boot
  - Zero Python downloads inside Sandbox (maps host Python + .venv read-only)
  - Transparent local WebSocket Relay on ws://127.0.0.1:47892 -> ws://<SANDBOX_IP>:47892

REQUIREMENTS:
  - Windows 10 (build 18342+) or Windows 11: Pro, Enterprise, or Education edition
    (Windows Sandbox is NOT supported on Windows Home edition).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
from typing import Any, Optional
import xml.sax.saxutils as saxutils

LAUNCHER_VERSION = "7.0.2"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47892

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

SESSION_HTTP_PORT = 47893

def is_relay_already_running() -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{SESSION_HTTP_PORT}/session", timeout=1.2) as r:
            return r.status == 200
    except Exception:
        return False


def is_windows_sandbox_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        out = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq WindowsSandboxClient.exe", "/NH"],
            text=True,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        )
        return "windowssandboxclient.exe" in out.lower()
    except Exception:
        return False


def start_local_session_http_server(state_getter) -> Optional[ThreadingHTTPServer]:
    """Localhost-only (127.0.0.1:47893) session handshake for Chrome Extension auto-auth (no CORS wildcard)."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] != "/session":
                self.send_response(404)
                self.end_headers()
                return
            payload = json.dumps(state_getter()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            pass

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", SESSION_HTTP_PORT), Handler)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv
    except Exception:
        return None


def start_stealth_hide_sandbox_window_thread() -> None:
    """Keeps Windows Sandbox window unminimized (so DWM keeps rendering) while making it invisible & behind all windows."""
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    def _worker():
        user32 = ctypes.windll.user32
        GWL_EXSTYLE = -20
        WS_EX_TOOLWINDOW = 0x00000080
        WS_EX_LAYERED = 0x00080000
        LWA_ALPHA = 0x00000002
        HWND_BOTTOM = 1
        SWP_NOMOVE = 0x0002
        SWP_NOSIZE = 0x0001
        SWP_NOACTIVATE = 0x0010
        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        hidden_hwnds = set()

        for _ in range(90):
            def _cb(hwnd, _lp):
                if hwnd in hidden_hwnds or not user32.IsWindowVisible(hwnd):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                if length <= 0:
                    return True
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value.lower()
                if "windows sandbox" in title or "bac à sable windows" in title or "bac a sable windows" in title:
                    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_LAYERED)
                    user32.SetLayeredWindowAttributes(hwnd, 0, 1, LWA_ALPHA)
                    user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
                    hidden_hwnds.add(hwnd)
                return True

            try:
                user32.EnumWindows(WNDENUMPROC(_cb), 0)
            except Exception:
                pass
            if hidden_hwnds:
                break
            import time as _t
            _t.sleep(0.5)

    threading.Thread(target=_worker, daemon=True).start()


def ensure_persistent_sandbox_dirs(custom_root: Optional[Path] = None) -> Path:
    root = (custom_root.resolve() if custom_root else (Path.home() / "MohoSandboxData"))
    for sub in ("Workspace", "EdgeProfile", "ChromeProfile", "PortableApps", "Downloads"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    startup_bat = root / "startup_apps.bat"
    if not startup_bat.exists():
        startup_bat.write_text(
            "@echo off\n"
            "REM Add any portable apps or silent installers you want launched automatically on every Sandbox boot.\n"
            "REM Example: start \"\" msedge.exe --user-data-dir=\"C:\\MohoPersistent\\EdgeProfile\"\n",
            encoding="utf-8",
        )
    return root


def find_windows_sandbox_exe() -> Optional[Path]:
    candidates = [
        Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsSandbox.exe",
        Path(r"C:\Windows\System32\WindowsSandbox.exe"),
    ]
    for p in candidates:
        if p.exists():
            return p
    which = shutil.which("WindowsSandbox.exe")
    return Path(which) if which else None


def build_wsb_xml(
    python_base_dir: Path,
    agent_dir: Path,
    persistent_dir: Path,
    workspace_dir: Optional[Path] = None,
    memory_mb: int = 4096,
    enable_vgpu: bool = True,
) -> str:
    esc = saxutils.escape
    folders = [
        f"""    <MappedFolder>
      <HostFolder>{esc(str(python_base_dir.resolve()))}</HostFolder>
      <SandboxFolder>C:\\MohoPython</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>""",
        f"""    <MappedFolder>
      <HostFolder>{esc(str(agent_dir.resolve()))}</HostFolder>
      <SandboxFolder>C:\\MohoAgent</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>""",
        f"""    <MappedFolder>
      <HostFolder>{esc(str(persistent_dir.resolve()))}</HostFolder>
      <SandboxFolder>C:\\MohoPersistent</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>""",
    ]
    if workspace_dir and workspace_dir.exists() and workspace_dir.is_dir():
        folders.append(
            f"""    <MappedFolder>
      <HostFolder>{esc(str(workspace_dir.resolve()))}</HostFolder>
      <SandboxFolder>C:\\MohoWorkspace</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>"""
        )

    vgpu_val = "Enable" if enable_vgpu else "Disable"
    return (
        "<Configuration>\n"
        f"  <VGpu>{vgpu_val}</VGpu>\n"
        "  <Networking>Enable</Networking>\n"
        "  <ClipboardRedirection>Enable</ClipboardRedirection>\n"
        f"  <MemoryInMB>{max(2048, int(memory_mb))}</MemoryInMB>\n"
        "  <MappedFolders>\n"
        + "\n".join(folders)
        + "\n  </MappedFolders>\n"
        "  <LogonCommand>\n"
        "    <Command>cmd /c C:\\MohoAgent\\sandbox_bootstrap.bat</Command>\n"
        "  </LogonCommand>\n"
        "</Configuration>\n"
    )


def save_host_session_file(port: int, token: str, persistent_dir: Path, sandbox_ws_url: str = "") -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MohoDesktopAgent"
    base.mkdir(parents=True, exist_ok=True)
    session_path = base / "session.json"
    session_path.write_text(
        json.dumps(
            {
                "host": DEFAULT_HOST,
                "port": port,
                "token": token,
                "version": LAUNCHER_VERSION,
                "mode": "windows_sandbox_real_input",
                "persistentDir": str(persistent_dir),
                "sandboxWsUrl": sandbox_ws_url,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return session_path


class SandboxWebSocketRelay:
    def __init__(self, endpoint_file: Path, host: str, port: int, token: str, persistent_dir: Path) -> None:
        self.endpoint_file = endpoint_file
        self.host = host
        self.port = port
        self.token = token
        self.persistent_dir = persistent_dir
        self.sandbox_ws_url: Optional[str] = None

    def read_sandbox_endpoint(self) -> Optional[str]:
        if not self.endpoint_file.exists():
            return None
        try:
            data = json.loads(self.endpoint_file.read_text(encoding="utf-8"))
            url = str(data.get("wsUrl") or "").strip()
            if url.startswith("ws://"):
                return url
        except Exception:
            return None
        return None

    async def wait_for_sandbox_announcer(self) -> None:
        announced = False
        while True:
            url = self.read_sandbox_endpoint()
            if url and url != self.sandbox_ws_url:
                self.sandbox_ws_url = url
                save_host_session_file(self.port, self.token, self.persistent_dir, url)
                print(f"\n[READY] Windows Sandbox Real-Desktop Agent is ONLINE at {url}")
                print(f"[READY] Host Relay active on ws://{self.host}:{self.port}")
                print(f"[READY] Persistent Data Folder: {self.persistent_dir} -> C:\\MohoPersistent")
                print("[TIP] Keep the Windows Sandbox window open in the background (do not minimize it) for smooth live streaming.")
                announced = True
            elif not url and not announced:
                await asyncio.sleep(1.5)
                continue
            await asyncio.sleep(2.0)

    async def handle_client(self, client_ws: Any, *_args: Any) -> None:
        import websockets  # type: ignore

        target_url = self.read_sandbox_endpoint() or self.sandbox_ws_url
        if not target_url:
            try:
                async for raw in client_ws:
                    req_id = None
                    try:
                        req_id = json.loads(raw).get("id")
                    except Exception:
                        pass
                    await client_ws.send(
                        json.dumps(
                            {
                                "id": req_id,
                                "ok": False,
                                "error": "Windows Sandbox is still booting (wait ~10 seconds until [READY] appears, then retry).",
                            }
                        )
                    )
            except Exception:
                pass
            return

        print(f"[RELAY] Client connected -> forwarding to {target_url}")
        try:
            async with websockets.connect(
                target_url,
                max_size=16 * 1024 * 1024,
                ping_interval=20,
                ping_timeout=20,
                open_timeout=8,
            ) as upstream_ws:
                async def c2s() -> None:
                    async for msg in client_ws:
                        await upstream_ws.send(msg)

                async def s2c() -> None:
                    async for msg in upstream_ws:
                        await client_ws.send(msg)

                done, pending = await asyncio.wait(
                    [asyncio.create_task(c2s()), asyncio.create_task(s2c())],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
        except Exception as exc:
            print(f"[RELAY ERROR] Cannot reach Windows Sandbox at {target_url}: {exc}", file=sys.stderr)
            try:
                await client_ws.send(
                    json.dumps(
                        {
                            "ok": False,
                            "error": f"Cannot reach Windows Sandbox at {target_url}. Ensure Sandbox is running and Firewall allows port {self.port}. ({exc})",
                        }
                    )
                )
            except Exception:
                pass


async def run_launcher(args: argparse.Namespace) -> None:
    try:
        import websockets  # type: ignore
    except ImportError:
        print("[ERROR] Missing 'websockets' package. Run desktop-agent/setup_one_click.bat first.", file=sys.stderr)
        sys.exit(1)

    agent_dir = Path(__file__).resolve().parent
    bridge_dir = agent_dir / "_sandbox_bridge"
    bridge_dir.mkdir(parents=True, exist_ok=True)
    endpoint_file = bridge_dir / "sandbox_endpoint.json"
    token_file = bridge_dir / "token.txt"
    wsb_file = bridge_dir / "moho_sandbox.wsb"

    # Single-Instance Guard: if host relay is already active, do not spawn a duplicate Windows Sandbox!
    if is_relay_already_running():
        print("[INFO] Moho Windows Sandbox Host Relay is already running on ws://127.0.0.1:47892. Reusing active instance.")
        return

    sandbox_already_up = is_windows_sandbox_running()
    if not sandbox_already_up and endpoint_file.exists():
        endpoint_file.unlink()

    persistent_dir = ensure_persistent_sandbox_dirs(Path(args.persistent_dir) if args.persistent_dir else None)

    token = "" if args.no_auth else (args.token or secrets.token_urlsafe(24))
    token_file.write_text(token, encoding="utf-8")

    python_base_dir = Path(sys.base_prefix).resolve()
    workspace_dir = Path(args.workspace).resolve() if args.workspace else None

    wsb_xml = build_wsb_xml(
        python_base_dir=python_base_dir,
        agent_dir=agent_dir,
        persistent_dir=persistent_dir,
        workspace_dir=workspace_dir,
        memory_mb=args.memory_mb,
        enable_vgpu=not args.no_vgpu,
    )
    wsb_file.write_text(wsb_xml, encoding="utf-8")
    session_path = save_host_session_file(args.port, token, persistent_dir)

    print("=" * 74)
    print(f"  Moho Windows Sandbox Real-Desktop Launcher v{LAUNCHER_VERSION}")
    print("  Requirement: Windows 10/11 Pro, Enterprise, or Education (NOT Home)")
    print(f"  Host Relay Endpoint: ws://{args.host}:{args.port}")
    print(f"  Auth Token:          {token if token else '(disabled -- local dev mode)'}")
    print(f"  Persistent Storage:  {persistent_dir}  <->  C:\\MohoPersistent")
    print(f"  WSB Config:          {wsb_file}")
    print(f"  Session File:        {session_path}")
    print("=" * 74)

    if not args.relay_only and not sandbox_already_up:
        wsb_exe = find_windows_sandbox_exe()
        if not wsb_exe:
            print("\n[ERROR] WindowsSandbox.exe was not found on this PC!", file=sys.stderr)
            print("Windows Sandbox requires Windows 10/11 Pro, Enterprise, or Education.", file=sys.stderr)
            print("To enable it, open Command Prompt (cmd) as Administrator and run:", file=sys.stderr)
            print("  dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All", file=sys.stderr)
            print("Then restart your PC and run start_sandbox.bat again.", file=sys.stderr)
            sys.exit(3)

        print(f"[LAUNCH] Starting Windows Sandbox: {wsb_exe} \"{wsb_file}\"")
        subprocess.Popen([str(wsb_exe), str(wsb_file)], close_fds=True)
        if not getattr(args, "visible", False):
            start_stealth_hide_sandbox_window_thread()
        print("[WAIT] Waiting for Windows Sandbox to boot and announce its Real-Input Agent...")
    elif sandbox_already_up:
        print("[INFO] Existing Windows Sandbox instance detected — reusing it without opening a second instance.")
        if not getattr(args, "visible", False):
            start_stealth_hide_sandbox_window_thread()

    relay = SandboxWebSocketRelay(endpoint_file, args.host, args.port, token, persistent_dir)
    start_local_session_http_server(
        lambda: {
            "wsUrl": f"ws://{args.host}:{args.port}",
            "token": token,
            "mode": "windows_sandbox_real_input",
            "ready": bool(relay.sandbox_ws_url or relay.read_sandbox_endpoint()),
            "version": LAUNCHER_VERSION,
            "persistentDir": str(persistent_dir),
        }
    )
    announcer_task = asyncio.create_task(relay.wait_for_sandbox_announcer())
    try:
        async with websockets.serve(
            relay.handle_client,
            args.host,
            args.port,
            max_size=16 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        ):
            await asyncio.Future()
    finally:
        announcer_task.cancel()


def main() -> None:
    if sys.platform != "win32":
        print("[ERROR] Windows Sandbox launcher runs on Windows 10/11 Pro/Enterprise/Education only.", file=sys.stderr)
        sys.exit(2)

    parser = argparse.ArgumentParser(description="Moho Windows Sandbox Real-Desktop Launcher & Host Relay")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--token", default="")
    parser.add_argument("--persistent-dir", default=None, help="Host folder mapped to C:\\MohoPersistent (default: %%USERPROFILE%%\\MohoSandboxData)")
    parser.add_argument("--workspace", default=None, help="Optional extra host project folder mapped into C:\\MohoWorkspace")
    parser.add_argument("--memory-mb", type=int, default=4096, help="RAM in MB allocated to Windows Sandbox (default: 4096)")
    parser.add_argument("--no-vgpu", action="store_true", help="Disable virtualized GPU (uses software WARP)")
    parser.add_argument("--no-auth", action="store_true")
    parser.add_argument("--relay-only", action="store_true", help="Do not launch WindowsSandbox.exe; only run host relay")
    parser.add_argument("--visible", action="store_true", help="Keep Windows Sandbox window visible instead of stealth-hidden")
    args = parser.parse_args()

    try:
        asyncio.run(run_launcher(args))
    except KeyboardInterrupt:
        print("\n[Moho Sandbox Launcher] Host relay stopped cleanly.")


if __name__ == "__main__":
    main()
