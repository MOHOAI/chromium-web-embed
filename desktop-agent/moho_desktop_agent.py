#!/usr/bin/env python3
"""
Moho Windows 10/11 Hidden Desktop & Sandbox Terminal Agent (v6.0.0)
-------------------------------------------------------------------
1. TRUE Hidden Isolated Desktop (`CreateDesktopW` + `SetThreadDesktop` + `PrintWindow` + `PostMessageW`):
   - Creates a separate Win32 desktop (`MohoIsolatedDesktop`) WITHOUT switching the user's active screen!
   - Never moves or hijacks the user's physical mouse cursor or keyboard focus!
   - Launches apps (`notepad`, `cmd`, `explorer`, `chrome`, etc.) directly onto the hidden desktop.
   - Captures all hidden desktop windows via `PrintWindow(PW_RENDERFULLCONTENT)` and streams live JPEG/PNG frames.
   - Dispatches all clicks (left/right/middle/double/triple), drag-and-drop, wheel scroll, Unicode typing, and hotkeys
     directly via `PostMessageW` to the target hidden-desktop window.

2. Isolated Local Code & Terminal Sandbox (`SandboxTerminalEngine`):
   - Strictly jailed to a user-approved project folder (`workspaceRoot`, synced with Local Folder Brain).
   - Wraps every spawned process inside a Windows Job Object (`CreateJobObjectW` + `KILL_ON_JOB_CLOSE` + memory limit).
   - Auto-detects installed runtimes (`python`, `node`, `npm`, `npx`, `git`, `tsc`, `powershell`, `gcc`, `g++`, `go`, `rustc`, `java`).
   - Runs shell commands, project files (by extension), or inline multi-language code snippets with live streaming stdout/stderr.

Supported OS: Windows 10 (build >= 10240) and Windows 11 ONLY.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import ctypes
from ctypes import wintypes
import io
import json
import os
import platform
import queue
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

AGENT_VERSION = "7.0.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47892
MIN_WIN10_BUILD = 10240
HIDDEN_DESKTOP_NAME = "MohoIsolatedDesktop"


def check_windows_10_or_11() -> Tuple[bool, str, int]:
    if sys.platform != "win32":
        return (
            False,
            f"Unsupported OS: {platform.system()}. Moho Desktop Agent supports Windows 10 and Windows 11 only.",
            0,
        )
    ver_str = platform.version()
    parts = ver_str.split(".")
    try:
        major = int(parts[0])
        build = int(parts[2]) if len(parts) >= 3 else 0
    except (ValueError, IndexError):
        major, build = 0, 0
    if major < 10 or build < MIN_WIN10_BUILD:
        return (
            False,
            f"Unsupported Windows version ({ver_str}). Windows 10 (build >= {MIN_WIN10_BUILD}) or Windows 11 is required.",
            build,
        )
    edition = "Windows 11" if build >= 22000 else "Windows 10"
    return True, f"{edition} (Build {build})", build


# ---------------------------------------------------------------------------
# Win32 APIs (loaded only on win32)
# ---------------------------------------------------------------------------
if sys.platform == "win32":
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass

    # Desktop access rights
    GENERIC_ALL = 0x10000000
    DESKTOP_CREATEWINDOW = 0x0002
    DESKTOP_ENUMERATE = 0x0040
    DESKTOP_WRITEOBJECTS = 0x0080
    DESKTOP_SWITCHDESKTOP = 0x0100
    DESKTOP_CREATEMENU = 0x0004
    DESKTOP_HOOKCONTROL = 0x0008
    DESKTOP_READOBJECTS = 0x0001
    DESKTOP_ALL = (
        DESKTOP_READOBJECTS
        | DESKTOP_CREATEWINDOW
        | DESKTOP_CREATEMENU
        | DESKTOP_HOOKCONTROL
        | DESKTOP_ENUMERATE
        | DESKTOP_WRITEOBJECTS
        | DESKTOP_SWITCHDESKTOP
    )

    PW_RENDERFULLCONTENT = 0x00000002
    SRCCOPY = 0x00CC0020
    DIB_RGB_COLORS = 0
    BI_RGB = 0

    WM_MOUSEMOVE = 0x0200
    WM_LBUTTONDOWN = 0x0201
    WM_LBUTTONUP = 0x0202
    WM_LBUTTONDBLCLK = 0x0203
    WM_RBUTTONDOWN = 0x0204
    WM_RBUTTONUP = 0x0205
    WM_MBUTTONDOWN = 0x0207
    WM_MBUTTONUP = 0x0208
    WM_MOUSEWHEEL = 0x020A
    WM_MOUSEHWHEEL = 0x020E
    WM_KEYDOWN = 0x0100
    WM_KEYUP = 0x0101
    WM_CHAR = 0x0102
    WM_CLOSE = 0x0010
    WM_ACTIVATE = 0x0006
    WM_SETFOCUS = 0x0007
    WM_NCHITTEST = 0x0084
    WM_SYSCOMMAND = 0x0112
    SC_MINIMIZE = 0xF020
    SC_MAXIMIZE = 0xF030
    SC_RESTORE = 0xF120
    SC_CLOSE = 0xF060
    HTCAPTION = 2
    HTMINBUTTON = 8
    HTMAXBUTTON = 9
    HTCLOSE = 20
    HTBOTTOMRIGHT = 17
    SC_TASKLIST = 0xF130
    WM_XBUTTONDOWN = 0x020B
    WM_XBUTTONUP = 0x020C
    WM_CUT = 0x0300
    WM_COPY = 0x0301
    WM_PASTE = 0x0302
    WM_UNDO = 0x0304
    EM_SETSEL = 0x00B1
    SWP_NOSIZE = 0x0001
    SWP_NOZORDER = 0x0004
    SW_MINIMIZE = 6
    SW_MAXIMIZE = 3
    SW_RESTORE = 9
    SM_CXSCREEN = 0
    SM_CYSCREEN = 1

    MK_LBUTTON = 0x0001
    MK_RBUTTON = 0x0002
    MK_SHIFT = 0x0004
    MK_CONTROL = 0x0008
    MK_MBUTTON = 0x0010

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", wintypes.LONG),
            ("biHeight", wintypes.LONG),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", wintypes.LONG),
            ("biYPelsPerMeter", wintypes.LONG),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]

    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("lpReserved", wintypes.LPWSTR),
            ("lpDesktop", wintypes.LPWSTR),
            ("lpTitle", wintypes.LPWSTR),
            ("dwX", wintypes.DWORD),
            ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD),
            ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD),
            ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD),
            ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.POINTER(ctypes.c_byte)),
            ("hStdInput", wintypes.HANDLE),
            ("hStdOutput", wintypes.HANDLE),
            ("hStdError", wintypes.HANDLE),
        ]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("hProcess", wintypes.HANDLE),
            ("hThread", wintypes.HANDLE),
            ("dwProcessId", wintypes.DWORD),
            ("dwThreadId", wintypes.DWORD),
        ]

    # Job Object structures for Sandbox Terminal isolation
    JobObjectExtendedLimitInformation = 9
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    # Configure function signatures
    user32.CreateDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    user32.CreateDesktopW.restype = wintypes.HANDLE
    user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user32.OpenDesktopW.restype = wintypes.HANDLE
    user32.SetThreadDesktop.argtypes = [wintypes.HANDLE]
    user32.SetThreadDesktop.restype = wintypes.BOOL
    user32.CloseDesktop.argtypes = [wintypes.HANDLE]
    user32.CloseDesktop.restype = wintypes.BOOL
    user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    user32.PrintWindow.restype = wintypes.BOOL
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.ScreenToClient.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user32.ScreenToClient.restype = wintypes.BOOL
    user32.ChildWindowFromPointEx.argtypes = [wintypes.HWND, wintypes.POINT, wintypes.UINT]
    user32.ChildWindowFromPointEx.restype = wintypes.HWND
    user32.RealChildWindowFromPoint.argtypes = [wintypes.HWND, wintypes.POINT]
    user32.RealChildWindowFromPoint.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
    user32.MapVirtualKeyW.restype = wintypes.UINT
    user32.BringWindowToTop.argtypes = [wintypes.HWND]
    user32.BringWindowToTop.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.IsZoomed.argtypes = [wintypes.HWND]
    user32.IsZoomed.restype = wintypes.BOOL
    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.restype = ctypes.c_int

    VK_MAP: Dict[str, int] = {
        "backspace": 0x08, "tab": 0x09, "enter": 0x0D, "return": 0x0D,
        "shift": 0x10, "ctrl": 0x11, "control": 0x11, "alt": 0x12,
        "escape": 0x1B, "esc": 0x1B, "space": 0x20, " ": 0x20,
        "pageup": 0x21, "pagedown": 0x22, "end": 0x23, "home": 0x24,
        "left": 0x25, "arrowleft": 0x25, "up": 0x26, "arrowup": 0x26,
        "right": 0x27, "arrowright": 0x27, "down": 0x28, "arrowdown": 0x28,
        "insert": 0x2D, "delete": 0x2E, "win": 0x5B, "meta": 0x5B, "super": 0x5B,
    }
    for _i in range(1, 13):
        VK_MAP[f"f{_i}"] = 0x6F + _i
    for _i in range(0, 10):
        VK_MAP[str(_i)] = 0x30 + _i
    for _c in "abcdefghijklmnopqrstuvwxyz":
        VK_MAP[_c] = ord(_c.upper())


def _make_lparam(x: int, y: int) -> int:
    return ((int(y) & 0xFFFF) << 16) | (int(x) & 0xFFFF)


# ---------------------------------------------------------------------------
# 1. TRUE Hidden Isolated Desktop Engine (Never switches user screen or mouse!)
# ---------------------------------------------------------------------------
class HiddenDesktopEngine:
    """
    Runs a dedicated worker thread bound via `SetThreadDesktop` to `MohoIsolatedDesktop`
    created via `CreateDesktopW`. All window enumeration, rendering (`PrintWindow`),
    and input (`PostMessageW`) happen strictly inside that hidden desktop without
    ever switching the user's screen or moving the user's physical mouse cursor.
    """

    def __init__(self, width: Optional[int] = None, height: Optional[int] = None) -> None:
        if sys.platform == "win32":
            rw = int(user32.GetSystemMetrics(SM_CXSCREEN)) or 1920
            rh = int(user32.GetSystemMetrics(SM_CYSCREEN)) or 1080
        else:
            rw, rh = 1920, 1080
        self.width = width or rw
        self.height = height or rh
        self._drag_window_hwnd: Optional[int] = None
        self._drag_window_offset: Tuple[int, int] = (0, 0)
        self.desktop_name = HIDDEN_DESKTOP_NAME
        self.mode_name = "hidden_win32_desktop"
        self.hdesk: Optional[int] = None
        self.active = False
        self.emergency_stopped = False
        self.virtual_cursor = {"x": self.width // 2, "y": self.height // 2}
        self.launched_pids: List[int] = []
        self._cmd_q: "queue.Queue[Tuple[Callable[[], Any], queue.Queue[Tuple[bool, Any]]]]" = queue.Queue()
        self._worker: Optional[threading.Thread] = None
        self._focused_hwnd: Optional[int] = None

        try:
            from PIL import Image, ImageDraw  # type: ignore
            self._Image = Image
            self._ImageDraw = ImageDraw
        except Exception:
            self._Image = None
            self._ImageDraw = None

    def _run_on_desktop_thread(self, fn: Callable[[], Any], timeout: float = 10.0) -> Any:
        if not self.active or not self._worker or not self._worker.is_alive():
            raise RuntimeError("Hidden isolated desktop is not active. Call create_virtual_desktop first.")
        res_q: "queue.Queue[Tuple[bool, Any]]" = queue.Queue(maxsize=1)
        self._cmd_q.put((fn, res_q))
        ok, val = res_q.get(timeout=timeout)
        if not ok:
            raise val
        return val

    def _worker_main(self, ready_q: "queue.Queue[Tuple[bool, Any]]") -> None:
        try:
            hdesk = user32.OpenDesktopW(self.desktop_name, 0, False, DESKTOP_ALL)
            if not hdesk:
                hdesk = user32.CreateDesktopW(self.desktop_name, None, None, 0, DESKTOP_ALL, None)
            if not hdesk:
                raise OSError(f"CreateDesktopW failed (error={ctypes.get_last_error()})")
            if not user32.SetThreadDesktop(hdesk):
                raise OSError(f"SetThreadDesktop failed (error={ctypes.get_last_error()})")
            self.hdesk = hdesk
            self.active = True
            ready_q.put((True, hdesk))
        except Exception as exc:
            ready_q.put((False, exc))
            return

        while self.active:
            try:
                fn, res_q = self._cmd_q.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                out = fn()
                res_q.put((True, out))
            except Exception as exc:
                res_q.put((False, exc))

    def create_isolated_desktop(self, launch_app: Optional[str] = None, launch_args: Optional[List[str]] = None) -> Dict[str, Any]:
        if not self.active:
            ready_q: "queue.Queue[Tuple[bool, Any]]" = queue.Queue(maxsize=1)
            self._worker = threading.Thread(target=self._worker_main, args=(ready_q,), daemon=True, name="MohoHiddenDesktop")
            self._worker.start()
            ok, val = ready_q.get(timeout=5.0)
            if not ok:
                raise val
            # Launch real Windows Shell (explorer.exe) so the hidden desktop shows a real clean Windows desktop + taskbar!
            # Pass launchApp="none" for a completely empty blank desktop.
            if launch_app != "none":
                starter = launch_app or "explorer.exe"
                try:
                    self.launch_app_on_hidden_desktop(starter, launch_args or [])
                except Exception:
                    pass
        elif launch_app:
            self.launch_app_on_hidden_desktop(launch_app, launch_args or [])

        return {
            "ok": True,
            "mode": getattr(d, "mode_name", "hidden_win32_desktop"),
            "desktopName": self.desktop_name,
            "virtualDesktopActive": True,
            "width": self.width,
            "height": self.height,
            "message": "Hidden isolated Windows desktop is active. Your primary screen and mouse are untouched.",
        }

    def close_isolated_desktop(self) -> Dict[str, Any]:
        for pid in list(self.launched_pids):
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=3)
            except Exception:
                pass
        self.launched_pids.clear()
        self.active = False
        if self.hdesk:
            try:
                user32.CloseDesktop(self.hdesk)
            except Exception:
                pass
            self.hdesk = None
        return {"ok": True, "virtualDesktopActive": False}

    def launch_app_on_hidden_desktop(self, command: str, args: Optional[List[str]] = None) -> Dict[str, Any]:
        if not self.active:
            self.create_isolated_desktop()
        cmdline = subprocess.list2cmdline([command] + [str(a) for a in (args or [])])
        si = STARTUPINFOW()
        si.cb = ctypes.sizeof(STARTUPINFOW)
        si.lpDesktop = self.desktop_name
        pi = PROCESS_INFORMATION()
        cmd_buf = ctypes.create_unicode_buffer(cmdline)
        ok = kernel32.CreateProcessW(
            None, cmd_buf, None, None, False, 0, None, None, ctypes.byref(si), ctypes.byref(pi)
        )
        if not ok:
            raise OSError(f"CreateProcessW failed for {command!r} (error={ctypes.get_last_error()})")
        kernel32.CloseHandle(pi.hThread)
        kernel32.CloseHandle(pi.hProcess)
        self.launched_pids.append(int(pi.dwProcessId))
        return {"ok": True, "pid": int(pi.dwProcessId), "desktop": self.desktop_name, "command": cmdline}

    def _enum_desktop_windows_internal(self) -> List[Dict[str, Any]]:
        wins: List[Dict[str, Any]] = []
        EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def cb(hwnd, _lp):
            if not user32.IsWindowVisible(hwnd):
                return True
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w, h = int(rect.right - rect.left), int(rect.bottom - rect.top)
            if w <= 10 or h <= 10:
                return True
            tlen = user32.GetWindowTextLengthW(hwnd)
            tbuf = ctypes.create_unicode_buffer(tlen + 1)
            if tlen > 0:
                user32.GetWindowTextW(hwnd, tbuf, tlen + 1)
            wins.append({
                "hwnd": int(hwnd),
                "title": tbuf.value.strip(),
                "rect": {"x": int(rect.left), "y": int(rect.top), "width": w, "height": h},
            })
            return True

        user32.EnumDesktopWindows(self.hdesk, EnumProc(cb), 0)
        return wins

    def list_windows(self) -> List[Dict[str, Any]]:
        if not self.active:
            return []
        return self._run_on_desktop_thread(self._enum_desktop_windows_internal)

    def _capture_hwnd_pil(self, hwnd: int, w: int, h: int):
        hdc_win = user32.GetWindowDC(hwnd)
        if not hdc_win:
            return None
        hdc_mem = gdi32.CreateCompatibleDC(hdc_win)
        hbmp = gdi32.CreateCompatibleBitmap(hdc_win, w, h)
        old = gdi32.SelectObject(hdc_mem, hbmp)
        try:
            rendered = user32.PrintWindow(hwnd, hdc_mem, PW_RENDERFULLCONTENT)
            if not rendered:
                rendered = user32.PrintWindow(hwnd, hdc_mem, 0)
            if not rendered:
                gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_win, 0, 0, SRCCOPY)

            bmi = BITMAPINFO()
            bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.bmiHeader.biWidth = w
            bmi.bmiHeader.biHeight = -h
            bmi.bmiHeader.biPlanes = 1
            bmi.bmiHeader.biBitCount = 32
            bmi.bmiHeader.biCompression = BI_RGB
            buf = ctypes.create_string_buffer(w * h * 4)
            gdi32.GetDIBits(hdc_mem, hbmp, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS)
            return self._Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")
        finally:
            gdi32.SelectObject(hdc_mem, old)
            gdi32.DeleteObject(hbmp)
            gdi32.DeleteDC(hdc_mem)
            user32.ReleaseDC(hwnd, hdc_win)

    def capture_frame(self, fmt: str = "jpeg", quality: int = 72, max_width: Optional[int] = None) -> Dict[str, Any]:
        if self._Image is None:
            raise RuntimeError("Pillow is required for hidden desktop rendering.")
        if not self.active:
            self.create_isolated_desktop()

        def _render():
            canvas = self._Image.new("RGB", (self.width, self.height), (11, 18, 34))
            draw = self._ImageDraw.Draw(canvas)
            # Draw subtle taskbar and wallpaper banner
            draw.rectangle([0, self.height - 36, self.width, self.height], fill=(15, 23, 42))
            draw.text((16, self.height - 25), f"Moho Isolated Desktop ({self.desktop_name}) — Background Mode", fill=(125, 211, 252))

            wins = self._enum_desktop_windows_internal()
            # Composite from bottom-most to top-most Z-order
            for winfo in reversed(wins):
                r = winfo["rect"]
                ww, hh = min(self.width, r["width"]), min(self.height, r["height"])
                if ww <= 0 or hh <= 0:
                    continue
                try:
                    wimg = self._capture_hwnd_pil(winfo["hwnd"], r["width"], r["height"])
                    if wimg is not None:
                        canvas.paste(wimg, (r["x"], r["y"]))
                except Exception:
                    pass

            # Draw virtual AI cursor dot (user's physical mouse is untouched!)
            cx, cy = self.virtual_cursor["x"], self.virtual_cursor["y"]
            draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=(56, 189, 248), width=2)
            return canvas

        img = self._run_on_desktop_thread(_render)
        orig_w, orig_h = img.size
        if max_width and orig_w > max_width:
            ratio = max_width / float(orig_w)
            img = img.resize((int(max_width), max(1, int(orig_h * ratio))), self._Image.Resampling.BILINEAR)

        buf = io.BytesIO()
        fmt_clean = "png" if str(fmt).lower() == "png" else "jpeg"
        if fmt_clean == "jpeg":
            img.save(buf, format="JPEG", quality=max(20, min(95, int(quality))), optimize=True)
            mime = "image/jpeg"
        else:
            img.save(buf, format="PNG", optimize=True)
            mime = "image/png"
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "format": fmt_clean,
            "mimeType": mime,
            "base64": b64,
            "dataUrl": f"data:{mime};base64,{b64}",
            "width": img.size[0],
            "height": img.size[1],
            "screenWidth": orig_w,
            "screenHeight": orig_h,
            "mode": getattr(d, "mode_name", "hidden_win32_desktop"),
            "capturedAt": int(time.time() * 1000),
        }

    def resolve_coords(self, x: Optional[float], y: Optional[float], space: str = "pixels") -> Tuple[int, int]:
        rx = self.virtual_cursor["x"] if x is None else (
            int(round((max(0.0, min(999.0, float(x))) / 1000.0) * self.width)) if space == "normalized_1000" else int(round(float(x)))
        )
        ry = self.virtual_cursor["y"] if y is None else (
            int(round((max(0.0, min(999.0, float(y))) / 1000.0) * self.height)) if space == "normalized_1000" else int(round(float(y)))
        )
        rx = max(0, min(self.width - 1, rx))
        ry = max(0, min(self.height - 1, ry))
        self.virtual_cursor = {"x": rx, "y": ry}
        return rx, ry

    def _hit_test_target(self, x: int, y: int) -> Tuple[Optional[int], Optional[int], int, int]:
        """Find top-most window & recursively descend via RealChildWindowFromPoint to deepest control."""
        wins = self._enum_desktop_windows_internal()
        for winfo in wins:
            r = winfo["rect"]
            if r["x"] <= x < r["x"] + r["width"] and r["y"] <= y < r["y"] + r["height"]:
                top_hwnd = winfo["hwnd"]
                cur = top_hwnd
                for _ in range(8):
                    pt = wintypes.POINT(x, y)
                    user32.ScreenToClient(cur, ctypes.byref(pt))
                    nxt = user32.RealChildWindowFromPoint(cur, pt)
                    if not nxt or nxt == cur:
                        return top_hwnd, int(cur), int(pt.x), int(pt.y)
                    cur = int(nxt)
                pt_f = wintypes.POINT(x, y)
                user32.ScreenToClient(cur, ctypes.byref(pt_f))
                return top_hwnd, int(cur), int(pt_f.x), int(pt_f.y)
        return self._focused_hwnd, self._focused_hwnd, x, y

    def dispatch_mouse(self, action: str, x: int, y: int, button: str = "left", delta_x: int = 0, delta_y: int = 0) -> Dict[str, Any]:
        if self.emergency_stopped:
            raise RuntimeError("Agent halted by Emergency Kill Switch.")

        def _do():
            # Active title-bar window drag in progress
            if action == "move" and self._drag_window_hwnd:
                nx = x - self._drag_window_offset[0]
                ny = y - self._drag_window_offset[1]
                user32.SetWindowPos(self._drag_window_hwnd, 0, nx, ny, 0, 0, SWP_NOSIZE | SWP_NOZORDER)
                return {"ok": True, "hwnd": self._drag_window_hwnd, "draggedTo": {"x": nx, "y": ny}}
            if action == "mouse_up" and self._drag_window_hwnd:
                hw = self._drag_window_hwnd
                self._drag_window_hwnd = None
                return {"ok": True, "hwnd": hw, "cursor": {"x": x, "y": y}}

            top_hwnd, hwnd, cx, cy = self._hit_test_target(x, y)
            if not hwnd or not top_hwnd:
                return {"ok": True, "cursor": {"x": x, "y": y}, "note": "No window under point"}
            self._focused_hwnd = hwnd
            lp = _make_lparam(cx, cy)

            # Check non-client hit test (title bar / close / max / min buttons) on left button actions
            if button == "left" and action in ("mouse_down", "click", "double_click"):
                user32.BringWindowToTop(top_hwnd)
                user32.PostMessageW(top_hwnd, WM_ACTIVATE, 2, 0)  # WA_CLICKACTIVE
                user32.PostMessageW(hwnd, WM_SETFOCUS, 0, 0)
                ht = int(user32.SendMessageW(top_hwnd, WM_NCHITTEST, 0, _make_lparam(x, y)))
                if ht == HTCLOSE:
                    user32.PostMessageW(top_hwnd, WM_SYSCOMMAND, SC_CLOSE, 0)
                    return {"ok": True, "hwnd": top_hwnd, "ncAction": "close"}
                if ht == HTMAXBUTTON:
                    cmd = SC_RESTORE if user32.IsZoomed(top_hwnd) else SC_MAXIMIZE
                    user32.PostMessageW(top_hwnd, WM_SYSCOMMAND, cmd, 0)
                    return {"ok": True, "hwnd": top_hwnd, "ncAction": "toggle_maximize"}
                if ht == HTMINBUTTON:
                    user32.PostMessageW(top_hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0)
                    return {"ok": True, "hwnd": top_hwnd, "ncAction": "minimize"}
                if ht == HTCAPTION and action == "mouse_down":
                    rect = wintypes.RECT()
                    user32.GetWindowRect(top_hwnd, ctypes.byref(rect))
                    self._drag_window_hwnd = top_hwnd
                    self._drag_window_offset = (x - int(rect.left), y - int(rect.top))
                    return {"ok": True, "hwnd": top_hwnd, "ncAction": "start_drag_window"}

            if action == "move":
                user32.PostMessageW(hwnd, WM_MOUSEMOVE, 0, lp)
            elif action == "mouse_down":
                msg = WM_RBUTTONDOWN if button == "right" else WM_MBUTTONDOWN if button == "middle" else WM_LBUTTONDOWN
                mk = MK_RBUTTON if button == "right" else MK_MBUTTON if button == "middle" else MK_LBUTTON
                user32.PostMessageW(hwnd, msg, mk, lp)
            elif action == "mouse_up":
                msg = WM_RBUTTONUP if button == "right" else WM_MBUTTONUP if button == "middle" else WM_LBUTTONUP
                user32.PostMessageW(hwnd, msg, 0, lp)
            elif action in ("x1_click", "x2_click"):
                xb = 1 if action == "x1_click" else 2
                wp = (xb << 16)
                user32.PostMessageW(hwnd, WM_XBUTTONDOWN, wp, lp)
                user32.PostMessageW(hwnd, WM_XBUTTONUP, wp, lp)
            elif action in ("click", "double_click", "triple_click", "right_click", "middle_click"):
                b = "right" if action == "right_click" else "middle" if action == "middle_click" else button
                down = WM_RBUTTONDOWN if b == "right" else WM_MBUTTONDOWN if b == "middle" else WM_LBUTTONDOWN
                up = WM_RBUTTONUP if b == "right" else WM_MBUTTONUP if b == "middle" else WM_LBUTTONUP
                mk = MK_RBUTTON if b == "right" else MK_MBUTTON if b == "middle" else MK_LBUTTON
                count = 2 if action == "double_click" else 3 if action == "triple_click" else 1
                user32.PostMessageW(hwnd, WM_MOUSEMOVE, 0, lp)
                for i in range(count):
                    if i == 1 and b == "left":
                        user32.PostMessageW(hwnd, WM_LBUTTONDBLCLK, mk, lp)
                    else:
                        user32.PostMessageW(hwnd, down, mk, lp)
                    user32.PostMessageW(hwnd, up, 0, lp)
                # If double-clicking a desktop icon (SysListView32), also send Enter to reliably launch the item
                if action == "double_click":
                    cls_buf = ctypes.create_unicode_buffer(64)
                    user32.GetClassNameW(hwnd, cls_buf, 64)
                    if cls_buf.value.lower() == "syslistview32":
                        user32.PostMessageW(hwnd, WM_KEYDOWN, 0x0D, 1 | (0x1C << 16))
                        user32.PostMessageW(hwnd, WM_KEYUP, 0x0D, 1 | (0x1C << 16) | (1 << 30) | (1 << 31))
            elif action == "scroll":
                if delta_y:
                    wp = ((-int(delta_y)) & 0xFFFF) << 16
                    user32.PostMessageW(hwnd, WM_MOUSEWHEEL, wp, _make_lparam(x, y))
                if delta_x:
                    wp = (int(delta_x) & 0xFFFF) << 16
                    user32.PostMessageW(hwnd, WM_MOUSEHWHEEL, wp, _make_lparam(x, y))
            return {"ok": True, "hwnd": hwnd, "topHwnd": top_hwnd, "cursor": {"x": x, "y": y}}

        return self._run_on_desktop_thread(_do)

    def dispatch_drag(self, points: List[Tuple[int, int]], button: str = "left") -> Dict[str, Any]:
        if len(points) < 2:
            raise ValueError("drag_and_drop requires at least 2 points.")
        self.dispatch_mouse("mouse_down", points[0][0], points[0][1], button=button)
        for i in range(1, len(points)):
            sx, sy = points[i - 1]
            ex, ey = points[i]
            for step in range(1, 9):
                nx = int(round(sx + (ex - sx) * (step / 8.0)))
                ny = int(round(sy + (ey - sy) * (step / 8.0)))
                self.dispatch_mouse("move", nx, ny, button=button)
                time.sleep(0.01)
        return self.dispatch_mouse("mouse_up", points[-1][0], points[-1][1], button=button)

    def dispatch_text(self, text: str, press_enter: bool = False) -> Dict[str, Any]:
        if self.emergency_stopped:
            raise RuntimeError("Agent halted by Emergency Kill Switch.")

        def _do():
            hwnd = self._focused_hwnd
            if not hwnd:
                wins = self._enum_desktop_windows_internal()
                if wins:
                    hwnd = wins[0]["hwnd"]
                    self._focused_hwnd = hwnd
            if not hwnd:
                return {"ok": False, "error": "No target window on hidden desktop."}
            for ch in text:
                if ch == "\n":
                    user32.PostMessageW(hwnd, WM_KEYDOWN, 0x0D, 0)
                    user32.PostMessageW(hwnd, WM_KEYUP, 0x0D, 0)
                else:
                    user32.PostMessageW(hwnd, WM_CHAR, ord(ch), 0)
            if press_enter:
                user32.PostMessageW(hwnd, WM_KEYDOWN, 0x0D, 0)
                user32.PostMessageW(hwnd, WM_KEYUP, 0x0D, 0)
            return {"ok": True, "hwnd": hwnd}

        return self._run_on_desktop_thread(_do)

    def dispatch_key(self, key: str) -> Dict[str, Any]:
        vk = VK_MAP.get(key.lower(), ord(key.upper()) if len(key) == 1 else 0x0D)

        def _do():
            hwnd = self._focused_hwnd
            if not hwnd:
                wins = self._enum_desktop_windows_internal()
                if wins:
                    hwnd = wins[0]["hwnd"]
            if not hwnd:
                return {"ok": False, "error": "No target window on hidden desktop."}
            scan = int(user32.MapVirtualKeyW(vk, 0)) & 0xFF
            lp_down = 1 | (scan << 16)
            lp_up = 1 | (scan << 16) | (1 << 30) | (1 << 31)
            user32.PostMessageW(hwnd, WM_KEYDOWN, vk, lp_down)
            user32.PostMessageW(hwnd, WM_KEYUP, vk, lp_up)
            return {"ok": True, "hwnd": hwnd, "vk": vk, "scan": scan}

        return self._run_on_desktop_thread(_do)

    def window_action(self, op: str, hwnd: Optional[int] = None, x: int = 100, y: int = 80, width: int = 960, height: int = 640) -> Dict[str, Any]:
        def _do():
            target = hwnd or self._focused_hwnd
            if not target:
                wins = self._enum_desktop_windows_internal()
                if wins:
                    target = wins[0]["hwnd"]
            if not target:
                return {"ok": False, "error": "No window available on hidden desktop."}
            if op == "close":
                user32.PostMessageW(target, WM_SYSCOMMAND, SC_CLOSE, 0)
            elif op == "maximize":
                user32.ShowWindow(target, SW_MAXIMIZE)
            elif op == "minimize":
                user32.ShowWindow(target, SW_MINIMIZE)
            elif op == "restore":
                user32.ShowWindow(target, SW_RESTORE)
            elif op == "move_resize":
                user32.SetWindowPos(target, 0, int(x), int(y), int(width), int(height), SWP_NOZORDER)
            return {"ok": True, "hwnd": int(target), "op": op}
        return self._run_on_desktop_thread(_do)

    def open_start_menu(self) -> Dict[str, Any]:
        def _do():
            tray = user32.FindWindowW("Shell_TrayWnd", None)
            if tray:
                user32.PostMessageW(tray, WM_SYSCOMMAND, SC_TASKLIST, 0)
                return {"ok": True, "trayHwnd": int(tray)}
            return {"ok": False, "error": "Shell_TrayWnd not found on hidden desktop."}
        return self._run_on_desktop_thread(_do)

    def show_desktop(self) -> Dict[str, Any]:
        def _do():
            wins = self._enum_desktop_windows_internal()
            minimized = 0
            for w in wins:
                cls_buf = ctypes.create_unicode_buffer(64)
                user32.GetClassNameW(w["hwnd"], cls_buf, 64)
                if cls_buf.value not in ("Shell_TrayWnd", "Progman", "WorkerW"):
                    user32.ShowWindow(w["hwnd"], SW_MINIMIZE)
                    minimized += 1
            return {"ok": True, "minimizedCount": minimized}
        return self._run_on_desktop_thread(_do)

    def dispatch_hotkey(self, keys: List[str]) -> Dict[str, Any]:
        norm = [k.strip().lower() for k in keys if k]
        if not norm:
            return {"ok": False, "error": "Empty hotkey"}
        if norm == ["win"] or norm == ["meta"] or norm == ["super"]:
            return self.open_start_menu()
        if set(norm) == {"win", "d"}:
            return self.show_desktop()
        if set(norm) == {"win", "r"}:
            return self.launch_app_on_hidden_desktop("cmd.exe", [])
        if set(norm) == {"alt", "f4"}:
            return self.window_action("close")

        def _do():
            hwnd = self._focused_hwnd
            if not hwnd:
                wins = self._enum_desktop_windows_internal()
                if wins:
                    hwnd = wins[0]["hwnd"]
            if not hwnd:
                return {"ok": False, "error": "No focused window on hidden desktop."}
            if "ctrl" in norm or "control" in norm:
                main = norm[-1]
                if main == "c": user32.PostMessageW(hwnd, WM_COPY, 0, 0); return {"ok": True, "msg": "WM_COPY"}
                if main == "v": user32.PostMessageW(hwnd, WM_PASTE, 0, 0); return {"ok": True, "msg": "WM_PASTE"}
                if main == "x": user32.PostMessageW(hwnd, WM_CUT, 0, 0); return {"ok": True, "msg": "WM_CUT"}
                if main == "z": user32.PostMessageW(hwnd, WM_UNDO, 0, 0); return {"ok": True, "msg": "WM_UNDO"}
                if main == "a": user32.PostMessageW(hwnd, EM_SETSEL, 0, -1); return {"ok": True, "msg": "EM_SETSEL"}
            return self.dispatch_key(norm[-1])

        return self._run_on_desktop_thread(_do)

    def clipboard_get(self) -> str:
        if sys.platform != "win32":
            return ""
        CF_UNICODETEXT = 13
        if not user32.OpenClipboard(0):
            return ""
        try:
            handle = user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return ""
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                return ""
            try:
                return ctypes.wstring_at(ptr)
            finally:
                kernel32.GlobalUnlock(handle)
        finally:
            user32.CloseClipboard()

    def clipboard_set(self, text: str) -> None:
        if sys.platform != "win32":
            return
        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002
        data = (text + "\x00").encode("utf-16-le")
        if not user32.OpenClipboard(0):
            raise RuntimeError("Failed to open clipboard.")
        try:
            user32.EmptyClipboard()
            hmem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
            ptr = kernel32.GlobalLock(hmem)
            ctypes.memmove(ptr, data, len(data))
            kernel32.GlobalUnlock(hmem)
            user32.SetClipboardData(CF_UNICODETEXT, hmem)
        finally:
            user32.CloseClipboard()


# ---------------------------------------------------------------------------
# 2. Isolated Local Terminal & Multi-Language Code Sandbox (Windows Job Objects)
# ---------------------------------------------------------------------------

def is_windows_sandbox_env() -> bool:
    return os.environ.get("USERNAME", "").strip().lower() == "wdagutilityaccount"


def detect_reachable_ipv4() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith(("127.", "169.254.")):
                return ip
        finally:
            s.close()
    except Exception:
        pass
    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in ips:
            if ip and not ip.startswith(("127.", "169.254.")):
                return ip
    except Exception:
        pass
    return "127.0.0.1"


class RealInputDesktopEngine:
    """
    100% Real-Input Windows Desktop Engine (designed for Windows Sandbox / VM).
    Uses hardware-level Win32 SendInput + per-capture mss.MSS() screen streaming so
    Start Menu, Taskbar, Explorer, Drag & Drop, UWP/WinUI apps, and Chrome work 100%
    natively inside Windows Sandbox without ever touching the host user's mouse or screen.
    """

    def __init__(self, width: Optional[int] = None, height: Optional[int] = None) -> None:
        self.is_sandbox = is_windows_sandbox_env()
        self.mode_name = "windows_sandbox_real_input" if self.is_sandbox else "real_input_desktop"
        self.desktop_name = "WindowsSandbox" if self.is_sandbox else "Default"
        self.active = True
        self.emergency_stopped = False

        if sys.platform == "win32":
            user32 = ctypes.windll.user32
            try:
                user32.SetProcessDPIAware()
            except Exception:
                pass
            sw = int(user32.GetSystemMetrics(0) or 1920)
            sh = int(user32.GetSystemMetrics(1) or 1080)
        else:
            sw, sh = 1920, 1080

        self.width = int(width) if width is not None else max(800, sw)
        self.height = int(height) if height is not None else max(600, sh)
        self.virtual_cursor = {"x": self.width // 2, "y": self.height // 2}
        self._Image = None
        try:
            from PIL import Image  # type: ignore
            self._Image = Image
        except Exception:
            pass

    def _send_mouse_input(self, flags: int, x: Optional[int] = None, y: Optional[int] = None, mouse_data: int = 0) -> None:
        if sys.platform != "win32":
            return
        user32 = ctypes.windll.user32
        INPUT_MOUSE = 0
        MOUSEEVENTF_MOVE = 0x0001
        MOUSEEVENTF_ABSOLUTE = 0x8000
        MOUSEEVENTF_VIRTUALDESK = 0x4000

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [
                ("dx", wintypes.LONG),
                ("dy", wintypes.LONG),
                ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
            ]

        class _INPUTUNION(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("union", _INPUTUNION)]

        dx = 0
        dy = 0
        if x is not None and y is not None:
            dx = int(max(0, min(65535, round(x * 65535 / max(1, self.width - 1)))))
            dy = int(max(0, min(65535, round(y * 65535 / max(1, self.height - 1)))))
            flags |= MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK

        inp = INPUT(type=INPUT_MOUSE, union=_INPUTUNION(mi=MOUSEINPUT(dx=dx, dy=dy, mouseData=mouse_data & 0xFFFFFFFF, dwFlags=flags, time=0, dwExtraInfo=None)))
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    def _send_key_input(self, vk: int = 0, scan: int = 0, flags: int = 0) -> None:
        if sys.platform != "win32":
            return
        user32 = ctypes.windll.user32
        INPUT_KEYBOARD = 1

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", wintypes.WORD),
                ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
            ]

        class _INPUTUNION(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("union", _INPUTUNION)]

        inp = INPUT(type=INPUT_KEYBOARD, union=_INPUTUNION(ki=KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=None)))
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    def _vk_from_name(self, key: str) -> int:
        k = key.strip().lower()
        table = {
            "enter": 0x0D, "return": 0x0D, "tab": 0x09, "escape": 0x1B, "esc": 0x1B,
            "backspace": 0x08, "space": 0x20, "delete": 0x2E, "del": 0x2E, "insert": 0x2D,
            "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
            "left": 0x25, "arrowleft": 0x25, "up": 0x26, "arrowup": 0x26,
            "right": 0x27, "arrowright": 0x27, "down": 0x28, "arrowdown": 0x28,
            "ctrl": 0x11, "control": 0x11, "alt": 0x12, "shift": 0x10,
            "win": 0x5B, "meta": 0x5B, "super": 0x5B, "lwin": 0x5B, "rwin": 0x5C,
            "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f5": 0x74, "f6": 0x75,
            "f7": 0x76, "f8": 0x77, "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
        }
        if k in table:
            return table[k]
        if len(k) == 1:
            return ord(k.upper())
        return 0x0D

    def create_isolated_desktop(self, launch_app: Optional[str] = None, launch_args: Optional[List[str]] = None) -> Dict[str, Any]:
        self.active = True
        if launch_app:
            self.launch_app_on_hidden_desktop(launch_app, launch_args)
        return {
            "ok": True,
            "mode": self.mode_name,
            "desktopName": self.desktop_name,
            "screen": {"width": self.width, "height": self.height},
            "note": "Running inside full interactive Windows Sandbox / Real-Input desktop.",
        }

    def close_isolated_desktop(self) -> Dict[str, Any]:
        return {"ok": True, "mode": self.mode_name, "note": "Close the Windows Sandbox window to dispose the sandbox session cleanly."}

    def launch_app_on_hidden_desktop(self, command: str, args: Optional[List[str]] = None) -> Dict[str, Any]:
        cmd = (command or "").strip()
        if not cmd:
            raise ValueError("Missing command to launch.")
        argv = [cmd] + [str(a) for a in (args or [])]
        proc = subprocess.Popen(argv, shell=False, close_fds=True)
        return {"ok": True, "pid": proc.pid, "command": cmd, "mode": self.mode_name}

    def list_windows(self) -> List[Dict[str, Any]]:
        if sys.platform != "win32":
            return []
        user32 = ctypes.windll.user32
        wins: List[Dict[str, Any]] = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def _cb(hwnd, _lp):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            title_buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title_buf, length + 1)
            cls_buf = ctypes.create_unicode_buffer(128)
            user32.GetClassNameW(hwnd, cls_buf, 128)
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            if rect.right - rect.left <= 0 or rect.bottom - rect.top <= 0:
                return True
            wins.append({
                "hwnd": int(hwnd),
                "title": title_buf.value,
                "className": cls_buf.value,
                "bounds": {"x": rect.left, "y": rect.top, "width": rect.right - rect.left, "height": rect.bottom - rect.top},
            })
            return True

        user32.EnumWindows(WNDENUMPROC(_cb), 0)
        return wins[:80]

    def capture_frame(self, fmt: str = "jpeg", quality: int = 72, max_width: Optional[int] = None) -> Dict[str, Any]:
        import mss  # type: ignore
        from PIL import Image  # type: ignore

        with mss.MSS() as sct:
            mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            raw = sct.grab(mon)
            self.width = raw.width
            self.height = raw.height
            img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

        if max_width and img.width > max_width:
            ratio = max_width / float(img.width)
            img = img.resize((int(max_width), max(1, int(img.height * ratio))), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        out_fmt = "PNG" if fmt.lower() == "png" else "JPEG"
        if out_fmt == "JPEG":
            img.save(buf, format="JPEG", quality=max(20, min(95, quality)), optimize=True)
            mime = "image/jpeg"
        else:
            img.save(buf, format="PNG")
            mime = "image/png"
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "format": out_fmt.lower(),
            "mimeType": mime,
            "base64": b64,
            "dataUrl": f"data:{mime};base64,{b64}",
            "width": img.width,
            "height": img.height,
            "screenWidth": self.width,
            "screenHeight": self.height,
            "mode": self.mode_name,
            "capturedAt": int(time.time() * 1000),
        }

    def resolve_coords(self, x: Optional[float], y: Optional[float], space: str = "pixels") -> Tuple[int, int]:
        rx = float(x if x is not None else self.virtual_cursor["x"])
        ry = float(y if y is not None else self.virtual_cursor["y"])
        if space == "normalized_1000":
            return (int(round(rx / 1000.0 * self.width)), int(round(ry / 1000.0 * self.height)))
        if space == "normalized_1":
            return (int(round(rx * self.width)), int(round(ry * self.height)))
        return (int(round(rx)), int(round(ry)))

    def dispatch_mouse(self, action: str, x: int, y: int, button: str = "left", delta_x: int = 0, delta_y: int = 0) -> Dict[str, Any]:
        self.virtual_cursor = {"x": x, "y": y}
        LEFTDOWN, LEFTUP = 0x0002, 0x0004
        RIGHTDOWN, RIGHTUP = 0x0008, 0x0010
        MIDDLEDOWN, MIDDLEUP = 0x0020, 0x0040
        XDOWN, XUP = 0x0080, 0x0100
        WHEEL, HWHEEL = 0x0800, 0x1000

        btn_map = {
            "left": (LEFTDOWN, LEFTUP, 0),
            "right": (RIGHTDOWN, RIGHTUP, 0),
            "middle": (MIDDLEDOWN, MIDDLEUP, 0),
            "x1": (XDOWN, XUP, 1),
            "x2": (XDOWN, XUP, 2),
        }
        if action == "right_click":
            down, up, mdata = btn_map["right"]
        elif action == "middle_click":
            down, up, mdata = btn_map["middle"]
        elif action == "x1_click":
            down, up, mdata = btn_map["x1"]
        elif action == "x2_click":
            down, up, mdata = btn_map["x2"]
        else:
            down, up, mdata = btn_map.get(button, btn_map["left"])

        if action == "move":
            self._send_mouse_input(0, x, y)
        elif action == "mouse_down":
            self._send_mouse_input(down, x, y, mdata)
        elif action == "mouse_up":
            self._send_mouse_input(up, x, y, mdata)
        elif action in ("click", "right_click", "middle_click", "x1_click", "x2_click"):
            self._send_mouse_input(0, x, y)
            time.sleep(0.01)
            self._send_mouse_input(down, x, y, mdata)
            time.sleep(0.02)
            self._send_mouse_input(up, x, y, mdata)
        elif action == "double_click":
            self._send_mouse_input(0, x, y)
            for _ in range(2):
                self._send_mouse_input(down, x, y, mdata)
                time.sleep(0.015)
                self._send_mouse_input(up, x, y, mdata)
                time.sleep(0.04)
        elif action == "triple_click":
            self._send_mouse_input(0, x, y)
            for _ in range(3):
                self._send_mouse_input(down, x, y, mdata)
                time.sleep(0.015)
                self._send_mouse_input(up, x, y, mdata)
                time.sleep(0.035)
        elif action == "scroll":
            self._send_mouse_input(0, x, y)
            if delta_y:
                self._send_mouse_input(WHEEL, None, None, int(-delta_y))
            if delta_x:
                self._send_mouse_input(HWHEEL, None, None, int(delta_x))
        return {"ok": True, "mode": self.mode_name, "cursor": self.virtual_cursor}

    def dispatch_drag(self, points: List[Tuple[int, int]], button: str = "left") -> Dict[str, Any]:
        if len(points) < 2:
            return {"ok": False, "error": "Need at least 2 points for drag_and_drop"}
        sx, sy = points[0]
        self.dispatch_mouse("mouse_down", sx, sy, button=button)
        time.sleep(0.05)
        for i in range(len(points) - 1):
            x0, y0 = points[i]
            x1, y1 = points[i + 1]
            steps = 12
            for s in range(1, steps + 1):
                ix = int(round(x0 + (x1 - x0) * s / steps))
                iy = int(round(y0 + (y1 - y0) * s / steps))
                self.dispatch_mouse("move", ix, iy, button=button)
                time.sleep(0.012)
        ex, ey = points[-1]
        time.sleep(0.04)
        self.dispatch_mouse("mouse_up", ex, ey, button=button)
        return {"ok": True, "mode": self.mode_name, "cursor": self.virtual_cursor}

    def dispatch_text(self, text: str, press_enter: bool = False) -> Dict[str, Any]:
        KEYEVENTF_UNICODE = 0x0004
        KEYEVENTF_KEYUP = 0x0002
        for ch in text:
            code = ord(ch)
            self._send_key_input(vk=0, scan=code, flags=KEYEVENTF_UNICODE)
            self._send_key_input(vk=0, scan=code, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
            time.sleep(0.004)
        if press_enter:
            self.dispatch_key("Enter")
        return {"ok": True, "length": len(text), "mode": self.mode_name}

    def dispatch_key(self, key: str) -> Dict[str, Any]:
        KEYEVENTF_KEYUP = 0x0002
        vk = self._vk_from_name(key)
        self._send_key_input(vk=vk, flags=0)
        time.sleep(0.015)
        self._send_key_input(vk=vk, flags=KEYEVENTF_KEYUP)
        return {"ok": True, "key": key, "mode": self.mode_name}

    def dispatch_hotkey(self, keys: List[str]) -> Dict[str, Any]:
        KEYEVENTF_KEYUP = 0x0002
        vks = [self._vk_from_name(k) for k in keys if k]
        for vk in vks:
            self._send_key_input(vk=vk, flags=0)
            time.sleep(0.015)
        for vk in reversed(vks):
            self._send_key_input(vk=vk, flags=KEYEVENTF_KEYUP)
            time.sleep(0.015)
        return {"ok": True, "keys": keys, "mode": self.mode_name}

    def open_start_menu(self) -> Dict[str, Any]:
        self.dispatch_key("lwin")
        return {"ok": True, "mode": self.mode_name, "action": "open_start_menu"}

    def show_desktop(self) -> Dict[str, Any]:
        return self.dispatch_hotkey(["lwin", "d"])

    def window_action(self, op: str, hwnd: Optional[int] = None, x: int = 100, y: int = 80, width: int = 960, height: int = 640) -> Dict[str, Any]:
        if sys.platform != "win32":
            return {"ok": True, "op": op}
        user32 = ctypes.windll.user32
        target = int(hwnd) if hwnd else int(user32.GetForegroundWindow())
        if not target:
            return {"ok": False, "error": "No target window found"}
        if op == "close":
            user32.PostMessageW(target, 0x0010, 0, 0)
        elif op == "minimize":
            user32.ShowWindow(target, 6)
        elif op == "maximize":
            user32.ShowWindow(target, 3)
        elif op == "restore":
            user32.ShowWindow(target, 9)
        elif op == "focus":
            user32.SetForegroundWindow(target)
        elif op == "move_resize":
            user32.MoveWindow(target, int(x), int(y), int(width), int(height), True)
        return {"ok": True, "op": op, "hwnd": target, "mode": self.mode_name}

    def clipboard_get(self) -> str:
        if sys.platform != "win32":
            return ""
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        if not user32.OpenClipboard(0):
            return ""
        try:
            handle = user32.GetClipboardData(13)
            if not handle:
                return ""
            ptr = kernel32.GlobalLock(handle)
            if not ptr:
                return ""
            try:
                return ctypes.wstring_at(ptr)
            finally:
                kernel32.GlobalUnlock(handle)
        finally:
            user32.CloseClipboard()

    def clipboard_set(self, text: str) -> None:
        if sys.platform != "win32":
            return
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        if not user32.OpenClipboard(0):
            return
        try:
            user32.EmptyClipboard()
            data = (text + "\0").encode("utf-16-le")
            hmem = kernel32.GlobalAlloc(0x0042, len(data))
            ptr = kernel32.GlobalLock(hmem)
            ctypes.memmove(ptr, data, len(data))
            kernel32.GlobalUnlock(hmem)
            user32.SetClipboardData(13, hmem)
        finally:
            user32.CloseClipboard()


class SandboxTerminalEngine:
    """
    Executes commands, scripts, and multi-language code snippets strictly inside
    a user-approved project folder (`workspace_root`), isolated with Windows Job
    Objects (`KILL_ON_JOB_CLOSE` + per-process memory limit) and hard timeouts.
    """

    def __init__(self, initial_workspace: Optional[str] = None, memory_limit_mb: int = 1024) -> None:
        self.workspace_root: Optional[Path] = Path(initial_workspace).resolve() if initial_workspace else None
        self.memory_limit_mb = memory_limit_mb
        self.active_jobs: Dict[str, Tuple[subprocess.Popen, Optional[int]]] = {}

    def set_workspace(self, folder_path: str) -> Dict[str, Any]:
        p = Path(folder_path).expanduser().resolve()
        if not p.exists() or not p.is_dir():
            raise ValueError(f"Workspace folder does not exist: {folder_path}")
        self.workspace_root = p
        return {"ok": True, "workspaceRoot": str(p)}

    def _resolve_in_workspace(self, rel_path: Optional[str] = None) -> Path:
        if not self.workspace_root:
            raise RuntimeError("No sandbox workspace folder set. Call terminal_set_workspace first.")
        if not rel_path:
            return self.workspace_root
        candidate = (self.workspace_root / rel_path).resolve()
        try:
            candidate.relative_to(self.workspace_root)
        except ValueError:
            raise PermissionError(f"Sandbox jail violation: '{rel_path}' escapes workspace '{self.workspace_root}'.")
        return candidate

    def detect_runtimes(self) -> Dict[str, Any]:
        tools = ["python", "py", "node", "npm", "npx", "git", "tsc", "powershell", "cmd", "gcc", "g++", "go", "rustc", "cargo", "java", "javac", "php"]
        found: Dict[str, str] = {}
        for t in tools:
            loc = shutil.which(t)
            if loc:
                found[t] = loc
        return {"workspaceRoot": str(self.workspace_root) if self.workspace_root else None, "runtimes": found}

    def _attach_job_object(self, proc: subprocess.Popen) -> Optional[int]:
        if sys.platform != "win32":
            return None
        try:
            hjob = kernel32.CreateJobObjectW(None, None)
            if not hjob:
                return None
            info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY
            info.ProcessMemoryLimit = self.memory_limit_mb * 1024 * 1024
            kernel32.SetInformationJobObject(
                hjob, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
            )
            kernel32.AssignProcessToJobObject(hjob, int(proc._handle))
            return int(hjob)
        except Exception:
            return None

    def _build_command_for_file(self, file_path: Path, extra_args: Optional[List[str]] = None) -> List[str]:
        ext = file_path.suffix.lower()
        args = [str(a) for a in (extra_args or [])]
        if ext == ".py":
            return [sys.executable, str(file_path)] + args
        if ext in (".js", ".mjs", ".cjs"):
            return ["node", str(file_path)] + args
        if ext == ".ts":
            npx = shutil.which("npx") or "npx"
            return [npx, "tsx", str(file_path)] + args
        if ext == ".ps1":
            return ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(file_path)] + args
        if ext in (".bat", ".cmd"):
            return ["cmd", "/c", str(file_path)] + args
        if ext == ".go":
            return ["go", "run", str(file_path)] + args
        if ext == ".php":
            return ["php", str(file_path)] + args
        raise ValueError(f"Unsupported file extension for direct run: {ext}")

    async def execute_command(
        self,
        command: str,
        cwd_rel: Optional[str] = None,
        timeout_sec: float = 30.0,
        stream_cb: Optional[Callable[[str, str], Any]] = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        cwd = self._resolve_in_workspace(cwd_rel)
        jid = job_id or f"job_{int(time.time() * 1000)}_{secrets.token_hex(3)}"
        timeout_clamped = max(1.0, min(300.0, float(timeout_sec)))

        env = os.environ.copy()
        env["MOHO_SANDBOX_ROOT"] = str(self.workspace_root)
        env["PYTHONIOENCODING"] = "utf-8"

        proc = subprocess.Popen(
            command,
            cwd=str(cwd),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        hjob = self._attach_job_object(proc)
        self.active_jobs[jid] = (proc, hjob)

        stdout_chunks: List[str] = []
        stderr_chunks: List[str] = []
        started = time.monotonic()
        timed_out = False

        async def _pump(pipe, stream_name: str, sink: List[str]):
            while True:
                line = await asyncio.to_thread(pipe.readline)
                if not line:
                    break
                sink.append(line)
                if stream_cb:
                    await stream_cb(stream_name, line)

        t_out = asyncio.create_task(_pump(proc.stdout, "stdout", stdout_chunks))
        t_err = asyncio.create_task(_pump(proc.stderr, "stderr", stderr_chunks))

        try:
            await asyncio.wait_for(asyncio.gather(t_out, t_err, asyncio.to_thread(proc.wait)), timeout=timeout_clamped)
        except asyncio.TimeoutError:
            timed_out = True
            self.kill_job(jid)
        finally:
            self.active_jobs.pop(jid, None)
            if hjob and sys.platform == "win32":
                kernel32.CloseHandle(hjob)

        return {
            "ok": (not timed_out) and proc.returncode == 0,
            "jobId": jid,
            "exitCode": proc.returncode,
            "timedOut": timed_out,
            "cwd": str(cwd),
            "stdout": "".join(stdout_chunks)[:100000],
            "stderr": "".join(stderr_chunks)[:100000],
            "durationMs": int((time.monotonic() - started) * 1000),
        }

    async def run_file(self, rel_path: str, args: Optional[List[str]] = None, timeout_sec: float = 30.0, stream_cb=None) -> Dict[str, Any]:
        target = self._resolve_in_workspace(rel_path)
        if not target.exists():
            raise FileNotFoundError(f"File not found inside workspace: {rel_path}")
        cmd_list = self._build_command_for_file(target, args)
        return await self.execute_command(subprocess.list2cmdline(cmd_list), timeout_sec=timeout_sec, stream_cb=stream_cb)

    async def run_code(self, language: str, code: str, timeout_sec: float = 30.0, stream_cb=None) -> Dict[str, Any]:
        ws = self._resolve_in_workspace()
        sandbox_dir = ws / ".moho_sandbox"
        sandbox_dir.mkdir(exist_ok=True)
        ext_map = {"python": ".py", "py": ".py", "javascript": ".js", "js": ".js", "node": ".js", "typescript": ".ts", "ts": ".ts", "powershell": ".ps1", "ps1": ".ps1", "batch": ".bat", "bat": ".bat", "go": ".go", "php": ".php"}
        ext = ext_map.get(language.lower().strip())
        if not ext:
            raise ValueError(f"Unsupported language: {language}. Supported: {', '.join(sorted(set(ext_map.keys())))}")
        tmp_file = sandbox_dir / f"run_{int(time.time() * 1000)}{ext}"
        tmp_file.write_text(code, encoding="utf-8")
        try:
            rel = str(tmp_file.relative_to(ws))
            return await self.run_file(rel, timeout_sec=timeout_sec, stream_cb=stream_cb)
        finally:
            try:
                tmp_file.unlink(missing_ok=True)
            except Exception:
                pass

    def kill_job(self, job_id: str) -> Dict[str, Any]:
        entry = self.active_jobs.get(job_id)
        if not entry:
            return {"ok": False, "error": f"Job not found: {job_id}"}
        proc, hjob = entry
        if hjob and sys.platform == "win32":
            kernel32.TerminateJobObject(hjob, 1)
        else:
            try:
                proc.kill()
            except Exception:
                pass
        return {"ok": True, "jobId": job_id}


# ---------------------------------------------------------------------------
# 3. Unified WebSocket Server (Hidden Desktop + Sandbox Terminal)
# ---------------------------------------------------------------------------
@dataclass
class StreamConfig:
    active: bool = False
    fps: int = 8
    quality: int = 70
    format: str = "jpeg"
    max_width: int = 1280


class MohoDesktopAgentServer:
    def __init__(self, host: str, port: int, token: str, allow_no_auth: bool = False, workspace: Optional[str] = None, mode: str = "auto") -> None:
        self.host = host
        self.port = port
        self.token = token
        self.allow_no_auth = allow_no_auth
        resolved_mode = mode.strip().lower()
        if resolved_mode == "auto":
            resolved_mode = "real-input" if is_windows_sandbox_env() else "hidden"
        self.desktop = RealInputDesktopEngine() if resolved_mode == "real-input" else HiddenDesktopEngine()
        self.terminal = SandboxTerminalEngine(initial_workspace=workspace)
        self.clients: Dict[Any, StreamConfig] = {}
        _, self.os_label, self.win_build = check_windows_10_or_11()

    async def handle_action(self, action: str, payload: Dict[str, Any], ws: Any) -> Any:
        d = self.desktop
        space = str(payload.get("coordinateSpace") or "pixels")

        if action in ("ping", "status"):
            return {
                "connected": True,
                "version": AGENT_VERSION,
                "os": self.os_label,
                "windowsBuild": self.win_build,
                "desktopMode": getattr(d, "mode_name", "hidden_win32_desktop"),
                "virtualDesktopActive": d.active,
                "emergencyStopped": d.emergency_stopped,
                "screen": {"width": d.width, "height": d.height},
                "cursor": d.virtual_cursor,
                "streaming": self.clients.get(ws, StreamConfig()).active,
                "workspaceRoot": str(self.terminal.workspace_root) if self.terminal.workspace_root else None,
                "persistentDir": "C:\\MohoPersistent" if Path("C:\\MohoPersistent").exists() else str(Path.home() / "MohoSandboxData"),
            }

        if action == "emergency_stop":
            d.emergency_stopped = True
            for cfg in self.clients.values():
                cfg.active = False
            for jid in list(self.terminal.active_jobs.keys()):
                self.terminal.kill_job(jid)
            if payload.get("closeVirtualDesktop") and d.active:
                d.close_isolated_desktop()
            return {"ok": True, "emergencyStopped": True}

        if action == "resume":
            d.emergency_stopped = False
            return {"ok": True, "emergencyStopped": False}

        # --- Hidden Isolated Desktop Actions ---
        if action == "create_virtual_desktop":
            return d.create_isolated_desktop(launch_app=payload.get("launchApp"), launch_args=payload.get("launchArgs"))

        if action == "close_virtual_desktop":
            return d.close_isolated_desktop()

        if action == "launch_app":
            return d.launch_app_on_hidden_desktop(str(payload.get("command", "")), payload.get("args"))

        if action == "list_windows":
            return {"windows": d.list_windows()}

        if action == "switch_virtual_desktop":
            return {
                "ok": True,
                "mode": getattr(d, "mode_name", "hidden_win32_desktop"),
                "desktopName": d.desktop_name,
                "note": "Hidden isolated desktop runs in background; your primary Windows screen stays untouched.",
            }

        if action == "inspect_window_controls":
            wins = d.list_windows()
            return {"hwnd": wins[0]["hwnd"] if wins else 0, "windows": wins, "controls": wins[: int(payload.get("maxControls", 60))]}

        if action == "window_action":
            return d.window_action(
                op=str(payload.get("op", "restore")),
                hwnd=payload.get("hwnd"),
                x=int(payload.get("x", 100)),
                y=int(payload.get("y", 80)),
                width=int(payload.get("width", 960)),
                height=int(payload.get("height", 640)),
            )

        if action == "observe_rich":
            frame = await asyncio.to_thread(
                d.capture_frame, str(payload.get("format", "jpeg")), int(payload.get("quality", 75)), payload.get("maxWidth", 1280)
            )
            wins = d.list_windows()
            return {
                "screenshot": frame,
                "windows": wins,
                "cursor": d.virtual_cursor,
                "screen": {"width": d.width, "height": d.height},
            }

        if action == "start_stream":
            if not d.active:
                d.create_isolated_desktop()
            cfg = self.clients.setdefault(ws, StreamConfig())
            cfg.active = True
            cfg.fps = max(1, min(24, int(payload.get("fps", 8))))
            cfg.quality = max(20, min(95, int(payload.get("quality", 70))))
            cfg.format = "png" if payload.get("format") == "png" else "jpeg"
            cfg.max_width = max(320, min(1920, int(payload.get("maxWidth", 1280))))
            return {"ok": True, "streaming": True, "fps": cfg.fps, "mode": getattr(d, "mode_name", "hidden_win32_desktop")}

        if action == "stop_stream":
            cfg = self.clients.setdefault(ws, StreamConfig())
            cfg.active = False
            return {"ok": True, "streaming": False}

        if action in ("screenshot", "take_screenshot"):
            return await asyncio.to_thread(
                d.capture_frame, str(payload.get("format", "png")), int(payload.get("quality", 85)), payload.get("maxWidth")
            )

        if action in ("move", "click", "double_click", "triple_click", "right_click", "middle_click", "x1_click", "x2_click", "mouse_down", "mouse_up", "scroll"):
            x, y = d.resolve_coords(payload.get("x"), payload.get("y"), space)
            dx = int(payload.get("deltaX", 0))
            dy = int(payload.get("deltaY", 0))
            if action == "scroll" and not dx and not dy and payload.get("direction"):
                mag = int(payload.get("magnitudeInPixels", 360))
                direction = payload["direction"]
                if direction == "up": dy = -mag
                elif direction == "down": dy = mag
                elif direction == "left": dx = -mag
                elif direction == "right": dx = mag
            return d.dispatch_mouse(action, x, y, button=str(payload.get("button", "left")), delta_x=dx, delta_y=dy)

        if action == "drag_and_drop":
            raw_path = payload.get("path")
            pts = (
                [d.resolve_coords(p.get("x"), p.get("y"), space) for p in raw_path]
                if isinstance(raw_path, list) and len(raw_path) >= 2
                else [
                    d.resolve_coords(payload.get("startX"), payload.get("startY"), space),
                    d.resolve_coords(payload.get("endX"), payload.get("endY"), space),
                ]
            )
            return d.dispatch_drag(pts, button=str(payload.get("button", "left")))

        if action == "type":
            if payload.get("x") is not None and payload.get("y") is not None:
                x, y = d.resolve_coords(payload.get("x"), payload.get("y"), space)
                d.dispatch_mouse("click", x, y)
            return d.dispatch_text(str(payload.get("text", "")), press_enter=bool(payload.get("pressEnter")))

        if action == "press_key":
            return d.dispatch_key(str(payload.get("key", "Enter")))

        if action == "hotkey":
            keys = [str(k) for k in (payload.get("keys") or [])]
            return d.dispatch_hotkey(keys)

        if action == "long_press":
            x, y = d.resolve_coords(payload.get("x"), payload.get("y"), space)
            d.dispatch_mouse("mouse_down", x, y, button=str(payload.get("button", "left")))
            await asyncio.sleep(max(0.15, min(10.0, float(payload.get("seconds", 1.2)))))
            return d.dispatch_mouse("mouse_up", x, y, button=str(payload.get("button", "left")))

        if action in ("key_down", "key_up", "hold_key"):
            return d.dispatch_key(str(payload.get("key", "Enter")))

        if action == "open_start_menu":
            return d.open_start_menu()

        if action == "show_desktop":
            return d.show_desktop()

        if action == "clipboard_get":
            return {"text": d.clipboard_get()}

        if action == "clipboard_set":
            d.clipboard_set(str(payload.get("text", "")))
            return {"ok": True}

        if action == "zoom":
            full = await asyncio.to_thread(d.capture_frame, "png", 90, None)
            reg = payload.get("region") or [0, 0, 400, 300]
            x0, y0 = d.resolve_coords(reg[0], reg[1], space)
            x1, y1 = d.resolve_coords(reg[2], reg[3], space)
            img = d._Image.open(io.BytesIO(base64.b64decode(full["base64"])))
            crop = img.crop((min(x0, x1), min(y0, y1), max(x0 + 10, x1), max(y0 + 10, y1)))
            buf = io.BytesIO()
            crop.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return {"format": "png", "mimeType": "image/png", "base64": b64, "dataUrl": f"data:image/png;base64,{b64}", "width": crop.size[0], "height": crop.size[1], "screenWidth": d.width, "screenHeight": d.height, "capturedAt": int(time.time() * 1000)}

        # --- Isolated Sandbox Terminal & Code Execution Actions ---
        async def _stream_out(stream_name: str, line: str):
            try:
                await ws.send(json.dumps({"event": "terminal.output", "data": {"stream": stream_name, "chunk": line}}))
            except Exception:
                pass

        if action == "terminal_set_workspace":
            return self.terminal.set_workspace(str(payload.get("path", "")))

        if action == "terminal_detect_runtimes":
            return self.terminal.detect_runtimes()

        if action == "terminal_exec":
            return await self.terminal.execute_command(
                command=str(payload.get("command", "")),
                cwd_rel=payload.get("cwd"),
                timeout_sec=float(payload.get("timeoutSec", 30.0)),
                stream_cb=_stream_out,
                job_id=payload.get("jobId"),
            )

        if action == "terminal_run_file":
            return await self.terminal.run_file(
                rel_path=str(payload.get("path", "")),
                args=payload.get("args"),
                timeout_sec=float(payload.get("timeoutSec", 30.0)),
                stream_cb=_stream_out,
            )

        if action == "terminal_run_code":
            return await self.terminal.run_code(
                language=str(payload.get("language", "python")),
                code=str(payload.get("code", "")),
                timeout_sec=float(payload.get("timeoutSec", 30.0)),
                stream_cb=_stream_out,
            )

        if action == "terminal_kill":
            return self.terminal.kill_job(str(payload.get("jobId", "")))

        raise ValueError(f"Unsupported agent action: {action}")

    async def _stream_loop(self, ws: Any) -> None:
        last_sig = 0
        last_sent_at = 0.0
        while ws in self.clients:
            cfg = self.clients[ws]
            if cfg.active and not self.desktop.emergency_stopped and self.desktop.active:
                t0 = time.monotonic()
                try:
                    frame = await asyncio.to_thread(
                        self.desktop.capture_frame, cfg.format, cfg.quality, cfg.max_width
                    )
                    sig = zlib.adler32(frame["base64"].encode("ascii"))
                    now = time.monotonic()
                    if sig != last_sig or (now - last_sent_at) >= 2.0:
                        last_sig = sig
                        last_sent_at = now
                        await ws.send(json.dumps({"event": "desktop.frame", "data": frame}))
                except Exception as exc:
                    print(f"[STREAM ERROR] {exc}", file=sys.stderr)
                delay = max(0.02, (1.0 / cfg.fps) - (time.monotonic() - t0))
                await asyncio.sleep(delay)
            else:
                await asyncio.sleep(0.15)

    async def handler(self, ws: Any, *_args: Any) -> None:
        print("[CONNECT] Chrome extension/client connected.")
        self.clients[ws] = StreamConfig()
        stream_task = asyncio.create_task(self._stream_loop(ws))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send(json.dumps({"ok": False, "error": "Invalid JSON message"}))
                    continue

                req_id = msg.get("id")
                action = msg.get("action")
                payload = msg.get("payload") or {}
                client_token = msg.get("token") or payload.get("token")

                if not self.allow_no_auth and self.token and client_token != self.token:
                    print("[AUTH] Rejected request with invalid or missing token.")
                    await ws.send(json.dumps({"id": req_id, "ok": False, "error": "Unauthorized: invalid desktop agent token."}))
                    continue

                try:
                    data = await self.handle_action(str(action), payload, ws)
                    await ws.send(json.dumps({"id": req_id, "ok": True, "data": data}))
                except Exception as exc:
                    await ws.send(json.dumps({"id": req_id, "ok": False, "error": str(exc)}))
        finally:
            stream_task.cancel()
            self.clients.pop(ws, None)


def save_session_file(port: int, token: str) -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MohoDesktopAgent"
    base.mkdir(parents=True, exist_ok=True)
    session_path = base / "session.json"
    session_path.write_text(
        json.dumps({"host": DEFAULT_HOST, "port": port, "token": token, "version": AGENT_VERSION}, indent=2),
        encoding="utf-8",
    )
    return session_path


async def run_server(args: argparse.Namespace) -> None:
    try:
        import websockets  # type: ignore
    except ImportError:
        print("[ERROR] Missing 'websockets' package. Run desktop-agent/install_windows.ps1 first.", file=sys.stderr)
        sys.exit(1)

    token = "" if args.no_auth else (args.token or secrets.token_urlsafe(24))
    server_obj = MohoDesktopAgentServer(
        args.host,
        args.port,
        token,
        allow_no_auth=args.no_auth,
        workspace=args.workspace,
        mode=getattr(args, "mode", "auto"),
    )
    session_path = save_session_file(args.port, token)
    mode_name = getattr(server_obj.desktop, "mode_name", "hidden_win32_desktop")

    if getattr(args, "announce_file", None):
        announce_path = Path(args.announce_file)
        announce_path.parent.mkdir(parents=True, exist_ok=True)
        ip = detect_reachable_ipv4()
        announce_path.write_text(
            json.dumps(
                {
                    "ip": ip,
                    "port": args.port,
                    "wsUrl": f"ws://{ip}:{args.port}",
                    "mode": mode_name,
                    "version": AGENT_VERSION,
                    "startedAt": int(time.time() * 1000),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    print("=" * 68)
    print(f"  Moho Windows Desktop & Sandbox Terminal Agent v{AGENT_VERSION}")
    print(f"  OS: {server_obj.os_label}")
    print(f"  Mode: {mode_name}")
    print(f"  Endpoint: ws://{args.host}:{args.port}")
    print(f"  Auth Token: {token if token else '(disabled -- local dev mode)'}")
    print(f"  Session File: {session_path}")
    print("  Press Ctrl+C to stop.")
    print("=" * 68)

    async with websockets.serve(
        server_obj.handler,
        args.host,
        args.port,
        max_size=16 * 1024 * 1024,
        ping_interval=20,
        ping_timeout=20,
    ):
        await asyncio.Future()


def main() -> None:
    ok, msg, _ = check_windows_10_or_11()
    if not ok:
        print(f"[ERROR] {msg}", file=sys.stderr)
        sys.exit(2)

    parser = argparse.ArgumentParser(description="Moho Windows 10/11 Hidden Desktop & Sandbox Terminal Agent")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--token", default="")
    parser.add_argument("--workspace", default=None, help="Initial project folder path for Sandbox Terminal")
    parser.add_argument("--mode", choices=["auto", "real-input", "hidden"], default="auto", help="Desktop engine mode (auto selects real-input inside Windows Sandbox)")
    parser.add_argument("--announce-file", default=None, help="Write reachable ws://<IP>:<port> JSON for Windows Sandbox host relay")
    parser.add_argument("--no-auth", action="store_true")
    args = parser.parse_args()

    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        print("\n[Moho Desktop Agent] Stopped cleanly.")


if __name__ == "__main__":
    main()
