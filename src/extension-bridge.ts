import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeEvent, BridgeReady, isBridgeCommand, isBridgeEvent } from "./protocol";

declare const chrome: any;

const origin = window.location.origin;
const extensionVersion = "2.1.2";
const bridgeGlobal = globalThis as typeof globalThis & { __realBrowserWebBridgeInstalled?: boolean };

if (!bridgeGlobal.__realBrowserWebBridgeInstalled) {
  bridgeGlobal.__realBrowserWebBridgeInstalled = true;

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== origin || !isBridgeCommand(event.data)) return;
    const command = event.data;
    // Use Chrome's callback form for the widest Manifest V3 compatibility. It also
    // turns a delayed or unavailable service worker into a concrete response instead
    // of leaving the embedding site waiting for a promise that never settles.
    chrome.runtime.sendMessage(command, (message: unknown) => {
      const error = chrome.runtime.lastError;
      if (error || !message) {
        window.postMessage({
          channel: BRIDGE_CHANNEL,
          version: BRIDGE_VERSION,
          kind: "response",
          requestId: command.requestId,
          ok: false,
          error: error?.message ?? "The browser extension is unavailable.",
        }, origin);
        return;
      }
      window.postMessage(message, origin);
    });
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (isBridgeEvent(message)) window.postMessage(message satisfies BridgeEvent, origin);
  });
}

const ready: BridgeReady = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "ready", extensionVersion };
window.postMessage(ready, origin);
