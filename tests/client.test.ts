import { afterEach, describe, expect, it, vi } from "vitest";
import { RealBrowserClient } from "../src";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeCommand, BridgeResponse } from "../src/protocol";

const origin = window.location.origin;

function respondTo(command: BridgeCommand, result: unknown): void {
  const response: BridgeResponse = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId: command.requestId, ok: true, result };
  window.dispatchEvent(new MessageEvent("message", { data: response, origin, source: window }));
}

describe("RealBrowserClient", () => {
  const listeners: Array<(event: MessageEvent<unknown>) => void> = [];

  afterEach(() => {
    listeners.forEach((listener) => window.removeEventListener("message", listener));
    listeners.length = 0;
    vi.restoreAllMocks();
  });

  it("sends a versioned status request and receives the extension state", async () => {
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command?.kind === "command" && command.action === "status") {
        respondTo(command as BridgeCommand, { available: true, version: "1.0.0", capabilities: ["status"] });
      }
    });
    const bridge = (event: MessageEvent<unknown>) => {
      const command = event.data as Partial<BridgeCommand>;
      void command;
    };
    listeners.push(bridge);
    window.addEventListener("message", bridge);
    const client = new RealBrowserClient();

    await expect(client.status()).resolves.toMatchObject({ available: true, version: "1.0.0" });
    client.dispose();
  });

  it("normalizes open requests before posting them to the approved bridge", async () => {
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command?.kind === "command" && command.action === "open") {
        received = command as BridgeCommand;
        respondTo(received, { tab: { id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0, pinned: false, muted: false, audible: false } });
      }
    });
    let received: BridgeCommand | undefined;
    const bridge = (event: MessageEvent<unknown>) => {
      const command = event.data as Partial<BridgeCommand>;
      void command;
    };
    listeners.push(bridge);
    window.addEventListener("message", bridge);
    const client = new RealBrowserClient();

    await expect(client.open("example.com")).resolves.toMatchObject({ tab: { id: 8 } });
    expect(received?.data).toMatchObject({ url: "https://example.com/" });
    client.dispose();
  });
});
