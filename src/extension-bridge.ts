import { BRIDGE_CHANNEL, isBridgeCommand } from "./protocol.js";

declare const chrome: {
  runtime: {
    lastError?: { message?: string };
    sendMessage: (
      message: unknown,
      callback?: (response: unknown) => void
    ) => void;
    onMessage: {
      addListener: (
        callback: (message: { scope?: string; event?: unknown }) => void
      ) => void;
    };
  };
};

export function installExtensionBridge(): void {
  const globalAny = globalThis as Record<string, unknown>;
  if (globalAny.__realBrowserWebBridgeInstalled) return;
  globalAny.__realBrowserWebBridgeInstalled = true;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!isBridgeCommand(event.data)) return;

    const command = event.data;
    chrome.runtime.sendMessage(
      {
        scope: "real-browser-bridge",
        command,
      },
      (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        window.postMessage(
          runtimeError
            ? {
                channel: command.channel ?? BRIDGE_CHANNEL,
                id: command.id,
                ok: false,
                error: runtimeError.message,
              }
            : response,
          window.location.origin || "*"
        );
      }
    );
  });

  chrome.runtime.onMessage.addListener((message: { scope?: string; event?: unknown }) => {
    if (message?.scope === "real-browser-event" && message.event) {
      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          event: message.event,
        },
        window.location.origin || "*"
      );
    }
  });
}
