import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_CHANNEL, BRIDGE_VERSION } from "../src/protocol";

type MessageHandler = (message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean | void;

let messageHandler: MessageHandler | undefined;

beforeEach(async () => {
  vi.resetModules();
  messageHandler = undefined;
  (globalThis as Record<string, unknown>).chrome = {
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    runtime: { onMessage: { addListener: vi.fn((handler: MessageHandler) => { messageHandler = handler; }) } },
    tabs: {
      onUpdated: { addListener: vi.fn() }, onActivated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() },
      get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), group: vi.fn(), sendMessage: vi.fn(), reload: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), captureVisibleTab: vi.fn(),
    },
    tabGroups: { update: vi.fn() },
    debugger: { onDetach: { addListener: vi.fn() }, attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn() },
  };
  await import("../src/extension-worker");
});

describe("managed workspace first-run discovery", () => {
  it("returns a null workspace when workspaceGet has no payload", async () => {
    expect(messageHandler).toBeTypeOf("function");
    const response = await new Promise<unknown>((resolve) => {
      const keptAlive = messageHandler?.(
        { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId: "first-run", action: "workspaceGet" },
        { tab: { id: 99, url: "https://moho.example/" } },
        resolve,
      );
      expect(keptAlive).toBe(true);
    });
    expect(response).toMatchObject({ requestId: "first-run", ok: true, result: { workspace: null } });
  });
});
