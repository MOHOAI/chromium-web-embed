(() => {
  const BRIDGE_CHANNEL = "real-browser-web/v5";
  const LEGACY_CHANNELS = ["real-browser-web/v4", "real-browser-web/v3"];
  const TAB_ACTIONS = new Set([
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
    "workspaceZoomScreenshot",
    "workspaceCursorPosition",
    "workspaceInput",
    "workspaceInteractiveElements",
    "workspacePageText",
    "workspaceWindowMode",
    "workspaceSetZoom",
    "workspacePrintPdf",
    "workspaceWaitForSelector",
    "workspaceStorage",
    "agentExecute",
    "desktopConnect",
    "desktopDisconnect",
    "desktopStatus",
    "desktopExecute",
    "desktopStartStream",
    "desktopStopStream",
    "desktopEmergencyStop",
    "desktopResume",
    "folderBrainSyncStatus",
    "workspaceAriaSnapshot",
    "workspaceAnnotatedScreenshot",
    "workspaceDiagnostics"
  ]);

  if (globalThis.__realBrowserWebBridgeInstalled) return;
  globalThis.__realBrowserWebBridgeInstalled = true;

  function isValidCommand(data) {
    if (!data || typeof data !== "object") return false;
    const validChannel =
      data.channel === BRIDGE_CHANNEL || LEGACY_CHANNELS.includes(data.channel);
    return (
      validChannel &&
      typeof data.id === "string" &&
      typeof data.action === "string" &&
      TAB_ACTIONS.has(data.action)
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isValidCommand(event.data)) return;

    const command = event.data;
    chrome.runtime.sendMessage(
      {
        scope: "real-browser-bridge",
        command
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        window.postMessage(
          runtimeError
            ? {
                channel: command.channel || BRIDGE_CHANNEL,
                id: command.id,
                ok: false,
                error: runtimeError.message
              }
            : response,
          window.location.origin || "*"
        );
      }
    );
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.scope === "real-browser-event" && message.event) {
      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          event: message.event
        },
        window.location.origin || "*"
      );
    }
  });
})();
