const BRIDGE_CHANNEL = "real-browser-web/v5";
const EXTENSION_VERSION = "6.1.0";
const STORAGE_KEY = "managedBrowserWorkspaces";
const DEFAULT_DESKTOP_URL = "ws://127.0.0.1:47892";

const workspaces = new Map();
const subscribers = new Set();
const attachedDebuggerTabs = new Set();
const cursorByTab = new Map();
const folderBrainByOrigin = new Map();
let restoredOnce = false;

// --- v5.0 Windows 10/11 Desktop Computer-Use Agent WebSocket Broker ---
let desktopWs = null;
let desktopEndpoint = DEFAULT_DESKTOP_URL;
let desktopToken = "";
let desktopKeepAliveTimer = null;
const desktopPending = new Map();
const diagnosticsByTab = new Map();

function stopDesktopKeepAlive() {
  if (desktopKeepAliveTimer) {
    clearInterval(desktopKeepAliveTimer);
    desktopKeepAliveTimer = null;
  }
}

function startDesktopKeepAlive() {
  stopDesktopKeepAlive();
  // Chrome MV3 WebSocket best practice: exchange a message every 20s (<30s SW idle timeout)
  desktopKeepAliveTimer = setInterval(() => {
    if (desktopWs && desktopWs.readyState === WebSocket.OPEN) {
      desktopCall("ping", {}, 5000).catch(() => {});
    } else {
      stopDesktopKeepAlive();
    }
  }, 20000);
}

function desktopConnect(url = DEFAULT_DESKTOP_URL, token = "") {
  desktopEndpoint = url || DEFAULT_DESKTOP_URL;
  desktopToken = token || "";
  if (desktopWs && desktopWs.readyState === WebSocket.OPEN) {
    return desktopCall("status");
  }
  if (desktopWs) {
    try { desktopWs.close(); } catch {}
    desktopWs = null;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(desktopEndpoint);
    ws.onopen = () => {
      desktopWs = ws;
      startDesktopKeepAlive();
      broadcastEvent({
        type: "desktop.connected",
        workspaceId: "desktop",
        payload: { endpoint: desktopEndpoint },
        timestamp: Date.now(),
      });
      desktopCall("status")
        .then((st) => {
          settled = true;
          resolve({ ...st, connected: true, endpoint: desktopEndpoint });
        })
        .catch((err) => {
          settled = true;
          try { ws.close(); } catch {}
          desktopWs = null;
          reject(err);
        });
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error(`Unable to connect to Moho Windows Desktop Agent at ${desktopEndpoint}. Start desktop-agent/start_agent.bat first.`));
      }
    };
    ws.onclose = () => {
      stopDesktopKeepAlive();
      desktopWs = null;
      for (const p of desktopPending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Windows Desktop Agent disconnected."));
      }
      desktopPending.clear();
      broadcastEvent({
        type: "desktop.disconnected",
        workspaceId: "desktop",
        timestamp: Date.now(),
      });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.event === "desktop.frame" && msg.data) {
          broadcastEvent({
            type: "desktop.frame",
            workspaceId: "desktop",
            payload: msg.data,
            timestamp: Date.now(),
          });
          return;
        }
        if (msg.event === "terminal.output" && msg.data) {
          broadcastEvent({
            type: "terminal.output",
            workspaceId: "terminal",
            payload: msg.data,
            timestamp: Date.now(),
          });
          return;
        }
        if (msg.id && desktopPending.has(msg.id)) {
          const entry = desktopPending.get(msg.id);
          desktopPending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.ok) entry.resolve(msg.data);
          else entry.reject(new Error(String(msg.error || "Desktop agent error")));
        }
      } catch {}
    };
  });
}

function desktopCall(action, payload = {}, timeoutMs = 15000) {
  if (!desktopWs || desktopWs.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Windows Desktop Agent is not connected."));
  }
  const id = `dw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      desktopPending.delete(id);
      reject(new Error(`Desktop agent action "${action}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    desktopPending.set(id, { resolve, reject, timer });
    desktopWs.send(JSON.stringify({ id, action, token: desktopToken, payload }));
  });
}

function safeOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
  } catch {}
  return null;
}

function pageOrigin(sender) {
  if (sender?.origin && (sender.origin.startsWith("http://") || sender.origin.startsWith("https://"))) {
    return sender.origin;
  }
  return safeOrigin(sender?.url || "");
}

async function persistWorkspaces() {
  try {
    await chrome.storage.session.set({
      [STORAGE_KEY]: Array.from(workspaces.values()),
    });
  } catch {}
}

async function restoreWorkspaces() {
  if (restoredOnce && workspaces.size > 0) return;
  try {
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const list = data?.[STORAGE_KEY];
    if (Array.isArray(list)) {
      for (const ws of list) {
        if (ws && ws.id) workspaces.set(ws.id, ws);
      }
    }
    restoredOnce = true;
  } catch {}
}

void restoreWorkspaces();

function broadcastEvent(event) {
  for (const tabId of subscribers) {
    chrome.tabs.sendMessage(tabId, { scope: "real-browser-event", event }).catch(() => {
      subscribers.delete(tabId);
    });
  }
  chrome.runtime.sendMessage({ scope: "real-browser-event", event }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  attachedDebuggerTabs.delete(tabId);
  cursorByTab.delete(tabId);
  subscribers.delete(tabId);
  await restoreWorkspaces();
  let changed = false;
  for (const ws of workspaces.values()) {
    if (ws.tabIds.includes(tabId)) {
      ws.tabIds = ws.tabIds.filter((id) => id !== tabId);
      if (ws.activeTabId === tabId) ws.activeTabId = ws.tabIds[0] || null;
      changed = true;
      broadcastEvent({ type: "tab.removed", workspaceId: ws.id, tabId, timestamp: Date.now() });
    }
  }
  if (changed) await persistWorkspaces();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await restoreWorkspaces();
  for (const ws of workspaces.values()) {
    if (ws.tabIds.includes(tabId) && ws.activeTabId !== tabId) {
      ws.activeTabId = tabId;
      await persistWorkspaces();
      broadcastEvent({ type: "tab.activated", workspaceId: ws.id, tabId, timestamp: Date.now() });
    }
  }
});

async function ensureDebugger(tabId) {
  if (attachedDebuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    const msg = String(err?.message || err);
    if (!msg.includes("Already attached")) throw err;
  }
  attachedDebuggerTabs.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {}
}

chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId) attachedDebuggerTabs.delete(source.tabId);
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source?.tabId;
  if (!tabId) return;
  let diag = diagnosticsByTab.get(tabId);
  if (!diag) {
    diag = { consoleErrors: [], networkErrors: [] };
    diagnosticsByTab.set(tabId, diag);
  }
  if (method === "Runtime.consoleAPICalled" && (params?.type === "error" || params?.type === "warning")) {
    const text = (params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400);
    diag.consoleErrors.push({ level: params.type, text, timestamp: Date.now() });
    if (diag.consoleErrors.length > 50) diag.consoleErrors.shift();
  } else if (method === "Runtime.exceptionThrown") {
    const text = params?.exceptionDetails?.exception?.description || params?.exceptionDetails?.text || "Uncaught exception";
    diag.consoleErrors.push({ level: "exception", text: String(text).slice(0, 400), timestamp: Date.now() });
    if (diag.consoleErrors.length > 50) diag.consoleErrors.shift();
  } else if (method === "Network.responseReceived" && params?.response?.status >= 400) {
    diag.networkErrors.push({
      url: params.response.url,
      status: params.response.status,
      statusText: params.response.statusText || "",
      timestamp: Date.now(),
    });
    if (diag.networkErrors.length > 50) diag.networkErrors.shift();
  }
});

async function enableDiagnostics(tabId) {
  await cdpSend(tabId, "Runtime.enable");
  await cdpSend(tabId, "Network.enable");
}

async function extractAriaSnapshot(tabId) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const lines = [`- document "${document.title || "Untitled"}" [url=${window.location.href}]`];
      const nodes = document.querySelectorAll(
        'h1, h2, h3, nav, main, form, a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="tab"]'
      );
      let refIdx = 0;
      const refs = [];
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "input" ? (el.type || "textbox") : tag);
        const name = (el.getAttribute("aria-label") || el.innerText || el.placeholder || el.value || "").trim().replace(/\s+/g, " ").slice(0, 80);
        const ref = `e${refIdx++}`;
        const cx = Math.round(((rect.left + rect.width / 2) / vw) * 1000);
        const cy = Math.round(((rect.top + rect.height / 2) / vh) * 1000);
        const attrs = [];
        if (el.disabled) attrs.push("disabled");
        if (typeof el.checked === "boolean" && el.checked) attrs.push("checked");
        const attrStr = attrs.length ? ` [${attrs.join(", ")}]` : "";
        lines.push(`  - ${role} "${name}" [ref=${ref}]${attrStr}`);
        refs.push({ ref, role, name, normalizedCenter: { x: Math.max(0, Math.min(999, cx)), y: Math.max(0, Math.min(999, cy)) } });
        if (refs.length >= 180) break;
      }
      return { yaml: lines.join("\n"), refs };
    },
  });
  return res?.[0]?.result || { yaml: "", refs: [] };
}

async function captureAnnotatedScreenshot(tabId) {
  const elements = await extractInteractiveElements(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [elements],
    func: (els) => {
      const existing = document.getElementById("__moho_som_overlay__");
      if (existing) existing.remove();
      const overlay = document.createElement("div");
      overlay.id = "__moho_som_overlay__";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
      for (const el of els) {
        const box = document.createElement("div");
        box.style.cssText = `position:fixed;left:${el.rect.x}px;top:${el.rect.y}px;width:${el.rect.width}px;height:${el.rect.height}px;border:2px solid #f43f5e;box-sizing:border-box;`;
        const tag = document.createElement("span");
        tag.textContent = String(el.index);
        tag.style.cssText = "position:absolute;top:-16px;left:0;background:#f43f5e;color:#fff;font:bold 11px monospace;padding:0 4px;border-radius:3px;line-height:15px;";
        box.appendChild(tag);
        overlay.appendChild(box);
      }
      document.documentElement.appendChild(overlay);
    },
  });
  try {
    const screenshot = await captureTabScreenshot(tabId, { format: "png" });
    return { screenshot, elements };
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const existing = document.getElementById("__moho_som_overlay__");
        if (existing) existing.remove();
      },
    }).catch(() => {});
  }
}

async function cdpSend(tabId, method, params = {}) {
  await ensureDebugger(tabId);
  try {
    return await chrome.debugger.sendCommand({ tabId }, method, params);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("not attached") || msg.includes("Detached")) {
      attachedDebuggerTabs.delete(tabId);
      await ensureDebugger(tabId);
      return chrome.debugger.sendCommand({ tabId }, method, params);
    }
    throw err;
  }
}

async function waitForTabComplete(tabId, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function getViewportMetrics(tabId) {
  const metrics = await cdpSend(tabId, "Page.getLayoutMetrics");
  const layout = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
  return {
    width: Math.max(1, Math.round(layout.clientWidth || 1440)),
    height: Math.max(1, Math.round(layout.clientHeight || 900)),
  };
}

function resolveCoord(val, dim, space) {
  if (typeof val !== "number") return undefined;
  if (space === "normalized_1000") {
    const clamped = Math.max(0, Math.min(999, val));
    return Math.round((clamped / 1000) * dim);
  }
  return Math.max(0, Math.min(dim - 1, Math.round(val)));
}

function modifierBitmask(modifiers = []) {
  let mask = 0;
  for (const m of modifiers) {
    const k = String(m).toLowerCase();
    if (k === "alt") mask |= 1;
    else if (k === "ctrl" || k === "control") mask |= 2;
    else if (k === "meta" || k === "super" || k === "cmd" || k === "command") mask |= 4;
    else if (k === "shift") mask |= 8;
  }
  return mask;
}

const KEY_MAP = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  return: { key: "Enter", code: "Enter", keyCode: 13 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  space: { key: " ", code: "Space", keyCode: 32 },
  " ": { key: " ", code: "Space", keyCode: 32 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  capslock: { key: "CapsLock", code: "CapsLock", keyCode: 20 },
  numlock: { key: "NumLock", code: "NumLock", keyCode: 144 },
  scrolllock: { key: "ScrollLock", code: "ScrollLock", keyCode: 145 },
  printscreen: { key: "PrintScreen", code: "PrintScreen", keyCode: 44 },
  pause: { key: "Pause", code: "Pause", keyCode: 19 },
  contextmenu: { key: "ContextMenu", code: "ContextMenu", keyCode: 93 },
  control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  ctrl: { key: "Control", code: "ControlLeft", keyCode: 17 },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  super: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  browserback: { key: "BrowserBack", code: "BrowserBack", keyCode: 166 },
  browserforward: { key: "BrowserForward", code: "BrowserForward", keyCode: 167 },
  browserrefresh: { key: "BrowserRefresh", code: "BrowserRefresh", keyCode: 168 },
  browserhome: { key: "BrowserHome", code: "BrowserHome", keyCode: 172 },
  mediaplaypause: { key: "MediaPlayPause", code: "MediaPlayPause", keyCode: 179 },
  audiovolumemute: { key: "AudioVolumeMute", code: "AudioVolumeMute", keyCode: 173 },
  audiovolumeup: { key: "AudioVolumeUp", code: "AudioVolumeUp", keyCode: 175 },
  audiovolumedown: { key: "AudioVolumeDown", code: "AudioVolumeDown", keyCode: 174 },
  "-": { key: "-", code: "Minus", keyCode: 189 },
  "=": { key: "=", code: "Equal", keyCode: 187 },
  "[": { key: "[", code: "BracketLeft", keyCode: 219 },
  "]": { key: "]", code: "BracketRight", keyCode: 221 },
  "\\": { key: "\\", code: "Backslash", keyCode: 220 },
  ";": { key: ";", code: "Semicolon", keyCode: 186 },
  "'": { key: "'", code: "Quote", keyCode: 222 },
  ",": { key: ",", code: "Comma", keyCode: 188 },
  ".": { key: ".", code: "Period", keyCode: 190 },
  "/": { key: "/", code: "Slash", keyCode: 191 },
  "`": { key: "`", code: "Backquote", keyCode: 192 },
};

for (let f = 1; f <= 12; f++) {
  KEY_MAP[`f${f}`] = { key: `F${f}`, code: `F${f}`, keyCode: 111 + f };
}
for (let n = 0; n <= 9; n++) {
  KEY_MAP[`numpad${n}`] = { key: String(n), code: `Numpad${n}`, keyCode: 96 + n };
}

function resolveKeyDef(rawKey) {
  const lower = String(rawKey || "").toLowerCase();
  if (KEY_MAP[lower]) return KEY_MAP[lower];
  if (rawKey.length === 1) {
    const upper = rawKey.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(upper) ? `Digit${upper}` : rawKey;
    return { key: rawKey, code, keyCode: upper.charCodeAt(0) };
  }
  return { key: rawKey, code: rawKey, keyCode: 0 };
}

async function dispatchKey(tabId, type, rawKey, modifiersMask = 0) {
  const def = resolveKeyDef(rawKey);
  await cdpSend(tabId, "Input.dispatchKeyEvent", {
    type,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers: modifiersMask,
  });
}

async function captureTabScreenshot(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId);
  const format = options.format === "jpeg" ? "jpeg" : "png";
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

  // Fast path: if tab is active in its dedicated window and no clip is requested, captureVisibleTab is ultra-reliable
  if (!options.clip && tab.active && typeof tab.windowId === "number") {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format,
        ...(format === "jpeg" ? { quality: options.quality || 72 } : {}),
      });
      if (dataUrl && dataUrl.startsWith("data:image/")) {
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        return {
          tabId,
          url: tab.url || "",
          title: tab.title || "",
          format,
          mimeType,
          base64,
          dataUrl,
          width: tab.width || 1280,
          height: tab.height || 800,
          devicePixelRatio: 1,
          capturedAt: Date.now(),
        };
      }
    } catch {}
  }

  const metrics = await getViewportMetrics(tabId);
  const params = {
    format,
    fromSurface: true,
    ...(format === "jpeg" && options.quality ? { quality: options.quality } : {}),
    ...(options.clip ? { clip: options.clip } : {}),
  };
  const res = await cdpSend(tabId, "Page.captureScreenshot", params);
  return {
    tabId,
    url: tab.url || "",
    title: tab.title || "",
    format,
    mimeType,
    base64: res.data,
    dataUrl: `data:${mimeType};base64,${res.data}`,
    width: options.clip ? Math.round(options.clip.width) : metrics.width,
    height: options.clip ? Math.round(options.clip.height) : metrics.height,
    devicePixelRatio: 1,
    capturedAt: Date.now(),
  };
}

async function extractInteractiveElements(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const nodes = document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
      );
      const items = [];
      let idx = 0;
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let selector;
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.getAttribute("name")) {
          selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.getAttribute("name"))}"]`;
        } else if (el.getAttribute("data-testid")) {
          selector = `[data-testid="${CSS.escape(el.getAttribute("data-testid"))}"]`;
        } else {
          const tag = el.tagName.toLowerCase();
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
            const pos = siblings.indexOf(el) + 1;
            selector = siblings.length > 1 ? `${tag}:nth-of-type(${pos})` : tag;
          } else {
            selector = tag;
          }
        }
        items.push({
          index: idx++,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          type: el.getAttribute("type") || undefined,
          id: el.id || undefined,
          name: el.getAttribute("name") || undefined,
          ariaLabel: el.getAttribute("aria-label") || undefined,
          placeholder: el.getAttribute("placeholder") || undefined,
          text: (el.innerText || el.value || "").trim().slice(0, 120),
          href: el.getAttribute("href") || undefined,
          selector,
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          normalizedCenter: {
            x: Math.max(0, Math.min(999, Math.round((cx / vw) * 1000))),
            y: Math.max(0, Math.min(999, Math.round((cy / vh) * 1000))),
          },
          disabled: Boolean(el.disabled),
          checked: typeof el.checked === "boolean" ? el.checked : undefined,
        });
        if (items.length >= 250) break;
      }
      return items;
    },
  });
  return results?.[0]?.result || [];
}

async function executeUnifiedAction(tabId, action) {
  const started = Date.now();
  const metrics = await getViewportMetrics(tabId);
  const space = action.coordinateSpace || "pixels";
  const modMask = modifierBitmask(action.modifiers);

  const getXY = (ax, ay) => {
    const prev = cursorByTab.get(tabId) || { x: Math.round(metrics.width / 2), y: Math.round(metrics.height / 2) };
    const x = ax !== undefined ? resolveCoord(ax, metrics.width, space) : prev.x;
    const y = ay !== undefined ? resolveCoord(ay, metrics.height, space) : prev.y;
    cursorByTab.set(tabId, { x, y });
    return { x, y };
  };

  let screenshot;
  let data;

  switch (action.type) {
    case "move": {
      const { x, y } = getXY(action.x, action.y);
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: modMask });
      break;
    }
    case "mouse_down":
    case "mouse_up": {
      const { x, y } = getXY(action.x, action.y);
      await cdpSend(tabId, "Input.dispatchMouseEvent", {
        type: action.type === "mouse_down" ? "mousePressed" : "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
        modifiers: modMask,
      });
      break;
    }
    case "click":
    case "double_click":
    case "triple_click":
    case "right_click":
    case "middle_click": {
      const { x, y } = getXY(action.x, action.y);
      const button =
        action.type === "right_click" ? "right" : action.type === "middle_click" ? "middle" : "left";
      const clickCount =
        action.type === "double_click" ? 2 : action.type === "triple_click" ? 3 : 1;
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: modMask });
      for (let c = 1; c <= clickCount; c++) {
        await cdpSend(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button,
          clickCount: c,
          modifiers: modMask,
        });
        await cdpSend(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button,
          clickCount: c,
          modifiers: modMask,
        });
      }
      break;
    }
    case "long_press": {
      const { x, y } = getXY(action.x, action.y);
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await new Promise((r) => setTimeout(r, Math.max(200, (action.seconds || 2) * 1000)));
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      break;
    }
    case "drag_and_drop": {
      const path = Array.isArray(action.path) && action.path.length >= 2
        ? action.path.map((p) => ({
            x: resolveCoord(p.x, metrics.width, space),
            y: resolveCoord(p.y, metrics.height, space),
          }))
        : [
            { x: resolveCoord(action.startX, metrics.width, space), y: resolveCoord(action.startY, metrics.height, space) },
            { x: resolveCoord(action.endX, metrics.width, space), y: resolveCoord(action.endY, metrics.height, space) },
          ];
      const first = path[0];
      const last = path[path.length - 1];
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: first.x, y: first.y, modifiers: modMask });
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: first.x, y: first.y, button: "left", clickCount: 1, modifiers: modMask });
      for (let i = 1; i < path.length; i++) {
        await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: path[i].x, y: path[i].y, button: "left", modifiers: modMask });
      }
      await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: last.x, y: last.y, button: "left", clickCount: 1, modifiers: modMask });
      cursorByTab.set(tabId, last);
      break;
    }
    case "type": {
      if (action.x !== undefined && action.y !== undefined) {
        const { x, y } = getXY(action.x, action.y);
        await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await cdpSend(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      }
      if (action.clearFirst) {
        await dispatchKey(tabId, "keyDown", "a", 2);
        await dispatchKey(tabId, "keyUp", "a", 2);
        await dispatchKey(tabId, "keyDown", "Backspace", 0);
        await dispatchKey(tabId, "keyUp", "Backspace", 0);
      }
      await cdpSend(tabId, "Input.insertText", { text: String(action.text || "") });
      if (action.pressEnter) {
        await dispatchKey(tabId, "keyDown", "Enter", 0);
        await dispatchKey(tabId, "keyUp", "Enter", 0);
      }
      break;
    }
    case "press_key": {
      const repeat = Math.max(1, Math.min(100, action.repeat || 1));
      for (let i = 0; i < repeat; i++) {
        await dispatchKey(tabId, "keyDown", action.key, modMask);
        await dispatchKey(tabId, "keyUp", action.key, modMask);
      }
      break;
    }
    case "key_down":
      await dispatchKey(tabId, "keyDown", action.key, modMask);
      break;
    case "key_up":
      await dispatchKey(tabId, "keyUp", action.key, modMask);
      break;
    case "hold_key": {
      await dispatchKey(tabId, "keyDown", action.key, modMask);
      await new Promise((r) => setTimeout(r, Math.max(100, (action.seconds || 1) * 1000)));
      await dispatchKey(tabId, "keyUp", action.key, modMask);
      break;
    }
    case "hotkey": {
      const keys = Array.isArray(action.keys) ? action.keys : [];
      const mods = keys.slice(0, -1);
      const mainKey = keys[keys.length - 1];
      const mask = modifierBitmask(mods);
      for (const m of mods) await dispatchKey(tabId, "keyDown", m, mask);
      if (mainKey) {
        await dispatchKey(tabId, "keyDown", mainKey, mask);
        await dispatchKey(tabId, "keyUp", mainKey, mask);
      }
      for (const m of [...mods].reverse()) await dispatchKey(tabId, "keyUp", m, 0);
      break;
    }
    case "scroll": {
      const { x, y } = getXY(action.x, action.y);
      let deltaX = action.deltaX || 0;
      let deltaY = action.deltaY || 0;
      const mag = action.magnitudeInPixels || 300;
      if (!deltaX && !deltaY) {
        if (action.direction === "up") deltaY = -mag;
        else if (action.direction === "down") deltaY = mag;
        else if (action.direction === "left") deltaX = -mag;
        else if (action.direction === "right") deltaX = mag;
      }
      await cdpSend(tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX,
        deltaY,
        modifiers: modMask,
      });
      break;
    }
    case "scroll_to": {
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [action.target, action.selector || ""],
        func: (target, selector) => {
          if (target === "top") window.scrollTo({ top: 0, behavior: "smooth" });
          else if (target === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
          else if (target === "selector" && selector) {
            const el = document.querySelector(selector);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        },
      });
      break;
    }
    case "click_selector": {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [action.selector],
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { found: false };
          el.scrollIntoView({ block: "center" });
          el.click();
          return { found: true };
        },
      });
      if (!res?.[0]?.result?.found) throw new Error(`Element not found: ${action.selector}`);
      break;
    }
    case "type_selector": {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [action.selector, action.text, Boolean(action.clearFirst)],
        func: (selector, text, clearFirst) => {
          const el = document.querySelector(selector);
          if (!el) return { found: false };
          el.focus();
          if (clearFirst && "value" in el) el.value = "";
          if ("value" in el) {
            el.value = clearFirst ? text : (el.value || "") + text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return { found: true };
        },
      });
      if (!res?.[0]?.result?.found) throw new Error(`Element not found: ${action.selector}`);
      if (action.pressEnter) {
        await dispatchKey(tabId, "keyDown", "Enter", 0);
        await dispatchKey(tabId, "keyUp", "Enter", 0);
      }
      break;
    }
    case "select_option": {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [action.selector, action.value],
        func: (selector, value) => {
          const el = document.querySelector(selector);
          if (!el) return { found: false };
          el.value = value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { found: true };
        },
      });
      if (!res?.[0]?.result?.found) throw new Error(`Select not found: ${action.selector}`);
      break;
    }
    case "find_in_page": {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [action.query],
        func: (q) => ({ matched: Boolean(window.find(q)) }),
      });
      data = res?.[0]?.result;
      break;
    }
    case "window_mode": {
      const tab = await chrome.tabs.get(tabId);
      if (action.mode) {
        await chrome.windows.update(tab.windowId, { state: action.mode });
      }
      if (typeof action.zoomFactor === "number") {
        await chrome.tabs.setZoom(tabId, action.zoomFactor);
      }
      break;
    }
    case "navigate": {
      if (!safeOrigin(action.url)) throw new Error(`Blocked invalid URL: ${action.url}`);
      await chrome.tabs.update(tabId, { url: action.url });
      await waitForTabComplete(tabId);
      break;
    }
    case "go_back":
      await chrome.tabs.goBack(tabId);
      await waitForTabComplete(tabId);
      break;
    case "go_forward":
      await chrome.tabs.goForward(tabId);
      await waitForTabComplete(tabId);
      break;
    case "reload":
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
      break;
    case "wait":
      await new Promise((r) => setTimeout(r, Math.max(0, (action.seconds || 1) * 1000)));
      break;
    case "take_screenshot":
      screenshot = await captureTabScreenshot(tabId, { format: "png" });
      break;
    case "zoom": {
      const [x0, y0, x1, y1] = action.region || [0, 0, 100, 100];
      const rx0 = resolveCoord(x0, metrics.width, space);
      const ry0 = resolveCoord(y0, metrics.height, space);
      const rx1 = resolveCoord(x1, metrics.width, space);
      const ry1 = resolveCoord(y1, metrics.height, space);
      const cx = Math.min(rx0, rx1);
      const cy = Math.min(ry0, ry1);
      const cw = Math.min(metrics.width - cx, Math.max(10, Math.abs(rx1 - rx0)));
      const ch = Math.min(metrics.height - cy, Math.max(10, Math.abs(ry1 - ry0)));
      screenshot = await captureTabScreenshot(tabId, {
        format: "png",
        clip: { x: cx, y: cy, width: cw, height: ch, scale: 1 },
      });
      break;
    }
    case "cursor_position":
      break;
  }

  const tab = await chrome.tabs.get(tabId);
  return {
    ok: true,
    actionType: action.type,
    tabId,
    url: tab.url || "",
    title: tab.title || "",
    cursorPosition: cursorByTab.get(tabId) || { x: 0, y: 0 },
    ...(screenshot ? { screenshot } : {}),
    ...(data !== undefined ? { data } : {}),
    durationMs: Date.now() - started,
  };
}

function getWorkspaceForOrigin(origin, workspaceId) {
  if (workspaceId && workspaces.has(workspaceId)) {
    const ws = workspaces.get(workspaceId);
    if (ws.origin === origin) return ws;
    throw new Error("Workspace origin mismatch");
  }
  for (const ws of workspaces.values()) {
    if (ws.origin === origin) return ws;
  }
  throw new Error("Workspace not found for this origin");
}

async function handleBridgeCommand(command, sender) {
  await restoreWorkspaces();
  const origin = pageOrigin(sender);
  const payload = command.payload || {};

  switch (command.action) {
    case "status":
      return {
        installed: true,
        version: EXTENSION_VERSION,
        bridgeVersion: 5,
        channel: BRIDGE_CHANNEL,
        desktopAgentConnected: Boolean(desktopWs && desktopWs.readyState === WebSocket.OPEN),
        capabilities: [
          "workspace",
          "cdp-input",
          "cdp-auto-reattach",
          "dom-inspection",
          "window-modes",
          "print-pdf",
          "mcp-tools",
          "computer-use-gemini",
          "computer-use-anthropic",
          "computer-use-openai",
          "windows-desktop-agent",
          "windows-virtual-desktop",
          "desktop-live-stream",
          "local-folder-brain",
          "aria-snapshot",
          "set-of-mark",
          "console-network-diagnostics",
          "side-panel",
          "webmcp",
          "hidden-win32-desktop",
          "sandbox-terminal",
          "zoom-screenshot",
        ],
      };

    case "subscribe":
      if (sender?.tab?.id) subscribers.add(sender.tab.id);
      return { subscribed: true };

    case "workspaceCreate": {
      if (!origin) throw new Error("Cannot create workspace from non-HTTP(S) origin");
      const url = payload.url && safeOrigin(payload.url) ? payload.url : "https://example.com";
      let tab;
      if (payload.inNewWindow !== false) {
        const win = await chrome.windows.create({
          url,
          focused: false,
          width: 1280,
          height: 800,
          type: "normal",
        });
        tab = win.tabs && win.tabs[0];
      }
      if (!tab) {
        tab = await chrome.tabs.create({ url, active: false });
      }
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      const label = String(payload.label || "AI Workspace");
      await chrome.tabGroups.update(groupId, { title: label, color: "blue" });
      const ws = {
        id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        origin,
        groupId,
        label,
        tabIds: [tab.id],
        activeTabId: tab.id,
        agentControlEnabled: Boolean(payload.agentControlEnabled),
        createdAt: Date.now(),
      };
      workspaces.set(ws.id, ws);
      await persistWorkspaces();
      broadcastEvent({ type: "workspace.created", workspaceId: ws.id, timestamp: Date.now() });
      return ws;
    }

    case "workspaceGet": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      if (payload.includeTabs) {
        const tabs = await chrome.tabs.query({ groupId: ws.groupId });
        return {
          workspace: ws,
          tabs,
          activeTab: tabs.find((t) => t.id === ws.activeTabId) || tabs[0] || null,
        };
      }
      return ws;
    }

    case "workspaceList": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      return chrome.tabs.query({ groupId: ws.groupId });
    }

    case "workspaceOpen": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      if (!safeOrigin(payload.url)) throw new Error("Invalid HTTP(S) URL");
      const tab = await chrome.tabs.create({ url: payload.url, active: payload.active !== false });
      await chrome.tabs.group({ tabIds: [tab.id], groupId: ws.groupId });
      ws.tabIds.push(tab.id);
      if (payload.active !== false) ws.activeTabId = tab.id;
      await persistWorkspaces();
      return tab;
    }

    case "workspaceNavigate": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      if (!safeOrigin(payload.url)) throw new Error("Invalid HTTP(S) URL");
      const updated = await chrome.tabs.update(tabId, { url: payload.url });
      await waitForTabComplete(tabId);
      return updated;
    }

    case "workspaceActivate": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      ws.activeTabId = payload.tabId;
      await persistWorkspaces();
      return chrome.tabs.update(payload.tabId, { active: true });
    }

    case "workspaceReload": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
      return { ok: true };
    }

    case "workspaceBack": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      await chrome.tabs.goBack(tabId);
      await waitForTabComplete(tabId);
      return { ok: true };
    }

    case "workspaceForward": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      await chrome.tabs.goForward(tabId);
      await waitForTabComplete(tabId);
      return { ok: true };
    }

    case "workspaceRename": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      ws.label = String(payload.label || ws.label);
      await chrome.tabGroups.update(ws.groupId, { title: ws.label });
      await persistWorkspaces();
      return ws;
    }

    case "workspacePinTab": {
      getWorkspaceForOrigin(origin, payload.workspaceId);
      return chrome.tabs.update(payload.tabId, { pinned: Boolean(payload.pinned) });
    }

    case "workspaceMuteTab": {
      getWorkspaceForOrigin(origin, payload.workspaceId);
      return chrome.tabs.update(payload.tabId, { muted: Boolean(payload.muted) });
    }

    case "workspaceDuplicateTab": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const dup = await chrome.tabs.duplicate(payload.tabId);
      ws.tabIds.push(dup.id);
      await persistWorkspaces();
      return dup;
    }

    case "workspaceCloseTab": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      await chrome.tabs.remove(payload.tabId);
      ws.tabIds = ws.tabIds.filter((id) => id !== payload.tabId);
      if (ws.activeTabId === payload.tabId) ws.activeTabId = ws.tabIds[0] || null;
      await persistWorkspaces();
      return { ok: true };
    }

    case "workspaceClose": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      if (ws.tabIds.length) await chrome.tabs.remove(ws.tabIds).catch(() => {});
      workspaces.delete(ws.id);
      await persistWorkspaces();
      return { ok: true };
    }

    case "workspaceSetAgentControl": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      ws.agentControlEnabled = Boolean(payload.enabled);
      await persistWorkspaces();
      return ws;
    }

    case "workspaceScreenshot": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      return captureTabScreenshot(tabId, payload);
    }

    case "workspaceZoomScreenshot": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const metrics = await getViewportMetrics(tabId);
      const space = payload.coordinateSpace || "pixels";
      const [x0, y0, x1, y1] = payload.region || [0, 0, 100, 100];
      const rx0 = resolveCoord(x0, metrics.width, space);
      const ry0 = resolveCoord(y0, metrics.height, space);
      const rx1 = resolveCoord(x1, metrics.width, space);
      const ry1 = resolveCoord(y1, metrics.height, space);
      const cx = Math.min(rx0, rx1);
      const cy = Math.min(ry0, ry1);
      const cw = Math.min(metrics.width - cx, Math.max(10, Math.abs(rx1 - rx0)));
      const ch = Math.min(metrics.height - cy, Math.max(10, Math.abs(ry1 - ry0)));
      return captureTabScreenshot(tabId, {
        format: "png",
        clip: { x: cx, y: cy, width: cw, height: ch, scale: 1 },
      });
    }

    case "workspaceCursorPosition": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      return cursorByTab.get(tabId) || { x: 0, y: 0 };
    }

    case "workspaceInteractiveElements": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      return extractInteractiveElements(tabId);
    }

    case "workspacePageText": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          title: document.title,
          url: window.location.href,
          text: (document.body?.innerText || "").slice(0, 50000),
        }),
      });
      return res?.[0]?.result || { title: "", url: "", text: "" };
    }

    case "workspaceWindowMode": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { state: payload.mode || "normal" });
      return { ok: true, mode: payload.mode };
    }

    case "workspaceSetZoom": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      await chrome.tabs.setZoom(tabId, Number(payload.zoomFactor || 1));
      return { ok: true, zoomFactor: await chrome.tabs.getZoom(tabId) };
    }

    case "workspacePrintPdf": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const pdf = await cdpSend(tabId, "Page.printToPDF", { printBackground: true });
      return { base64: pdf.data, mimeType: "application/pdf" };
    }

    case "workspaceWaitForSelector": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const selector = String(payload.selector || "");
      const timeoutMs = Math.min(30000, Math.max(200, Number(payload.timeoutMs || 5000)));
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          args: [selector],
          func: (sel) => Boolean(document.querySelector(sel)),
        });
        if (res?.[0]?.result) return { found: true, elapsedMs: Date.now() - start };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { found: false, elapsedMs: Date.now() - start };
    }

    case "workspaceStorage": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        args: [payload.op || "get", payload.storageType || "local", payload.key || "", payload.value ?? ""],
        func: (op, storageType, key, value) => {
          const store = storageType === "session" ? window.sessionStorage : window.localStorage;
          if (op === "set") {
            store.setItem(key, String(value));
            return { ok: true };
          }
          if (op === "remove") {
            store.removeItem(key);
            return { ok: true };
          }
          if (key) return { value: store.getItem(key) };
          const all = {};
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k) all[k] = store.getItem(k);
          }
          return { items: all };
        },
      });
      return res?.[0]?.result;
    }

    case "workspaceInput": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      const inp = payload.input || {};
      if (inp.type === "text") {
        return executeUnifiedAction(tabId, { type: "type", text: inp.text || "" });
      }
      if (inp.type === "key") {
        const keyAction = inp.action === "keyDown" ? "key_down" : inp.action === "keyUp" ? "key_up" : "press_key";
        return executeUnifiedAction(tabId, { type: keyAction, key: inp.key || "", modifiers: inp.modifiers });
      }
      if (inp.type === "wheel") {
        return executeUnifiedAction(tabId, {
          type: "scroll",
          x: inp.x,
          y: inp.y,
          deltaX: inp.deltaX,
          deltaY: inp.deltaY,
          modifiers: inp.modifiers,
        });
      }
      const ptrMap = {
        move: "move",
        down: "mouse_down",
        up: "mouse_up",
        click: "click",
        dblclick: "double_click",
        tripleclick: "triple_click",
        rightclick: "right_click",
        middleclick: "middle_click",
      };
      return executeUnifiedAction(tabId, {
        type: ptrMap[inp.action] || "click",
        x: inp.x,
        y: inp.y,
        button: inp.button,
        modifiers: inp.modifiers,
      });
    }

    // --- v5.0 Windows 10/11 Desktop Agent Bridge Commands ---
    case "desktopConnect":
      return desktopConnect(payload.url, payload.token);

    case "desktopDisconnect":
      if (desktopWs) {
        try { desktopWs.close(); } catch {}
        desktopWs = null;
      }
      return { ok: true };

    case "desktopStatus":
      if (!desktopWs || desktopWs.readyState !== WebSocket.OPEN) {
        return { connected: false, endpoint: desktopEndpoint };
      }
      return desktopCall("status").then((st) => ({ ...st, connected: true, endpoint: desktopEndpoint }));

    case "desktopExecute":
      return desktopCall(String(payload.action || ""), payload.payload || {});

    case "desktopStartStream":
      return desktopCall("start_stream", payload);

    case "desktopStopStream":
      return desktopCall("stop_stream", {});

    case "desktopEmergencyStop": {
      const res = await desktopCall("emergency_stop", { closeVirtualDesktop: Boolean(payload.closeVirtualDesktop) });
      broadcastEvent({ type: "desktop.emergency_stop", workspaceId: "desktop", timestamp: Date.now() });
      return res;
    }

    case "desktopResume":
      return desktopCall("resume", {});

    case "workspaceAriaSnapshot": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      return extractAriaSnapshot(tabId);
    }

    case "workspaceAnnotatedScreenshot": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      return captureAnnotatedScreenshot(tabId);
    }

    case "workspaceDiagnostics": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      const tabId = payload.tabId || ws.activeTabId;
      await enableDiagnostics(tabId).catch(() => {});
      return diagnosticsByTab.get(tabId) || { consoleErrors: [], networkErrors: [] };
    }

    case "folderBrainSyncStatus":
      if (origin) {
        folderBrainByOrigin.set(origin, {
          connected: Boolean(payload.connected),
          folderName: payload.folderName || null,
          indexedFileCount: Number(payload.indexedFileCount || 0),
          updatedAt: Date.now(),
        });
        broadcastEvent({
          type: "folder_brain.updated",
          workspaceId: origin,
          payload: folderBrainByOrigin.get(origin),
          timestamp: Date.now(),
        });
      }
      return { ok: true };

    case "agentExecute": {
      const ws = getWorkspaceForOrigin(origin, payload.workspaceId);
      if (!ws.agentControlEnabled) {
        throw new Error(
          `Agent control is disabled for workspace "${ws.id}". Enable it first via setAgentControl(true).`
        );
      }
      const tabId = payload.tabId || ws.activeTabId;
      const res = await executeUnifiedAction(tabId, payload.action || {});
      if (payload.safetyAcknowledged) res.safetyAcknowledgement = true;
      broadcastEvent({
        type: "agent.action",
        workspaceId: ws.id,
        tabId,
        payload: { provider: payload.provider, actionType: res.actionType, intent: payload.intent },
        timestamp: Date.now(),
      });
      return res;
    }

    default:
      throw new Error(`Unsupported action: ${command.action}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope === "real-browser-bridge" && message.command) {
    handleBridgeCommand(message.command, sender)
      .then((data) =>
        sendResponse({
          channel: message.command.channel || BRIDGE_CHANNEL,
          id: message.command.id,
          ok: true,
          data,
        })
      )
      .catch((err) =>
        sendResponse({
          channel: message.command.channel || BRIDGE_CHANNEL,
          id: message.command.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    return true;
  }

  if (message?.scope === "real-browser-popup") {
    (async () => {
      await restoreWorkspaces();
      if (message.action === "ensure-site-bridge" && message.tabId) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: message.tabId },
            files: ["bridge.js"],
          });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      }
      if (message.action === "workspace-status") {
        const origin = safeOrigin(message.url || "");
        const folderBrain = origin ? (folderBrainByOrigin.get(origin) || null) : null;
        for (const ws of workspaces.values()) {
          if (ws.origin === origin) return { ok: true, workspace: ws, folderBrain };
        }
        return { ok: true, workspace: null, folderBrain };
      }
      if (message.action === "desktop-status") {
        if (!desktopWs || desktopWs.readyState !== WebSocket.OPEN) {
          return { ok: true, status: { connected: false } };
        }
        try {
          const st = await desktopCall("status");
          return { ok: true, status: { ...st, connected: true } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "desktop-connect") {
        try {
          const st = await desktopConnect(message.url || DEFAULT_DESKTOP_URL, message.token || "");
          if (message.startStream) {
            await desktopCall("start_stream", { fps: 8, quality: 68, maxWidth: 1280 }).catch(() => {});
          }
          return { ok: true, status: st };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "desktop-disconnect") {
        if (desktopWs) {
          try { desktopWs.close(); } catch {}
          desktopWs = null;
        }
        return { ok: true };
      }
      if (message.action === "desktop-new-vd") {
        try {
          const res = await desktopCall("create_virtual_desktop", {});
          return { ok: true, data: res };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "desktop-emergency-stop") {
        try {
          const res = await desktopCall("emergency_stop", { closeVirtualDesktop: false });
          return { ok: true, data: res };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "inspect-aria-active" && message.tabId) {
        try {
          const snap = await extractAriaSnapshot(message.tabId);
          return { ok: true, snapshot: snap.yaml, refs: snap.refs };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "inspect-diagnostics-active" && message.tabId) {
        try {
          await enableDiagnostics(message.tabId).catch(() => {});
          return { ok: true, diagnostics: diagnosticsByTab.get(message.tabId) || { consoleErrors: [], networkErrors: [] } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (message.action === "toggle-agent-control" && message.workspaceId) {
        const ws = workspaces.get(message.workspaceId);
        if (ws) {
          ws.agentControlEnabled = Boolean(message.enabled);
          await persistWorkspaces();
          return { ok: true, workspace: ws };
        }
        return { ok: false };
      }
      if (message.action === "close-workspace" && message.workspaceId) {
        const ws = workspaces.get(message.workspaceId);
        if (ws) {
          if (ws.tabIds.length) await chrome.tabs.remove(ws.tabIds).catch(() => {});
          workspaces.delete(ws.id);
          await persistWorkspaces();
        }
        return { ok: true };
      }
      return { ok: false };
    })().then(sendResponse);
    return true;
  }

  return false;
});
