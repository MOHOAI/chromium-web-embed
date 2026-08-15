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
function isBridgeEvent(value) {
  return isRecord(value) && value.channel === BRIDGE_CHANNEL && value.version === BRIDGE_VERSION && value.kind === "event" && isRecord(value.event) && typeof value.event.type === "string";
}

// src/extension-bridge.ts
var origin = window.location.origin;
var extensionVersion = "2.1.1";
var bridgeGlobal = globalThis;
if (!bridgeGlobal.__realBrowserWebBridgeInstalled) {
  bridgeGlobal.__realBrowserWebBridgeInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== origin || !isBridgeCommand(event.data)) return;
    const command = event.data;
    void chrome.runtime.sendMessage(command).then((message) => window.postMessage(message, origin)).catch(() => window.postMessage({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      kind: "response",
      requestId: command.requestId,
      ok: false,
      error: "The browser extension is unavailable."
    }, origin));
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (isBridgeEvent(message)) window.postMessage(message, origin);
  });
}
var ready = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "ready", extensionVersion };
window.postMessage(ready, origin);
//# sourceMappingURL=extension-bridge.js.map