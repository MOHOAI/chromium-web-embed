// src/protocol.ts
var BRIDGE_CHANNEL = "real-browser-web/v2";
var BRIDGE_VERSION = 2;
var TAB_ACTIONS = [
  "status",
  "subscribe",
  "workspaceCreate",
  "workspaceGet",
  "workspaceList",
  "workspaceOpen",
  "workspaceNavigate",
  "workspaceActivate",
  "workspaceReload",
  "workspaceBack",
  "workspaceForward",
  "workspaceRename",
  "workspacePinTab",
  "workspaceMuteTab",
  "workspaceDuplicateTab",
  "workspaceCloseTab",
  "workspaceClose",
  "workspaceSetAgentControl",
  "workspaceScreenshot",
  "workspaceInput",
  "agentExecute"
];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTabAction(value) {
  return typeof value === "string" && TAB_ACTIONS.includes(value);
}
function isBridgeCommand(value) {
  return isRecord(value) && value.channel === BRIDGE_CHANNEL && value.version === BRIDGE_VERSION && value.kind === "command" && typeof value.requestId === "string" && isTabAction(value.action) && (value.data === void 0 || isRecord(value.data));
}
function normalizeTabUrl(value) {
  const input = value.trim();
  if (!input) throw new TypeError("A URL is required.");
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:/i.test(input)) {
    throw new TypeError("Only HTTP and HTTPS URLs are supported.");
  }
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Only HTTP and HTTPS URLs are supported.");
  }
  return url.href;
}

// src/extension-core.ts
function toBrowserTab(tab) {
  if (!Number.isInteger(tab.id)) throw new Error("Chrome returned a tab without an identifier.");
  const id = tab.id;
  const windowId = Number.isInteger(tab.windowId) ? tab.windowId : -1;
  const index = Number.isInteger(tab.index) ? tab.index : -1;
  return {
    id,
    url: tab.url ?? tab.pendingUrl ?? "",
    title: tab.title ?? "",
    active: Boolean(tab.active),
    windowId,
    index,
    ...tab.status ? { status: tab.status } : {},
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.mutedInfo?.muted),
    audible: Boolean(tab.audible),
    ...tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}
  };
}
function createExtensionStatus(version) {
  return { available: true, version, capabilities: TAB_ACTIONS, model: "managed-workspace", privacy: "origin-isolated" };
}

// src/extension-bridge-policy.ts
function isSupportedWebAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// src/extension-bridge-activation.ts
var bridgeProbe = () => Boolean(globalThis.__realBrowserWebBridgeInstalled);
var delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function ensureSiteBridge(api, tabId, options = {}) {
  const tab = await api.tabs.get(tabId);
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (!isSupportedWebAppUrl(url)) return { supported: false, injected: false, ready: false, url, attempts: 0 };
  const attempts = Math.max(1, Math.min(5, Math.round(options.probeAttempts ?? 3)));
  const pause = Math.max(0, Math.min(1e3, Math.round(options.probeDelayMs ?? 50)));
  const probe = () => api.scripting.executeScript({ target: { tabId }, func: bridgeProbe, injectImmediately: true });
  if (await probe().then((result) => result[0]?.result === true).catch(() => false)) return { supported: true, injected: false, ready: true, url, attempts: 1 };
  await api.scripting.executeScript({ target: { tabId }, files: ["bridge.js"], injectImmediately: true });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await probe().then((result) => result[0]?.result === true).catch(() => false)) return { supported: true, injected: true, ready: true, url, attempts: attempt };
    if (attempt < attempts && pause > 0) await delay(pause);
  }
  return { supported: true, injected: true, ready: false, url, attempts };
}

// src/agent-control-policy.ts
function assertAgentControlEnabled(workspace) {
  if (!workspace.agentControlEnabled) {
    throw new Error("Agent control is disabled for this workspace. The user must enable it first.");
  }
}

// src/extension-worker.ts
var EXTENSION_VERSION = "2.2.0";
var WORKSPACES_KEY = "managedBrowserWorkspaces";
var subscribers = /* @__PURE__ */ new Map();
var attachedDebuggerTabs = /* @__PURE__ */ new Set();
var workspaces = /* @__PURE__ */ new Map();
var restored = false;
function safeOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
function pageOrigin(sender) {
  const origin = safeOrigin(sender.tab?.url ?? sender.tab?.pendingUrl);
  if (!origin) throw new Error("Managed browser commands are allowed only from an approved HTTP(S) web page.");
  return origin;
}
function workspaceId() {
  return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function label(value) {
  if (typeof value !== "string") return "\u0645\u0633\u0627\u062D\u0629 \u0645\u062A\u0635\u0641\u062D \u0627\u0644\u062A\u0637\u0628\u064A\u0642";
  const normalized = value.trim().slice(0, 60);
  return normalized || "\u0645\u0633\u0627\u062D\u0629 \u0645\u062A\u0635\u0641\u062D \u0627\u0644\u062A\u0637\u0628\u064A\u0642";
}
function numberValue(data, name, fallback) {
  const value = data[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}
function workspaceData(value) {
  if (!isRecord(value)) throw new TypeError("A managed workspace payload is required.");
  return value;
}
async function restoreWorkspaces() {
  if (restored) return;
  restored = true;
  try {
    const stored = await chrome.storage.session.get(WORKSPACES_KEY);
    const values = Array.isArray(stored?.[WORKSPACES_KEY]) ? stored[WORKSPACES_KEY] : [];
    for (const candidate of values) {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.origin !== "string" || !Array.isArray(candidate.tabIds)) continue;
      const tabIds = candidate.tabIds.filter(Number.isInteger);
      workspaces.set(candidate.id, {
        id: candidate.id,
        origin: candidate.origin,
        groupId: typeof candidate.groupId === "number" ? candidate.groupId : null,
        label: typeof candidate.label === "string" ? candidate.label : "\u0645\u0633\u0627\u062D\u0629 \u0645\u062A\u0635\u0641\u062D \u0627\u0644\u062A\u0637\u0628\u064A\u0642",
        tabIds,
        activeTabId: typeof candidate.activeTabId === "number" ? candidate.activeTabId : tabIds[0] ?? null,
        agentControlEnabled: Boolean(candidate.agentControlEnabled),
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now()
      });
    }
  } catch {
  }
}
async function persistWorkspaces() {
  try {
    await chrome.storage.session.set({ [WORKSPACES_KEY]: [...workspaces.values()] });
  } catch {
  }
}
async function cleanWorkspace(workspace) {
  const liveTabIds = [];
  for (const tabId of workspace.tabIds) {
    try {
      await chrome.tabs.get(tabId);
      liveTabIds.push(tabId);
    } catch {
      attachedDebuggerTabs.delete(tabId);
    }
  }
  workspace.tabIds = liveTabIds;
  if (!workspace.activeTabId || !liveTabIds.includes(workspace.activeTabId)) workspace.activeTabId = liveTabIds[0] ?? null;
  if (liveTabIds.length === 0) workspaces.delete(workspace.id);
  await persistWorkspaces();
  return workspace;
}
async function findWorkspace(origin, value) {
  await restoreWorkspaces();
  const requestedId = isRecord(value) && typeof value.workspaceId === "string" ? value.workspaceId : void 0;
  const candidates = [...workspaces.values()].filter((workspace2) => workspace2.origin === origin);
  const workspace = requestedId ? candidates.find((candidate) => candidate.id === requestedId) : candidates[0];
  return workspace ? cleanWorkspace(workspace) : null;
}
async function requireWorkspace(origin, data) {
  const workspace = await findWorkspace(origin, data);
  if (!workspace || workspace.tabIds.length === 0) throw new Error("No active managed workspace exists for this web application.");
  return workspace;
}
function assertOwnedTab(workspace, candidate) {
  const tabId = candidate ?? workspace.activeTabId;
  if (!Number.isInteger(tabId) || !workspace.tabIds.includes(tabId)) throw new Error("This tab is not part of the current managed workspace.");
  return tabId;
}
function matchingWorkspace(tabId) {
  return [...workspaces.values()].find((workspace) => workspace.tabIds.includes(tabId)) ?? null;
}
function response(requestId, ok, result, error) {
  return { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId, ok, ...ok ? { result } : { error } };
}
async function broadcast(workspace, event) {
  const message = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "event", event };
  await Promise.all([...subscribers.entries()].filter(([, origin]) => origin === workspace.origin).map(async ([tabId]) => {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      subscribers.delete(tabId);
    }
  }));
}
async function groupTab(tabId, title) {
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title, color: "blue", collapsed: false });
    return groupId;
  } catch {
    return null;
  }
}
async function ensureDebugger(tabId) {
  if (attachedDebuggerTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    attachedDebuggerTabs.add(tabId);
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
    }
    throw error;
  }
}
async function createWorkspace(origin, data) {
  const existing = await findWorkspace(origin);
  if (existing && existing.tabIds.length > 0) {
    const active = assertOwnedTab(existing, existing.activeTabId);
    return { workspace: existing, tab: toBrowserTab(await chrome.tabs.get(active)) };
  }
  const url = typeof data.url === "string" ? normalizeTabUrl(data.url) : "https://www.google.com/";
  const tab = await chrome.tabs.create({ url, active: true });
  const tabId = tab.id;
  if (!Number.isInteger(tabId)) throw new Error("Chrome did not create a tab identifier.");
  const workspace = {
    id: workspaceId(),
    origin,
    groupId: await groupTab(tabId, label(data.label)),
    label: label(data.label),
    tabIds: [tabId],
    activeTabId: tabId,
    agentControlEnabled: data.agentControl === true,
    createdAt: Date.now()
  };
  workspaces.set(workspace.id, workspace);
  await persistWorkspaces();
  const browserTab = toBrowserTab(tab);
  await broadcast(workspace, { type: "workspace-created", workspace, tab: browserTab });
  return { workspace, tab: browserTab };
}
async function openTab(workspace, data) {
  if (typeof data.url !== "string") throw new TypeError("A URL is required.");
  const tab = await chrome.tabs.create({ url: normalizeTabUrl(data.url), active: data.active !== false, ...workspace.groupId !== null ? { openerTabId: workspace.activeTabId ?? void 0 } : {} });
  if (!Number.isInteger(tab.id)) throw new Error("Chrome did not create a tab identifier.");
  if (workspace.groupId !== null) await chrome.tabs.group({ tabIds: [tab.id], groupId: workspace.groupId });
  workspace.tabIds.push(tab.id);
  if (data.active !== false) workspace.activeTabId = tab.id;
  await persistWorkspaces();
  const browserTab = toBrowserTab(tab);
  await broadcast(workspace, { type: "workspace-tab-opened", workspaceId: workspace.id, tab: browserTab });
  await broadcast(workspace, { type: "workspace-updated", workspace });
  return { tab: browserTab, workspace };
}
async function duplicateTab(workspace, tabId, active) {
  assertOwnedTab(workspace, tabId);
  const duplicated = await chrome.tabs.duplicate(tabId);
  if (!Number.isInteger(duplicated.id)) throw new Error("Chrome did not duplicate the managed tab.");
  if (workspace.groupId !== null) await chrome.tabs.group({ tabIds: [duplicated.id], groupId: workspace.groupId });
  if (!active) await chrome.tabs.update(duplicated.id, { active: false });
  workspace.tabIds.push(duplicated.id);
  if (active) workspace.activeTabId = duplicated.id;
  await persistWorkspaces();
  const tab = toBrowserTab(await chrome.tabs.get(duplicated.id));
  await broadcast(workspace, { type: "workspace-tab-opened", workspaceId: workspace.id, tab });
  await broadcast(workspace, { type: "workspace-updated", workspace });
  return { tab, workspace };
}
async function captureScreenshot(workspace, data) {
  const tabId = assertOwnedTab(workspace, data.tabId);
  await ensureDebugger(tabId);
  const format = data.format === "png" ? "png" : "jpeg";
  const suppliedQuality = data.quality;
  const quality = typeof suppliedQuality === "number" && Number.isFinite(suppliedQuality) ? Math.max(30, Math.min(100, Math.round(suppliedQuality))) : 78;
  const result = await chrome.debugger.sendCommand(
    { tabId },
    "Page.captureScreenshot",
    { format, ...format === "jpeg" ? { quality } : {}, fromSurface: true, optimizeForSpeed: format === "jpeg" }
  );
  if (!result || typeof result.data !== "string") throw new Error("Chrome did not return a screenshot.");
  return { tabId, dataUrl: `data:image/${format};base64,${result.data}`, capturedAt: Date.now() };
}
function modifierMask(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15 ? value : 0;
}
function virtualKeyCode(key, code) {
  const named = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Pause: 19,
    CapsLock: 20,
    Escape: 27,
    " ": 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Insert: 45,
    Delete: 46,
    Meta: 91
  };
  if (named[key] !== void 0) return named[key];
  const keyMatch = code?.match(/^Key([A-Z])$/);
  if (keyMatch) return keyMatch[1].charCodeAt(0);
  const digitMatch = code?.match(/^Digit([0-9])$/);
  if (digitMatch) return digitMatch[1].charCodeAt(0);
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  return void 0;
}
async function focusTabForInput(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.bringToFront");
  } catch {
  }
}
async function dispatchInput(workspace, data) {
  if (!isRecord(data.input)) throw new TypeError("A valid input payload is required.");
  const tabId = assertOwnedTab(workspace, data.tabId);
  await ensureDebugger(tabId);
  const input = data.input;
  if (input.kind === "pointer") {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: input.type, x: numberValue(input, "x"), y: numberValue(input, "y"), button: input.button ?? "none", clickCount: input.clickCount ?? 0 });
  } else if (input.kind === "wheel") {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseWheel", x: numberValue(input, "x"), y: numberValue(input, "y"), deltaX: numberValue(input, "deltaX", 0), deltaY: numberValue(input, "deltaY", 0) });
  } else if (input.kind === "key") {
    if (!["keyDown", "keyUp", "char"].includes(input.type) || typeof input.key !== "string" || input.key.length > 128) throw new TypeError("Invalid key input.");
    await focusTabForInput(tabId);
    const keyCode = virtualKeyCode(input.key, input.code);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: input.type,
      key: input.key,
      ...input.code ? { code: input.code } : {},
      modifiers: modifierMask(input.modifiers),
      ...typeof input.location === "number" ? { location: input.location } : {},
      ...input.type === "char" ? { text: input.key, unmodifiedText: input.key } : {},
      ...keyCode !== void 0 ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}
    });
  } else if (input.kind === "text") {
    if (typeof input.text !== "string" || input.text.length > 1e4) throw new TypeError("Text input must be at most 10000 characters.");
    await focusTabForInput(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: input.text });
  } else throw new TypeError("Unsupported input event.");
  return { ok: true };
}
async function closeTab(workspace, tabId) {
  assertOwnedTab(workspace, tabId);
  await chrome.tabs.remove(tabId);
  attachedDebuggerTabs.delete(tabId);
  workspace.tabIds = workspace.tabIds.filter((id) => id !== tabId);
  if (workspace.activeTabId === tabId) workspace.activeTabId = workspace.tabIds[0] ?? null;
  if (workspace.tabIds.length === 0) {
    workspaces.delete(workspace.id);
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-closed", workspaceId: workspace.id, reason: "The final managed tab was closed." });
    return { ok: true, workspace: null };
  }
  await persistWorkspaces();
  await broadcast(workspace, { type: "workspace-tab-removed", workspaceId: workspace.id, tabId });
  await broadcast(workspace, { type: "workspace-updated", workspace });
  return { ok: true, workspace };
}
async function closeWorkspace(workspace) {
  const ids = [...workspace.tabIds];
  workspaces.delete(workspace.id);
  await persistWorkspaces();
  for (const tabId of ids) {
    attachedDebuggerTabs.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
    }
  }
  if (ids.length) await chrome.tabs.remove(ids).catch(() => void 0);
  await broadcast(workspace, { type: "workspace-closed", workspaceId: workspace.id, reason: "The web application closed its managed workspace." });
  return { ok: true };
}
async function runAgent(workspace, operation) {
  assertAgentControlEnabled(workspace);
  if (!isRecord(operation) || typeof operation.type !== "string") throw new TypeError("A valid agent operation is required.");
  if (operation.type === "open") return openTab(workspace, { url: normalizeTabUrl(operation.url), active: operation.active ?? true });
  if (operation.type === "navigate") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { url: normalizeTabUrl(operation.url) })) };
  }
  if (operation.type === "activate") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    workspace.activeTabId = tabId;
    await persistWorkspaces();
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { active: true })) };
  }
  if (operation.type === "reload") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    await chrome.tabs.reload(tabId);
    return { ok: true };
  }
  if (operation.type === "back") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    await chrome.tabs.goBack(tabId);
    return { ok: true };
  }
  if (operation.type === "forward") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    await chrome.tabs.goForward(tabId);
    return { ok: true };
  }
  if (operation.type === "duplicate") return duplicateTab(workspace, assertOwnedTab(workspace, operation.tabId), operation.active ?? true);
  if (operation.type === "pin") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { pinned: operation.pinned })) };
  }
  if (operation.type === "mute") {
    const tabId = assertOwnedTab(workspace, operation.tabId);
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { muted: operation.muted })) };
  }
  if (operation.type === "close") return closeTab(workspace, assertOwnedTab(workspace, operation.tabId));
  if (operation.type === "screenshot") return captureScreenshot(workspace, { tabId: operation.tabId });
  if (operation.type === "input") return dispatchInput(workspace, { tabId: operation.tabId, input: operation.input });
  throw new Error("Unsupported agent operation.");
}
async function handleWorkspaceAction(origin, action, data) {
  if (action === "workspaceGet") return { workspace: await findWorkspace(origin, data) };
  const payload = workspaceData(data);
  if (action === "workspaceCreate") return createWorkspace(origin, payload);
  const workspace = await requireWorkspace(origin, payload);
  if (action === "workspaceList") {
    const tabs = [];
    for (const tabId of workspace.tabIds) {
      try {
        tabs.push(toBrowserTab(await chrome.tabs.get(tabId)));
      } catch {
      }
    }
    return { workspace, tabs };
  }
  if (action === "workspaceOpen") return openTab(workspace, payload);
  if (action === "workspaceNavigate") {
    const tabId = assertOwnedTab(workspace, payload.tabId);
    if (typeof payload.url !== "string") throw new TypeError("A URL is required.");
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { url: normalizeTabUrl(payload.url) })) };
  }
  if (action === "workspaceActivate") {
    const tabId = assertOwnedTab(workspace, payload.tabId);
    workspace.activeTabId = tabId;
    await persistWorkspaces();
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { active: true })) };
  }
  if (action === "workspaceReload") {
    await chrome.tabs.reload(assertOwnedTab(workspace, payload.tabId));
    return { ok: true };
  }
  if (action === "workspaceBack") {
    await chrome.tabs.goBack(assertOwnedTab(workspace, payload.tabId));
    return { ok: true };
  }
  if (action === "workspaceForward") {
    await chrome.tabs.goForward(assertOwnedTab(workspace, payload.tabId));
    return { ok: true };
  }
  if (action === "workspaceRename") {
    workspace.label = label(payload.label);
    if (workspace.groupId !== null) await chrome.tabGroups.update(workspace.groupId, { title: workspace.label });
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-updated", workspace });
    return { workspace };
  }
  if (action === "workspacePinTab") {
    const tabId = assertOwnedTab(workspace, payload.tabId);
    if (typeof payload.pinned !== "boolean") throw new TypeError("pinned must be a boolean.");
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { pinned: payload.pinned })) };
  }
  if (action === "workspaceMuteTab") {
    const tabId = assertOwnedTab(workspace, payload.tabId);
    if (typeof payload.muted !== "boolean") throw new TypeError("muted must be a boolean.");
    return { tab: toBrowserTab(await chrome.tabs.update(tabId, { muted: payload.muted })) };
  }
  if (action === "workspaceDuplicateTab") return duplicateTab(workspace, assertOwnedTab(workspace, payload.tabId), payload.active !== false);
  if (action === "workspaceCloseTab") return closeTab(workspace, assertOwnedTab(workspace, payload.tabId));
  if (action === "workspaceClose") return closeWorkspace(workspace);
  if (action === "workspaceSetAgentControl") {
    if (typeof payload.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
    workspace.agentControlEnabled = payload.enabled;
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-updated", workspace });
    return { workspace };
  }
  if (action === "workspaceScreenshot") return captureScreenshot(workspace, payload);
  if (action === "workspaceInput") return dispatchInput(workspace, payload);
  if (action === "agentExecute") return runAgent(workspace, payload.operation);
  throw new Error("Unsupported managed workspace action.");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isRecord(message) && message.scope === "real-browser-popup") {
    void (async () => {
      try {
        if (!Number.isInteger(message.tabId)) throw new Error("Open the extension on an HTTP(S) web application page.");
        const popupTab = await chrome.tabs.get(message.tabId);
        const origin = safeOrigin(popupTab.url ?? popupTab.pendingUrl);
        if (!origin) throw new Error("Managed workspaces are available only for regular HTTP(S) web pages.");
        const workspace = await findWorkspace(origin);
        if (message.action === "workspace-status") return { ok: true, workspace };
        if (message.action === "close-workspace") return workspace ? await closeWorkspace(workspace) : { ok: true };
        if (message.action === "ensure-site-bridge" && Number.isInteger(message.tabId)) return { ok: true, ...await ensureSiteBridge(chrome, message.tabId) };
        throw new Error("Unsupported popup action.");
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The extension could not complete the request." };
      }
    })().then(sendResponse);
    return true;
  }
  if (!isBridgeCommand(message)) return;
  void (async () => {
    try {
      const origin = pageOrigin(sender);
      if (message.action === "status") return response(message.requestId, true, { ...createExtensionStatus(EXTENSION_VERSION), model: "managed-workspace" });
      if (message.action === "subscribe") {
        const siteTabId = sender.tab?.id;
        if (!Number.isInteger(siteTabId)) throw new Error("Subscriptions are only allowed from an approved web page.");
        subscribers.set(siteTabId, origin);
        return response(message.requestId, true, { subscribed: true });
      }
      return response(message.requestId, true, await handleWorkspaceAction(origin, message.action, message.data));
    } catch (error) {
      return response(message.requestId, false, void 0, error instanceof Error ? error.message : "The extension could not complete the command.");
    }
  })().then(sendResponse);
  return true;
});
chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
  await restoreWorkspaces();
  const workspace = matchingWorkspace(tabId);
  if (workspace && Number.isInteger(tab.id)) await broadcast(workspace, { type: "workspace-tab-updated", workspaceId: workspace.id, tab: toBrowserTab(tab) });
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await restoreWorkspaces();
  const workspace = matchingWorkspace(tabId);
  if (!workspace) return;
  try {
    workspace.activeTabId = tabId;
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-tab-activated", workspaceId: workspace.id, tab: toBrowserTab(await chrome.tabs.get(tabId)) });
  } catch {
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await restoreWorkspaces();
  const workspace = matchingWorkspace(tabId);
  attachedDebuggerTabs.delete(tabId);
  if (!workspace) return;
  workspace.tabIds = workspace.tabIds.filter((id) => id !== tabId);
  if (workspace.activeTabId === tabId) workspace.activeTabId = workspace.tabIds[0] ?? null;
  if (workspace.tabIds.length === 0) {
    workspaces.delete(workspace.id);
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-closed", workspaceId: workspace.id, reason: "The final managed tab was closed." });
  } else {
    await persistWorkspaces();
    await broadcast(workspace, { type: "workspace-tab-removed", workspaceId: workspace.id, tabId });
    await broadcast(workspace, { type: "workspace-updated", workspace });
  }
});
chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source.tabId)) attachedDebuggerTabs.delete(source.tabId);
});
//# sourceMappingURL=extension-worker.js.map