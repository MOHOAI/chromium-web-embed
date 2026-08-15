import { ChromeLikeTab, createExtensionStatus, handleTabAction, toBrowserTab } from "./extension-core";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeEvent, BridgeResponse, BrowserTab, SharedTabInput, isBridgeCommand, isRecord } from "./protocol";

declare const chrome: any;

const EXTENSION_VERSION = "1.1.0";
const subscriberTabIds = new Set<number>();
let sharedTabId: number | null = null;

function numberField(data: Record<string, unknown>, name: string, fallback?: number): number {
  const value = data[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}

function sharedTab(): number {
  if (!Number.isInteger(sharedTabId)) throw new Error("No tab is currently shared. Choose a tab from the extension popup first.");
  return sharedTabId as number;
}

async function detachShared(reason: string): Promise<void> {
  if (!Number.isInteger(sharedTabId)) return;
  const tabId = sharedTabId as number;
  sharedTabId = null;
  try { await chrome.debugger.detach({ tabId }); } catch { /* The tab may already be gone. */ }
  await broadcast({ type: "share-stopped", tabId, reason });
}

async function startSharing(tabId: number): Promise<{ tab: BrowserTab }> {
  if (!Number.isInteger(tabId)) throw new TypeError("Choose a valid tab before sharing.");
  if (sharedTabId === tabId) {
    const tab = await chrome.tabs.get(tabId) as ChromeLikeTab;
    return { tab: toBrowserTab(tab) };
  }
  await detachShared("The user chose another tab.");
  const tab = await chrome.tabs.get(tabId) as ChromeLikeTab;
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (!/^https?:\/\//i.test(url)) throw new Error("Only regular HTTP or HTTPS pages can be shared.");
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    sharedTabId = tabId;
    const browserTab = toBrowserTab(tab);
    await broadcast({ type: "share-started", tab: browserTab });
    return { tab: browserTab };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch { /* Ignore cleanup errors. */ }
    throw error;
  }
}

async function captureScreenshot(): Promise<unknown> {
  const tabId = sharedTab();
  const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", { format: "jpeg", quality: 82, fromSurface: true });
  if (!result || typeof result.data !== "string") throw new Error("Chrome did not return a screenshot.");
  return { tabId, dataUrl: `data:image/jpeg;base64,${result.data}`, capturedAt: Date.now() };
}

async function dispatchInput(data?: Record<string, unknown>): Promise<{ ok: true }> {
  if (!isRecord(data) || !isRecord(data.input)) throw new TypeError("A valid input payload is required.");
  const tabId = sharedTab();
  const input = data.input as SharedTabInput;
  if (input.kind === "pointer") {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: input.type, x: numberField(input, "x"), y: numberField(input, "y"), button: input.button ?? "none", clickCount: input.clickCount ?? 0 });
  } else if (input.kind === "wheel") {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseWheel", x: numberField(input, "x"), y: numberField(input, "y"), deltaX: numberField(input, "deltaX", 0), deltaY: numberField(input, "deltaY", 0) });
  } else if (input.kind === "key") {
    if (!["keyDown", "keyUp", "char"].includes(input.type) || typeof input.key !== "string" || input.key.length > 128) throw new TypeError("Invalid key input.");
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: input.type, key: input.key, code: input.code, modifiers: input.modifiers ?? 0, text: input.type === "char" ? input.key : undefined });
  } else if (input.kind === "text") {
    if (typeof input.text !== "string" || input.text.length > 2_000) throw new TypeError("Text input must be at most 2000 characters.");
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: input.text });
  } else {
    throw new TypeError("Unsupported input event.");
  }
  return { ok: true };
}

function response(requestId: string, ok: boolean, result?: unknown, error?: string): BridgeResponse {
  return { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId, ok, ...(ok ? { result } : { error }) };
}

async function broadcast(event: BridgeEvent["event"]): Promise<void> {
  const message: BridgeEvent = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "event", event };
  await Promise.all([...subscriberTabIds].map(async (tabId) => {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      subscriberTabIds.delete(tabId);
    }
  }));
}

chrome.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number } }, sendResponse: (payload: unknown) => void) => {
  if (isRecord(message) && message.scope === "real-browser-popup") {
    void (async () => {
      try {
        if (message.action === "list-tabs") {
          const tabs = (await chrome.tabs.query({ currentWindow: true }) as ChromeLikeTab[]).filter((tab: ChromeLikeTab) => Number.isInteger(tab.id)).map(toBrowserTab);
          return { ok: true, tabs, sharedTabId };
        }
        if (message.action === "share" && Number.isInteger(message.tabId)) return { ok: true, ...(await startSharing(message.tabId as number)) };
        if (message.action === "stop-share") { await detachShared("The user stopped sharing from the extension."); return { ok: true }; }
        throw new Error("Unsupported popup action.");
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The extension could not complete the request." }; }
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
        subscriberTabIds.add(siteTabId as number);
        return response(message.requestId, true, { subscribed: true });
      }
      if (message.action === "shared") {
        const tab = Number.isInteger(sharedTabId) ? toBrowserTab(await chrome.tabs.get(sharedTabId) as ChromeLikeTab) : null;
        return response(message.requestId, true, { tab });
      }
      if (message.action === "screenshot") return response(message.requestId, true, await captureScreenshot());
      if (message.action === "input") return response(message.requestId, true, await dispatchInput(message.data));
      if (message.action === "stopShare") { await detachShared("The web application stopped sharing."); return response(message.requestId, true, { ok: true }); }
      const result = await handleTabAction(chrome.tabs, message.action, message.data);
      return response(message.requestId, true, result);
    } catch (error) {
      return response(message.requestId, false, undefined, error instanceof Error ? error.message : "The extension could not complete the command.");
    }
  })().then(sendResponse);
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId: number, _changeInfo: unknown, tab: ChromeLikeTab) => {
  if (!Number.isInteger(tab.id)) return;
  await broadcast({ type: "updated", tab: toBrowserTab(tab) });
});

chrome.tabs.onActivated.addListener(async ({ tabId }: { tabId: number }) => {
  try {
    const tab = await chrome.tabs.get(tabId) as ChromeLikeTab;
    await broadcast({ type: "activated", tab: toBrowserTab(tab) });
  } catch {
    // A tab can disappear while Chrome processes the activation event.
  }
});

chrome.tabs.onRemoved.addListener(async (tabId: number) => {
  if (sharedTabId === tabId) await detachShared("The shared tab was closed.");
  await broadcast({ type: "removed", tabId });
});

chrome.debugger.onDetach.addListener(async (source: { tabId?: number }, reason: string) => {
  if (source.tabId === sharedTabId) {
    const tabId = sharedTabId as number;
    sharedTabId = null;
    await broadcast({ type: "share-stopped", tabId, reason });
  }
});
