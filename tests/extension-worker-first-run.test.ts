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

  it("assigns an iframe workspace to the frame origin and routes its events back to the same frame", async () => {
    const chromeMock = (globalThis as Record<string, any>).chrome;
    chromeMock.tabs.create.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    chromeMock.tabs.group.mockResolvedValue(15);
    chromeMock.tabs.get.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    const frameSender = { tab: { id: 99, url: "https://host.example/" }, url: "https://widget.example/embed", frameId: 7 };
    const send = async (requestId: string, action: string, data?: Record<string, unknown>, sender: unknown = frameSender) => new Promise<any>((resolve) => {
      messageHandler?.({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) }, sender, resolve);
    });

    await expect(send("subscribe-frame", "subscribe")).resolves.toMatchObject({ ok: true });
    const created = await send("create-frame", "workspaceCreate", { url: "https://example.com" });
    expect(created.result.workspace.origin).toBe("https://widget.example");
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(99, expect.objectContaining({ kind: "event" }), { frameId: 7 });
    await expect(send("host-workspace", "workspaceGet", undefined, { tab: { id: 99, url: "https://host.example/" }, url: "https://host.example/", frameId: 0 })).resolves.toMatchObject({ result: { workspace: null } });
  });

  it("keeps the managed tab in the background and supplies native key codes for backspace and delete", async () => {
    const chromeMock = (globalThis as Record<string, any>).chrome;
    chromeMock.tabs.create.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    chromeMock.tabs.group.mockResolvedValue(15);
    chromeMock.tabs.get.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    chromeMock.debugger.attach.mockResolvedValue(undefined);
    chromeMock.debugger.sendCommand.mockResolvedValue({});

    const send = async (requestId: string, action: string, data?: Record<string, unknown>) => new Promise<any>((resolve) => {
      messageHandler?.(
        { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) },
        { tab: { id: 99, url: "https://moho.example/" } },
        resolve,
      );
    });
    const created = await send("create", "workspaceCreate", { url: "https://example.com" });
    const workspaceId = created.result.workspace.id as string;
    const result = await send("delete", "workspaceInput", {
      workspaceId,
      input: { kind: "key", type: "keyDown", key: "Backspace", code: "Backspace" },
    });

    expect(result).toMatchObject({ ok: true, result: { ok: true } });
    expect(chromeMock.debugger.sendCommand).not.toHaveBeenCalledWith({ tabId: 8 }, "Page.bringToFront");
    expect(chromeMock.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 8 },
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }),
    );
  });

  it("clamps JPEG quality and preserves an explicit PNG screenshot request", async () => {
    const chromeMock = (globalThis as Record<string, any>).chrome;
    chromeMock.tabs.create.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    chromeMock.tabs.group.mockResolvedValue(15);
    chromeMock.tabs.get.mockResolvedValue({ id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0 });
    chromeMock.debugger.attach.mockResolvedValue(undefined);
    chromeMock.debugger.sendCommand.mockImplementation(async (_target: unknown, method: string) => method === "Page.captureScreenshot" ? { data: "frame" } : {});
    const send = async (requestId: string, action: string, data?: Record<string, unknown>) => new Promise<any>((resolve) => {
      messageHandler?.({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) }, { tab: { id: 99, url: "https://moho.example/" } }, resolve);
    });
    const created = await send("create", "workspaceCreate", { url: "https://example.com" });
    const workspaceId = created.result.workspace.id as string;
    const jpeg = await send("jpeg", "workspaceScreenshot", { workspaceId, quality: 150 });
    const png = await send("png", "workspaceScreenshot", { workspaceId, format: "png" });

    expect(jpeg.result.dataUrl).toBe("data:image/jpeg;base64,frame");
    expect(png.result.dataUrl).toBe("data:image/png;base64,frame");
    expect(chromeMock.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 8 }, "Page.captureScreenshot", expect.objectContaining({ format: "jpeg", quality: 100, optimizeForSpeed: true }));
    expect(chromeMock.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 8 }, "Page.captureScreenshot", expect.objectContaining({ format: "png", optimizeForSpeed: false }));
  });
});
