// src/protocol.ts
var BRIDGE_CHANNEL = "real-browser-web/v1";
var BRIDGE_VERSION = 1;
var TAB_ACTIONS = [
  "status",
  "subscribe",
  "open",
  "list",
  "active",
  "navigate",
  "activate",
  "reload",
  "back",
  "forward",
  "close",
  "pin",
  "mute",
  "shared",
  "screenshot",
  "input",
  "stopShare"
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
function record(data) {
  return isRecord(data) ? data : {};
}
function tabId(data) {
  const id = record(data).tabId;
  if (!Number.isInteger(id)) throw new TypeError("A numeric tabId is required.");
  return id;
}
function booleanValue(data, key, fallback) {
  const value = record(data)[key];
  if (value === void 0) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${key} must be a boolean.`);
  return value;
}
function numberValue(data, key) {
  const value = record(data)[key];
  if (value === void 0) return void 0;
  if (!Number.isInteger(value)) throw new TypeError(`${key} must be an integer.`);
  return value;
}
function urlValue(data) {
  const value = record(data).url;
  if (typeof value !== "string") throw new TypeError("A URL is required.");
  return normalizeTabUrl(value);
}
function createExtensionStatus(version) {
  return { available: true, version, capabilities: TAB_ACTIONS };
}
async function handleTabAction(tabs, action, data) {
  if (action === "open") {
    const tab = await tabs.create({
      url: urlValue(data),
      active: booleanValue(data, "active", true),
      pinned: booleanValue(data, "pinned", false),
      ...numberValue(data, "index") !== void 0 ? { index: numberValue(data, "index") } : {}
    });
    return { tab: toBrowserTab(tab) };
  }
  if (action === "list") {
    const currentWindow = booleanValue(data, "currentWindow", true);
    const tabsInWindow = await tabs.query(currentWindow ? { currentWindow: true } : {});
    return { tabs: tabsInWindow.filter((tab) => Number.isInteger(tab.id)).map(toBrowserTab) };
  }
  if (action === "active") {
    const [active] = await tabs.query({ active: true, lastFocusedWindow: true });
    return { tab: active && Number.isInteger(active.id) ? toBrowserTab(active) : null };
  }
  const id = tabId(data);
  if (action === "navigate") return { tab: toBrowserTab(await tabs.update(id, { url: urlValue(data) })) };
  if (action === "activate") return { tab: toBrowserTab(await tabs.update(id, { active: true })) };
  if (action === "pin") return { tab: toBrowserTab(await tabs.update(id, { pinned: booleanValue(data, "pinned", true) })) };
  if (action === "mute") return { tab: toBrowserTab(await tabs.update(id, { muted: booleanValue(data, "muted", true) })) };
  if (action === "reload") {
    await tabs.reload(id);
    return { ok: true };
  }
  if (action === "close") {
    await tabs.remove(id);
    return { ok: true };
  }
  if (action === "back") {
    if (!tabs.goBack) throw new Error("Back navigation is not supported by this Chrome version.");
    await tabs.goBack(id);
    return { ok: true };
  }
  if (action === "forward") {
    if (!tabs.goForward) throw new Error("Forward navigation is not supported by this Chrome version.");
    await tabs.goForward(id);
    return { ok: true };
  }
  throw new Error(`Unsupported action: ${action}`);
}

// src/extension-worker.ts
var EXTENSION_VERSION = "1.1.0";
var subscriberTabIds = /* @__PURE__ */ new Set();
var sharedTabId = null;
function numberField(data, name, fallback) {
  const value = data[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}
function sharedTab() {
  if (!Number.isInteger(sharedTabId)) throw new Error("No tab is currently shared. Choose a tab from the extension popup first.");
  return sharedTabId;
}
async function detachShared(reason) {
  if (!Number.isInteger(sharedTabId)) return;
  const tabId2 = sharedTabId;
  sharedTabId = null;
  try {
    await chrome.debugger.detach({ tabId: tabId2 });
  } catch {
  }
  await broadcast({ type: "share-stopped", tabId: tabId2, reason });
}
async function startSharing(tabId2) {
  if (!Number.isInteger(tabId2)) throw new TypeError("Choose a valid tab before sharing.");
  if (sharedTabId === tabId2) {
    const tab2 = await chrome.tabs.get(tabId2);
    return { tab: toBrowserTab(tab2) };
  }
  await detachShared("The user chose another tab.");
  const tab = await chrome.tabs.get(tabId2);
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (!/^https?:\/\//i.test(url)) throw new Error("Only regular HTTP or HTTPS pages can be shared.");
  await chrome.debugger.attach({ tabId: tabId2 }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId: tabId2 }, "Page.enable");
    sharedTabId = tabId2;
    const browserTab = toBrowserTab(tab);
    await broadcast({ type: "share-started", tab: browserTab });
    return { tab: browserTab };
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId: tabId2 });
    } catch {
    }
    throw error;
  }
}
async function captureScreenshot() {
  const tabId2 = sharedTab();
  const result = await chrome.debugger.sendCommand({ tabId: tabId2 }, "Page.captureScreenshot", { format: "jpeg", quality: 82, fromSurface: true });
  if (!result || typeof result.data !== "string") throw new Error("Chrome did not return a screenshot.");
  return { tabId: tabId2, dataUrl: `data:image/jpeg;base64,${result.data}`, capturedAt: Date.now() };
}
async function dispatchInput(data) {
  if (!isRecord(data) || !isRecord(data.input)) throw new TypeError("A valid input payload is required.");
  const tabId2 = sharedTab();
  const input = data.input;
  if (input.kind === "pointer") {
    await chrome.debugger.sendCommand({ tabId: tabId2 }, "Input.dispatchMouseEvent", { type: input.type, x: numberField(input, "x"), y: numberField(input, "y"), button: input.button ?? "none", clickCount: input.clickCount ?? 0 });
  } else if (input.kind === "wheel") {
    await chrome.debugger.sendCommand({ tabId: tabId2 }, "Input.dispatchMouseEvent", { type: "mouseWheel", x: numberField(input, "x"), y: numberField(input, "y"), deltaX: numberField(input, "deltaX", 0), deltaY: numberField(input, "deltaY", 0) });
  } else if (input.kind === "key") {
    if (!["keyDown", "keyUp", "char"].includes(input.type) || typeof input.key !== "string" || input.key.length > 128) throw new TypeError("Invalid key input.");
    await chrome.debugger.sendCommand({ tabId: tabId2 }, "Input.dispatchKeyEvent", { type: input.type, key: input.key, code: input.code, modifiers: input.modifiers ?? 0, text: input.type === "char" ? input.key : void 0 });
  } else if (input.kind === "text") {
    if (typeof input.text !== "string" || input.text.length > 2e3) throw new TypeError("Text input must be at most 2000 characters.");
    await chrome.debugger.sendCommand({ tabId: tabId2 }, "Input.insertText", { text: input.text });
  } else {
    throw new TypeError("Unsupported input event.");
  }
  return { ok: true };
}
function response(requestId, ok, result, error) {
  return { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId, ok, ...ok ? { result } : { error } };
}
async function broadcast(event) {
  const message = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "event", event };
  await Promise.all([...subscriberTabIds].map(async (tabId2) => {
    try {
      await chrome.tabs.sendMessage(tabId2, message);
    } catch {
      subscriberTabIds.delete(tabId2);
    }
  }));
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isRecord(message) && message.scope === "real-browser-popup") {
    void (async () => {
      try {
        if (message.action === "list-tabs") {
          const tabs = (await chrome.tabs.query({ currentWindow: true })).filter((tab) => Number.isInteger(tab.id)).map(toBrowserTab);
          return { ok: true, tabs, sharedTabId };
        }
        if (message.action === "share" && Number.isInteger(message.tabId)) return { ok: true, ...await startSharing(message.tabId) };
        if (message.action === "stop-share") {
          await detachShared("The user stopped sharing from the extension.");
          return { ok: true };
        }
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
      if (message.action === "status") return response(message.requestId, true, createExtensionStatus(EXTENSION_VERSION));
      if (message.action === "subscribe") {
        const siteTabId = sender.tab?.id;
        if (!Number.isInteger(siteTabId)) throw new Error("Subscriptions are only allowed from an approved web page.");
        subscriberTabIds.add(siteTabId);
        return response(message.requestId, true, { subscribed: true });
      }
      if (message.action === "shared") {
        const tab = Number.isInteger(sharedTabId) ? toBrowserTab(await chrome.tabs.get(sharedTabId)) : null;
        return response(message.requestId, true, { tab });
      }
      if (message.action === "screenshot") return response(message.requestId, true, await captureScreenshot());
      if (message.action === "input") return response(message.requestId, true, await dispatchInput(message.data));
      if (message.action === "stopShare") {
        await detachShared("The web application stopped sharing.");
        return response(message.requestId, true, { ok: true });
      }
      const result = await handleTabAction(chrome.tabs, message.action, message.data);
      return response(message.requestId, true, result);
    } catch (error) {
      return response(message.requestId, false, void 0, error instanceof Error ? error.message : "The extension could not complete the command.");
    }
  })().then(sendResponse);
  return true;
});
chrome.tabs.onUpdated.addListener(async (tabId2, _changeInfo, tab) => {
  if (!Number.isInteger(tab.id)) return;
  await broadcast({ type: "updated", tab: toBrowserTab(tab) });
});
chrome.tabs.onActivated.addListener(async ({ tabId: tabId2 }) => {
  try {
    const tab = await chrome.tabs.get(tabId2);
    await broadcast({ type: "activated", tab: toBrowserTab(tab) });
  } catch {
  }
});
chrome.tabs.onRemoved.addListener(async (tabId2) => {
  if (sharedTabId === tabId2) await detachShared("The shared tab was closed.");
  await broadcast({ type: "removed", tabId: tabId2 });
});
chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (source.tabId === sharedTabId) {
    const tabId2 = sharedTabId;
    sharedTabId = null;
    await broadcast({ type: "share-stopped", tabId: tabId2, reason });
  }
});
//# sourceMappingURL=extension-worker.js.map