#!/usr/bin/env python3
"""
Moho Desktop Computer-Use Agent (Windows 10 & Windows 11 Only)
--------------------------------------------------------------
Local loopback WebSocket bridge connecting the Moho Browser Workspace Chrome
extension (and connected AI web apps like Moho, Gemini, Claude, ChatGPT) to an
isolated Windows 10/11 Virtual Desktop with:
  - Fresh empty Windows 10/11 Virtual Desktop creation, switching, and teardown
  - Live screen preview streaming (JPEG/PNG, configurable FPS/quality/scale)
  - Full Win32 SendInput mouse & keyboard control (all click types, smooth move,
    multi-point drag-and-drop, horizontal/vertical scroll, Unicode typing, hotkeys)
  - Window listing/focusing, app launching, clipboard read/write
  - Emergency kill switch (Ctrl+Alt+Shift+Q or `emergency_stop` RPC)

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
import secrets
import subprocess
import sys
import time
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

AGENT_VERSION = "5.1.1"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 47892
MIN_WIN10_BUILD = 10240


# ---------------------------------------------------------------------------
# Strict Windows 10 / 11 OS Check
# ---------------------------------------------------------------------------
def check_windows_10_or_11() -> Tuple[bool, str, int]:
    """Verify the host OS is Windows 10 or Windows 11."""
    if sys.platform != "win32":
        return (
            False,
            f"Unsupported OS: {platform.system()}. Moho Desktop Agent supports Windows 10 and Windows 11 only.",
            0,
        )
    ver_str = platform.version()  # e.g., "10.0.22631"
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
# Win32 SendInput & Screen Structures (loaded only on win32)
# ---------------------------------------------------------------------------
if sys.platform == "win32":
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    # Enable Per-Monitor V2 DPI awareness for exact pixel coordinates
    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass

    ULONG_PTR = ctypes.c_size_t

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [
            ("uMsg", wintypes.DWORD),
            ("wParamL", wintypes.WORD),
            ("wParamH", wintypes.WORD),
        ]

    class _INPUT_UNION(ctypes.Union):
        _fields_ = [
            ("mi", MOUSEINPUT),
            ("ki", KEYBDINPUT),
            ("hi", HARDWAREINPUT),
        ]

    class INPUT(ctypes.Structure):
        _anonymous_ = ("u",)
        _fields_ = [
            ("type", wintypes.DWORD),
            ("u", _INPUT_UNION),
        ]

    INPUT_MOUSE = 0
    INPUT_KEYBOARD = 1

    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_XDOWN = 0x0080
    MOUSEEVENTF_XUP = 0x0100
    MOUSEEVENTF_WHEEL = 0x0800
    MOUSEEVENTF_HWHEEL = 0x01000
    MOUSEEVENTF_VIRTUALDESK = 0x4000
    MOUSEEVENTF_ABSOLUTE = 0x8000

    XBUTTON1 = 0x0001
    XBUTTON2 = 0x0002

    KEYEVENTF_EXTENDEDKEY = 0x0001
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004

    SM_XVIRTUALSCREEN = 76
    SM_YVIRTUALSCREEN = 77
    SM_CXVIRTUALSCREEN = 78
    SM_CYVIRTUALSCREEN = 79
    SM_CXSCREEN = 0
    SM_CYSCREEN = 1

    VK_MAP: Dict[str, int] = {
        "backspace": 0x08,
        "tab": 0x09,
        "enter": 0x0D,
        "return": 0x0D,
        "shift": 0x10,
        "ctrl": 0x11,
        "control": 0x11,
        "alt": 0x12,
        "menu": 0x12,
        "pause": 0x13,
        "capslock": 0x14,
        "escape": 0x1B,
        "esc": 0x1B,
        "space": 0x20,
        " ": 0x20,
        "pageup": 0x21,
        "pagedown": 0x22,
        "end": 0x23,
        "home": 0x24,
        "left": 0x25,
        "arrowleft": 0x25,
        "up": 0x26,
        "arrowup": 0x26,
        "right": 0x27,
        "arrowright": 0x27,
        "down": 0x28,
        "arrowdown": 0x28,
        "printscreen": 0x2C,
        "insert": 0x2D,
        "delete": 0x2E,
        "win": 0x5B,
        "lwin": 0x5B,
        "meta": 0x5B,
        "super": 0x5B,
        "cmd": 0x5B,
        "command": 0x5B,
        "rwin": 0x5C,
        "apps": 0x5D,
        "contextmenu": 0x5D,
        "numlock": 0x90,
        "scrolllock": 0x91,
        "volumemute": 0xAD,
        "audiovolumemute": 0xAD,
        "volumedown": 0xAE,
        "audiovolumedown": 0xAE,
        "volumeup": 0xAF,
        "audiovolumeup": 0xAF,
        "mediaplaypause": 0xB3,
        ";": 0xBA,
        "=": 0xBB,
        ",": 0xBC,
        "-": 0xBD,
        ".": 0xBE,
        "/": 0xBF,
        "`": 0xC0,
        "[": 0xDB,
        "\\": 0xDC,
        "]": 0xDD,
        "'": 0xDE,
    }
    for _i in range(1, 13):
        VK_MAP[f"f{_i}"] = 0x6F + _i
    for _i in range(0, 10):
        VK_MAP[str(_i)] = 0x30 + _i
        VK_MAP[f"numpad{_i}"] = 0x60 + _i
    for _c in "abcdefghijklmnopqrstuvwxyz":
        VK_MAP[_c] = ord(_c.upper())

    EXTENDED_VKS = {
        0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
        0x2D, 0x2E, 0x5B, 0x5C, 0x5D,
    }


class WindowsInputController:
    """Native Win32 SendInput controller for Windows 10 & 11."""

    def __init__(self) -> None:
        self.virtual_desktop_active = False
        self.virtual_desktop_count_created = 0
        self.emergency_stopped = False

    def get_screen_info(self) -> Dict[str, int]:
        vx = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
        vy = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
        vw = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN) or user32.GetSystemMetrics(SM_CXSCREEN)
        vh = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN) or user32.GetSystemMetrics(SM_CYSCREEN)
        pw = user32.GetSystemMetrics(SM_CXSCREEN)
        ph = user32.GetSystemMetrics(SM_CYSCREEN)
        return {
            "width": int(pw),
            "height": int(ph),
            "virtualLeft": int(vx),
            "virtualTop": int(vy),
            "virtualWidth": int(vw),
            "virtualHeight": int(vh),
        }

    def get_cursor_position(self) -> Dict[str, int]:
        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        return {"x": int(pt.x), "y": int(pt.y)}

    def resolve_coords(
        self,
        x: Optional[float],
        y: Optional[float],
        coordinate_space: str = "pixels",
    ) -> Tuple[int, int]:
        info = self.get_screen_info()
        cur = self.get_cursor_position()
        w, h = info["width"], info["height"]

        if x is None:
            rx = cur["x"]
        elif coordinate_space == "normalized_1000":
            clamped = max(0.0, min(999.0, float(x)))
            rx = int(round((clamped / 1000.0) * w))
        else:
            rx = int(round(float(x)))

        if y is None:
            ry = cur["y"]
        elif coordinate_space == "normalized_1000":
            clamped = max(0.0, min(999.0, float(y)))
            ry = int(round((clamped / 1000.0) * h))
        else:
            ry = int(round(float(y)))

        rx = max(info["virtualLeft"], min(info["virtualLeft"] + info["virtualWidth"] - 1, rx))
        ry = max(info["virtualTop"], min(info["virtualTop"] + info["virtualHeight"] - 1, ry))
        return rx, ry

    def _send_inputs(self, inputs: List[Any]) -> None:
        if self.emergency_stopped:
            raise RuntimeError("Desktop agent is halted by Emergency Kill Switch. Call resume first.")
        arr = (INPUT * len(inputs))(*inputs)
        user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))

    def _abs_mouse_coords(self, x: int, y: int) -> Tuple[int, int]:
        info = self.get_screen_info()
        vw = max(1, info["virtualWidth"] - 1)
        vh = max(1, info["virtualHeight"] - 1)
        ax = int(round(((x - info["virtualLeft"]) * 65535) / vw))
        ay = int(round(((y - info["virtualTop"]) * 65535) / vh))
        return max(0, min(65535, ax)), max(0, min(65535, ay))

    def move_mouse(self, x: int, y: int, smooth: bool = False, steps: int = 12) -> None:
        if not smooth or steps <= 1:
            ax, ay = self._abs_mouse_coords(x, y)
            inp = INPUT(
                type=INPUT_MOUSE,
                mi=MOUSEINPUT(
                    dx=ax,
                    dy=ay,
                    mouseData=0,
                    dwFlags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    time=0,
                    dwExtraInfo=0,
                ),
            )
            self._send_inputs([inp])
            return

        cur = self.get_cursor_position()
        sx, sy = cur["x"], cur["y"]
        for i in range(1, steps + 1):
            t = i / steps
            nx = int(round(sx + (x - sx) * t))
            ny = int(round(sy + (y - sy) * t))
            self.move_mouse(nx, ny, smooth=False)
            time.sleep(0.006)

    def _button_flags(self, button: str) -> Tuple[int, int, int]:
        b = (button or "left").lower()
        if b == "right":
            return MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, 0
        if b == "middle":
            return MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, 0
        if b == "x1":
            return MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, XBUTTON1
        if b == "x2":
            return MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, XBUTTON2
        return MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 0

    def mouse_down(self, x: Optional[int], y: Optional[int], button: str = "left") -> None:
        if x is not None and y is not None:
            self.move_mouse(x, y)
        down_flag, _, mouse_data = self._button_flags(button)
        inp = INPUT(
            type=INPUT_MOUSE,
            mi=MOUSEINPUT(dx=0, dy=0, mouseData=mouse_data, dwFlags=down_flag, time=0, dwExtraInfo=0),
        )
        self._send_inputs([inp])

    def mouse_up(self, x: Optional[int], y: Optional[int], button: str = "left") -> None:
        if x is not None and y is not None:
            self.move_mouse(x, y)
        _, up_flag, mouse_data = self._button_flags(button)
        inp = INPUT(
            type=INPUT_MOUSE,
            mi=MOUSEINPUT(dx=0, dy=0, mouseData=mouse_data, dwFlags=up_flag, time=0, dwExtraInfo=0),
        )
        self._send_inputs([inp])

    def _with_modifiers(self, modifiers: Optional[List[str]], fn) -> None:
        mods = [m for m in (modifiers or []) if m]
        for m in mods:
            self.key_down(m)
        try:
            fn()
        finally:
            for m in reversed(mods):
                self.key_up(m)

    def click(
        self,
        x: int,
        y: int,
        button: str = "left",
        click_count: int = 1,
        modifiers: Optional[List[str]] = None,
    ) -> None:
        def _do() -> None:
            self.move_mouse(x, y)
            time.sleep(0.015)
            for i in range(max(1, click_count)):
                self.mouse_down(None, None, button=button)
                time.sleep(0.02)
                self.mouse_up(None, None, button=button)
                if i < click_count - 1:
                    time.sleep(0.05)

        self._with_modifiers(modifiers, _do)

    def long_press(self, x: int, y: int, seconds: float = 1.5, button: str = "left") -> None:
        self.move_mouse(x, y)
        self.mouse_down(None, None, button=button)
        time.sleep(max(0.15, min(15.0, float(seconds))))
        self.mouse_up(None, None, button=button)

    def drag_and_drop(
        self,
        points: List[Tuple[int, int]],
        button: str = "left",
        steps_per_segment: int = 14,
        modifiers: Optional[List[str]] = None,
    ) -> None:
        if len(points) < 2:
            raise ValueError("drag_and_drop requires at least 2 points.")

        def _do() -> None:
            start_x, start_y = points[0]
            self.move_mouse(start_x, start_y)
            time.sleep(0.03)
            self.mouse_down(None, None, button=button)
            time.sleep(0.04)
            for i in range(1, len(points)):
                tx, ty = points[i]
                self.move_mouse(tx, ty, smooth=True, steps=max(4, steps_per_segment))
                time.sleep(0.02)
            self.mouse_up(None, None, button=button)

        self._with_modifiers(modifiers, _do)

    def scroll(
        self,
        x: Optional[int],
        y: Optional[int],
        delta_x: int = 0,
        delta_y: int = 0,
        modifiers: Optional[List[str]] = None,
    ) -> None:
        def _do() -> None:
            if x is not None and y is not None:
                self.move_mouse(x, y)
            if delta_y:
                # Positive deltaY in browser = scroll down -> Windows wheel negative
                wheel_val = int(-delta_y)
                inp = INPUT(
                    type=INPUT_MOUSE,
                    mi=MOUSEINPUT(
                        dx=0,
                        dy=0,
                        mouseData=ctypes.c_ulong(wheel_val & 0xFFFFFFFF).value,
                        dwFlags=MOUSEEVENTF_WHEEL,
                        time=0,
                        dwExtraInfo=0,
                    ),
                )
                self._send_inputs([inp])
            if delta_x:
                inp = INPUT(
                    type=INPUT_MOUSE,
                    mi=MOUSEINPUT(
                        dx=0,
                        dy=0,
                        mouseData=ctypes.c_ulong(int(delta_x) & 0xFFFFFFFF).value,
                        dwFlags=MOUSEEVENTF_HWHEEL,
                        time=0,
                        dwExtraInfo=0,
                    ),
                )
                self._send_inputs([inp])

        self._with_modifiers(modifiers, _do)

    def _resolve_vk(self, key: str) -> int:
        k = (key or "").strip().lower()
        if k in VK_MAP:
            return VK_MAP[k]
        if len(key) == 1:
            vk = user32.VkKeyScanW(ord(key)) & 0xFF
            if vk != 0xFF:
                return vk
        raise ValueError(f"Unknown Windows virtual key: {key!r}")

    def key_down(self, key: str) -> None:
        vk = self._resolve_vk(key)
        flags = KEYEVENTF_EXTENDEDKEY if vk in EXTENDED_VKS else 0
        inp = INPUT(
            type=INPUT_KEYBOARD,
            ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags, time=0, dwExtraInfo=0),
        )
        self._send_inputs([inp])

    def key_up(self, key: str) -> None:
        vk = self._resolve_vk(key)
        flags = KEYEVENTF_KEYUP | (KEYEVENTF_EXTENDEDKEY if vk in EXTENDED_VKS else 0)
        inp = INPUT(
            type=INPUT_KEYBOARD,
            ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags, time=0, dwExtraInfo=0),
        )
        self._send_inputs([inp])

    def press_key(self, key: str, repeat: int = 1, modifiers: Optional[List[str]] = None) -> None:
        def _do() -> None:
            for _ in range(max(1, min(100, repeat))):
                self.key_down(key)
                time.sleep(0.015)
                self.key_up(key)
                time.sleep(0.015)

        self._with_modifiers(modifiers, _do)

    def hold_key(self, key: str, seconds: float = 1.0, modifiers: Optional[List[str]] = None) -> None:
        def _do() -> None:
            self.key_down(key)
            time.sleep(max(0.05, min(15.0, float(seconds))))
            self.key_up(key)

        self._with_modifiers(modifiers, _do)

    def hotkey(self, keys: List[str]) -> None:
        if not keys:
            return
        for k in keys:
            self.key_down(k)
            time.sleep(0.015)
        time.sleep(0.03)
        for k in reversed(keys):
            self.key_up(k)
            time.sleep(0.015)

    def type_unicode(self, text: str) -> None:
        """Type arbitrary Unicode text (Arabic, English, symbols, etc.) via KEYEVENTF_UNICODE."""
        for ch in text:
            if ch == "\n":
                self.press_key("enter")
                continue
            if ch == "\t":
                self.press_key("tab")
                continue
            code_units = ch.encode("utf-16-le")
            for i in range(0, len(code_units), 2):
                unit = int.from_bytes(code_units[i : i + 2], "little")
                down = INPUT(
                    type=INPUT_KEYBOARD,
                    ki=KEYBDINPUT(wVk=0, wScan=unit, dwFlags=KEYEVENTF_UNICODE, time=0, dwExtraInfo=0),
                )
                up = INPUT(
                    type=INPUT_KEYBOARD,
                    ki=KEYBDINPUT(
                        wVk=0,
                        wScan=unit,
                        dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time=0,
                        dwExtraInfo=0,
                    ),
                )
                self._send_inputs([down, up])
            time.sleep(0.004)

    # --- Windows 10/11 Virtual Desktop Management ---
    def create_virtual_desktop(self) -> Dict[str, Any]:
        """Create and switch to a brand-new empty Windows 10/11 Virtual Desktop (Win+Ctrl+D)."""
        self.hotkey(["win", "ctrl", "d"])
        time.sleep(0.45)
        self.virtual_desktop_active = True
        self.virtual_desktop_count_created += 1
        return {
            "ok": True,
            "virtualDesktopActive": True,
            "createdCount": self.virtual_desktop_count_created,
            "message": "Created and switched to a new empty Windows Virtual Desktop.",
        }

    def switch_virtual_desktop(self, direction: str = "right") -> Dict[str, Any]:
        arrow = "left" if str(direction).lower() == "left" else "right"
        self.hotkey(["win", "ctrl", arrow])
        time.sleep(0.3)
        return {"ok": True, "direction": arrow}

    def close_virtual_desktop(self) -> Dict[str, Any]:
        """Close the current Windows Virtual Desktop (Win+Ctrl+F4) and return to previous desktop."""
        self.hotkey(["win", "ctrl", "f4"])
        time.sleep(0.35)
        if self.virtual_desktop_count_created > 0:
            self.virtual_desktop_count_created -= 1
        self.virtual_desktop_active = self.virtual_desktop_count_created > 0
        return {
            "ok": True,
            "virtualDesktopActive": self.virtual_desktop_active,
            "remainingCreated": self.virtual_desktop_count_created,
        }

    # --- Window & Clipboard Utilities ---
    def list_windows(self) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def callback(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if not title:
                return True
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            results.append(
                {
                    "hwnd": int(hwnd),
                    "title": title,
                    "rect": {
                        "x": int(rect.left),
                        "y": int(rect.top),
                        "width": int(rect.right - rect.left),
                        "height": int(rect.bottom - rect.top),
                    },
                }
            )
            return True

        user32.EnumWindows(EnumWindowsProc(callback), 0)
        return results[:100]

    def inspect_window_controls(self, hwnd: Optional[int] = None, max_controls: int = 120) -> Dict[str, Any]:
        """Inspect real Win32 child UI controls (buttons, edits, labels) of the foreground or given window."""
        target = hwnd or user32.GetForegroundWindow()
        if not target:
            return {"hwnd": 0, "controls": []}
        controls: List[Dict[str, Any]] = []
        EnumChildProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def cb(child_hwnd, _lparam):
            if len(controls) >= max_controls:
                return False
            if not user32.IsWindowVisible(child_hwnd):
                return True
            cls_buf = ctypes.create_unicode_buffer(128)
            user32.GetClassNameW(child_hwnd, cls_buf, 128)
            txt_len = user32.GetWindowTextLengthW(child_hwnd)
            txt_buf = ctypes.create_unicode_buffer(min(256, txt_len + 1))
            if txt_len > 0:
                user32.GetWindowTextW(child_hwnd, txt_buf, len(txt_buf))
            rect = wintypes.RECT()
            user32.GetWindowRect(child_hwnd, ctypes.byref(rect))
            w = int(rect.right - rect.left)
            h = int(rect.bottom - rect.top)
            if w <= 0 or h <= 0:
                return True
            controls.append({
                "index": len(controls),
                "hwnd": int(child_hwnd),
                "className": cls_buf.value,
                "text": txt_buf.value.strip()[:160],
                "rect": {"x": int(rect.left), "y": int(rect.top), "width": w, "height": h},
                "center": {"x": int(rect.left + w // 2), "y": int(rect.top + h // 2)},
            })
            return True

        user32.EnumChildWindows(target, EnumChildProc(cb), 0)
        return {"hwnd": int(target), "controls": controls}

    def focus_window(self, hwnd: Optional[int] = None, title_contains: Optional[str] = None) -> Dict[str, Any]:
        target_hwnd = hwnd
        if not target_hwnd and title_contains:
            needle = title_contains.lower()
            for w in self.list_windows():
                if needle in w["title"].lower():
                    target_hwnd = w["hwnd"]
                    break
        if not target_hwnd:
            return {"ok": False, "error": "Matching window not found."}
        SW_RESTORE = 9
        user32.ShowWindow(target_hwnd, SW_RESTORE)
        user32.SetForegroundWindow(target_hwnd)
        return {"ok": True, "hwnd": int(target_hwnd)}

    def launch_app(self, command: str, args: Optional[List[str]] = None) -> Dict[str, Any]:
        if not command or not command.strip():
            raise ValueError("command is required")
        cmd = [command.strip()] + [str(a) for a in (args or [])]
        proc = subprocess.Popen(cmd, shell=False)
        return {"ok": True, "pid": proc.pid, "command": cmd}

    def clipboard_get(self) -> str:
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
        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002
        data = (text + "\x00").encode("utf-16-le")
        if not user32.OpenClipboard(0):
            raise RuntimeError("Failed to open Windows clipboard.")
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
# Fast Screen Capture Engine (mss -> PIL.ImageGrab)
# ---------------------------------------------------------------------------
class ScreenCapturer:
    def __init__(self) -> None:
        try:
            import mss  # type: ignore
            self._mss_cls = getattr(mss, "MSS", mss.mss)
        except Exception:
            self._mss_cls = None

        try:
            from PIL import Image, ImageGrab  # type: ignore
            self._Image = Image
            self._ImageGrab = ImageGrab
        except Exception:
            self._Image = None
            self._ImageGrab = None

    def capture(
        self,
        fmt: str = "jpeg",
        quality: int = 72,
        max_width: Optional[int] = None,
        region: Optional[Tuple[int, int, int, int]] = None,
    ) -> Dict[str, Any]:
        if self._Image is None:
            raise RuntimeError("Pillow is required for screen capture. Run install_windows.ps1 first.")

        img = None
        if self._mss_cls is not None:
            # Create thread-local MSS context per capture to avoid Windows GDI _thread._local crash
            with self._mss_cls() as sct:
                monitor = (
                    {
                        "left": region[0],
                        "top": region[1],
                        "width": max(1, region[2] - region[0]),
                        "height": max(1, region[3] - region[1]),
                    }
                    if region
                    else sct.monitors[1]
                )
                raw = sct.grab(monitor)
                img = self._Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        elif self._ImageGrab is not None:
            img = self._ImageGrab.grab(bbox=region)
            if img.mode != "RGB":
                img = img.convert("RGB")
        else:
            raise RuntimeError("No screen capture backend available.")

        orig_w, orig_h = img.size
        if max_width and orig_w > max_width:
            ratio = max_width / float(orig_w)
            img = img.resize((int(max_width), max(1, int(orig_h * ratio))), self._Image.Resampling.BILINEAR)

        out_w, out_h = img.size
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
            "width": out_w,
            "height": out_h,
            "screenWidth": orig_w,
            "screenHeight": orig_h,
            "capturedAt": int(time.time() * 1000),
        }


# ---------------------------------------------------------------------------
# WebSocket Server & Live Streaming Hub
# ---------------------------------------------------------------------------
@dataclass
class StreamConfig:
    active: bool = False
    fps: int = 8
    quality: int = 68
    format: str = "jpeg"
    max_width: int = 1280


class MohoDesktopAgentServer:
    def __init__(self, host: str, port: int, token: str, allow_no_auth: bool = False) -> None:
        self.host = host
        self.port = port
        self.token = token
        self.allow_no_auth = allow_no_auth
        self.controller = WindowsInputController()
        self.capturer = ScreenCapturer()
        self.clients: Dict[Any, StreamConfig] = {}
        _, self.os_label, self.win_build = check_windows_10_or_11()

    async def handle_action(self, action: str, payload: Dict[str, Any], ws: Any) -> Any:
        c = self.controller
        space = str(payload.get("coordinateSpace") or "pixels")

        if action == "ping" or action == "status":
            return {
                "connected": True,
                "version": AGENT_VERSION,
                "os": self.os_label,
                "windowsBuild": self.win_build,
                "virtualDesktopActive": c.virtual_desktop_active,
                "virtualDesktopCount": c.virtual_desktop_count_created,
                "emergencyStopped": c.emergency_stopped,
                "screen": c.get_screen_info(),
                "cursor": c.get_cursor_position(),
                "streaming": self.clients.get(ws, StreamConfig()).active,
            }

        if action == "emergency_stop":
            c.emergency_stopped = True
            for cfg in self.clients.values():
                cfg.active = False
            if payload.get("closeVirtualDesktop") and c.virtual_desktop_active:
                c.emergency_stopped = False
                c.close_virtual_desktop()
                c.emergency_stopped = True
            return {"ok": True, "emergencyStopped": True}

        if action == "resume":
            c.emergency_stopped = False
            return {"ok": True, "emergencyStopped": False}

        if action == "create_virtual_desktop":
            res = c.create_virtual_desktop()
            if payload.get("launchApp"):
                c.launch_app(str(payload["launchApp"]), payload.get("launchArgs"))
            return res

        if action == "switch_virtual_desktop":
            return c.switch_virtual_desktop(str(payload.get("direction", "right")))

        if action == "close_virtual_desktop":
            return c.close_virtual_desktop()

        if action == "start_stream":
            cfg = self.clients.setdefault(ws, StreamConfig())
            cfg.active = True
            cfg.fps = max(1, min(30, int(payload.get("fps", 8))))
            cfg.quality = max(20, min(95, int(payload.get("quality", 68))))
            cfg.format = "png" if payload.get("format") == "png" else "jpeg"
            cfg.max_width = max(320, min(3840, int(payload.get("maxWidth", 1280))))
            return {
                "ok": True,
                "streaming": True,
                "fps": cfg.fps,
                "quality": cfg.quality,
                "maxWidth": cfg.max_width,
            }

        if action == "stop_stream":
            cfg = self.clients.setdefault(ws, StreamConfig())
            cfg.active = False
            return {"ok": True, "streaming": False}

        if action == "screenshot" or action == "take_screenshot":
            return self.capturer.capture(
                fmt=str(payload.get("format", "png")),
                quality=int(payload.get("quality", 85)),
                max_width=payload.get("maxWidth"),
            )

        if action == "zoom":
            reg = payload.get("region") or [0, 0, 200, 200]
            x0, y0 = c.resolve_coords(reg[0], reg[1], space)
            x1, y1 = c.resolve_coords(reg[2], reg[3], space)
            box = (min(x0, x1), min(y0, y1), max(x0 + 10, x1), max(y0 + 10, y1))
            return self.capturer.capture(fmt="png", region=box)

        if action == "cursor_position":
            return c.get_cursor_position()

        if action == "move":
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            c.move_mouse(x, y, smooth=bool(payload.get("smooth")), steps=int(payload.get("steps", 12)))
            return {"ok": True, "cursor": {"x": x, "y": y}}

        if action in ("click", "double_click", "triple_click", "right_click", "middle_click", "x1_click", "x2_click"):
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            button = payload.get("button")
            if not button:
                if action == "right_click":
                    button = "right"
                elif action == "middle_click":
                    button = "middle"
                elif action == "x1_click":
                    button = "x1"
                elif action == "x2_click":
                    button = "x2"
                else:
                    button = "left"
            count = int(payload.get("clickCount") or (2 if action == "double_click" else 3 if action == "triple_click" else 1))
            c.click(x, y, button=button, click_count=count, modifiers=payload.get("modifiers"))
            return {"ok": True, "cursor": {"x": x, "y": y}, "button": button, "clickCount": count}

        if action == "mouse_down":
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            c.mouse_down(x, y, button=str(payload.get("button", "left")))
            return {"ok": True, "cursor": {"x": x, "y": y}}

        if action == "mouse_up":
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            c.mouse_up(x, y, button=str(payload.get("button", "left")))
            return {"ok": True, "cursor": {"x": x, "y": y}}

        if action == "long_press":
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            c.long_press(x, y, seconds=float(payload.get("seconds", 1.5)), button=str(payload.get("button", "left")))
            return {"ok": True, "cursor": {"x": x, "y": y}}

        if action == "drag_and_drop":
            raw_path = payload.get("path")
            if isinstance(raw_path, list) and len(raw_path) >= 2:
                pts = [c.resolve_coords(p.get("x"), p.get("y"), space) for p in raw_path]
            else:
                pts = [
                    c.resolve_coords(payload.get("startX"), payload.get("startY"), space),
                    c.resolve_coords(payload.get("endX"), payload.get("endY"), space),
                ]
            c.drag_and_drop(
                pts,
                button=str(payload.get("button", "left")),
                steps_per_segment=int(payload.get("steps", 14)),
                modifiers=payload.get("modifiers"),
            )
            return {"ok": True, "cursor": {"x": pts[-1][0], "y": pts[-1][1]}}

        if action == "scroll":
            x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
            dx = int(payload.get("deltaX", 0))
            dy = int(payload.get("deltaY", 0))
            mag = int(payload.get("magnitudeInPixels", 360))
            direction = payload.get("direction")
            if not dx and not dy and direction:
                if direction == "up":
                    dy = -mag
                elif direction == "down":
                    dy = mag
                elif direction == "left":
                    dx = -mag
                elif direction == "right":
                    dx = mag
            c.scroll(x, y, delta_x=dx, delta_y=dy, modifiers=payload.get("modifiers"))
            return {"ok": True, "deltaX": dx, "deltaY": dy}

        if action == "type":
            if payload.get("x") is not None and payload.get("y") is not None:
                x, y = c.resolve_coords(payload.get("x"), payload.get("y"), space)
                c.click(x, y, button="left", click_count=1)
                time.sleep(0.05)
            if payload.get("clearFirst"):
                c.hotkey(["ctrl", "a"])
                c.press_key("backspace")
            c.type_unicode(str(payload.get("text", "")))
            if payload.get("pressEnter"):
                c.press_key("enter")
            return {"ok": True}

        if action == "press_key":
            c.press_key(
                str(payload.get("key", "")),
                repeat=int(payload.get("repeat", 1)),
                modifiers=payload.get("modifiers"),
            )
            return {"ok": True}

        if action == "key_down":
            c.key_down(str(payload.get("key", "")))
            return {"ok": True}

        if action == "key_up":
            c.key_up(str(payload.get("key", "")))
            return {"ok": True}

        if action == "hold_key":
            c.hold_key(
                str(payload.get("key", "")),
                seconds=float(payload.get("seconds", 1.0)),
                modifiers=payload.get("modifiers"),
            )
            return {"ok": True}

        if action == "hotkey":
            keys = [str(k) for k in (payload.get("keys") or [])]
            c.hotkey(keys)
            return {"ok": True, "keys": keys}

        if action == "wait":
            await asyncio.sleep(max(0.0, min(30.0, float(payload.get("seconds", 1.0)))))
            return {"ok": True}

        if action == "list_windows":
            return {"windows": c.list_windows()}

        if action == "inspect_window_controls":
            return c.inspect_window_controls(
                hwnd=payload.get("hwnd"),
                max_controls=int(payload.get("maxControls", 120)),
            )

        if action == "focus_window":
            return c.focus_window(hwnd=payload.get("hwnd"), title_contains=payload.get("titleContains"))

        if action == "launch_app":
            return c.launch_app(str(payload.get("command", "")), payload.get("args"))

        if action == "clipboard_get":
            return {"text": c.clipboard_get()}

        if action == "clipboard_set":
            c.clipboard_set(str(payload.get("text", "")))
            return {"ok": True}

        raise ValueError(f"Unsupported desktop action: {action}")

    async def _stream_loop(self, ws: Any) -> None:
        last_sig = 0
        last_sent_at = 0.0
        while ws in self.clients:
            cfg = self.clients[ws]
            if cfg.active and not self.controller.emergency_stopped:
                t0 = time.monotonic()
                try:
                    frame = await asyncio.to_thread(
                        self.capturer.capture,
                        cfg.format,
                        cfg.quality,
                        cfg.max_width,
                        None,
                    )
                    sig = zlib.adler32(frame["base64"].encode("ascii"))
                    now = time.monotonic()
                    # Smart Frame-Delta Skipping: send when pixels changed or every 2.0s heartbeat
                    if sig != last_sig or (now - last_sent_at) >= 2.0:
                        last_sig = sig
                        last_sent_at = now
                        await ws.send(json.dumps({"event": "desktop.frame", "data": frame}))
                except Exception as exc:
                    print(f"[STREAM ERROR] {exc}", file=sys.stderr)
                elapsed = time.monotonic() - t0
                delay = max(0.01, (1.0 / cfg.fps) - elapsed)
                await asyncio.sleep(delay)
            else:
                await asyncio.sleep(0.15)

    async def handler(self, ws: Any, *_args: Any) -> None:
        print("[CONNECT] Browser extension/client connected.")
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
                    await ws.send(
                        json.dumps(
                            {
                                "id": req_id,
                                "ok": False,
                                "error": "Unauthorized: invalid desktop agent token.",
                            }
                        )
                    )
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
    server_obj = MohoDesktopAgentServer(args.host, args.port, token, allow_no_auth=args.no_auth)
    session_path = save_session_file(args.port, token)

    print("=" * 64)
    print(f"  Moho Windows Desktop Agent v{AGENT_VERSION}")
    print(f"  OS: {server_obj.os_label}")
    print(f"  Endpoint: ws://{args.host}:{args.port}")
    print(f"  Auth Token: {token if token else '(disabled -- local dev mode)'}")
    print(f"  Session File: {session_path}")
    print("  Press Ctrl+C to stop.")
    print("=" * 64)

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

    parser = argparse.ArgumentParser(description="Moho Windows 10/11 Desktop Computer-Use Agent")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"WebSocket port (default: {DEFAULT_PORT})")
    parser.add_argument("--token", default="", help="Custom auth token (random token generated if omitted)")
    parser.add_argument("--no-auth", action="store_true", help="Disable token auth for local-only quick testing")
    args = parser.parse_args()

    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        print("\n[Moho Desktop Agent] Stopped cleanly.")


if __name__ == "__main__":
    main()
