import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeEvent, isBridgeCommand, isBridgeEvent } from "./protocol";

declare const chrome: any;

const origin = window.location.origin;

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== origin || !isBridgeCommand(event.data)) return;
  const command = event.data;
  void chrome.runtime.sendMessage(command)
    .then((message: unknown) => window.postMessage(message, origin))
    .catch(() => window.postMessage({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      kind: "response",
      requestId: command.requestId,
      ok: false,
      error: "The browser extension is unavailable.",
    }, origin));
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isBridgeEvent(message)) window.postMessage(message satisfies BridgeEvent, origin);
});

window.postMessage({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "ready" }, origin);
