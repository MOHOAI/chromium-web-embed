import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedBrowserAgent, RealBrowserClient, SharedTabViewer } from "../src";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeCommand, BridgeResponse } from "../src/protocol";

const origin = window.location.origin;
const workspace = { id: "ws-1", origin, groupId: 15, label: "تجربة", tabIds: [8], activeTabId: 8, agentControlEnabled: false, createdAt: 1 };
const tab = { id: 8, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0, pinned: false, muted: false, audible: false };

function respondTo(command: BridgeCommand, result: unknown): void {
  const response: BridgeResponse = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId: command.requestId, ok: true, result };
  window.dispatchEvent(new MessageEvent("message", { data: response, origin, source: window }));
}

describe("RealBrowserClient managed workspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the responsive render profile and records a rendered frame without overlapping work", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "workspaceScreenshot") respondTo(command as BridgeCommand, { tabId: 8, dataUrl: "data:image/jpeg;base64,AA==", capturedAt: 7 });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace();
    const viewer = new SharedTabViewer(client, document.createElement("div"), { renderProfile: "responsive", pauseWhenHidden: false });
    await viewer.refresh();
    await viewer.refresh();
    expect(received.at(-1)?.data).toMatchObject({ format: "jpeg", quality: 58 });
    expect(viewer.getMetrics()).toMatchObject({ framesRendered: 2, queuedRefreshes: 0, lastFrameAt: 7 });
    expect(viewer.getMetrics().averageCaptureLatencyMs).toBeGreaterThanOrEqual(0);
    expect(viewer.getMetrics().averageRefreshIntervalMs).toBeGreaterThanOrEqual(0);
    expect(viewer.getMetrics().effectiveFps).toBeGreaterThanOrEqual(0);
    viewer.dispose();
    client.dispose();
  });

  it("sends a versioned status request and receives the isolated workspace state", async () => {
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind === "command" && command.action === "status") respondTo(command as BridgeCommand, { available: true, version: "2.1.2", capabilities: ["status"], model: "managed-workspace", privacy: "origin-isolated" });
    });
    const client = new RealBrowserClient();
    await expect(client.status()).resolves.toMatchObject({ available: true, version: "2.1.2", model: "managed-workspace", privacy: "origin-isolated" });
    client.dispose();
  });

  it("retries the handshake until a bridge injected after page load responds", async () => {
    let statusAttempts = 0;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      if (command.action === "status" && ++statusAttempts >= 2) respondTo(command as BridgeCommand, { available: true, version: "2.1.2", capabilities: ["status", "subscribe"], model: "managed-workspace", privacy: "origin-isolated" });
      if (command.action === "subscribe") respondTo(command as BridgeCommand, { subscribed: true });
    });
    const client = new RealBrowserClient({ timeoutMs: 10 });
    await expect(client.waitForExtension({ timeoutMs: 500, retryIntervalMs: 150 })).resolves.toMatchObject({ version: "2.1.2" });
    expect(statusAttempts).toBe(2);
    expect(client.getConnectionDiagnostic()).toMatchObject({ code: "connected", extensionVersion: "2.1.2" });
    client.dispose();
  });

  it("creates an isolated workspace and normalizes its initial URL", async () => {
    let received: BridgeCommand | undefined;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind === "command" && command.action === "workspaceCreate") { received = command as BridgeCommand; respondTo(received, { workspace, tab }); }
    });
    const client = new RealBrowserClient();
    await expect(client.createWorkspace({ url: "example.com", label: "تجربة" })).resolves.toMatchObject({ workspace: { id: "ws-1" }, tab: { id: 8 } });
    expect(received?.data).toMatchObject({ url: "https://example.com/", label: "تجربة" });
    expect(client.getWorkspaceId()).toBe("ws-1");
    client.dispose();
  });

  it("discovers that an origin has no workspace before creating one", async () => {
    let received: BridgeCommand | undefined;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind === "command" && command.action === "workspaceGet") {
        received = command as BridgeCommand;
        respondTo(received, { workspace: null });
      }
    });
    const client = new RealBrowserClient();
    await expect(client.workspace()).resolves.toEqual({ workspace: null });
    expect(received?.data).toBeUndefined();
    expect(client.getWorkspaceId()).toBeUndefined();
    client.dispose();
  });

  it("reconnects and retries a read-only workspace discovery after the bridge drops a response", async () => {
    const received: BridgeCommand[] = [];
    let discoveryAttempts = 0;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceGet" && ++discoveryAttempts === 2) respondTo(command as BridgeCommand, { workspace: null });
      if (command.action === "status") respondTo(command as BridgeCommand, { available: true, version: "2.1.2", capabilities: ["status", "subscribe"], model: "managed-workspace", privacy: "origin-isolated" });
      if (command.action === "subscribe") respondTo(command as BridgeCommand, { subscribed: true });
    });
    const client = new RealBrowserClient({ timeoutMs: 10 });
    await expect(client.workspace()).resolves.toEqual({ workspace: null });
    expect(received.map((command) => command.action)).toEqual(["workspaceGet", "status", "subscribe", "workspaceGet"]);
    expect(client.getConnectionDiagnostic()).toMatchObject({ code: "connected", extensionVersion: "2.1.2" });
    client.dispose();
  });

  it("sends agent actions only through the selected managed workspace", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "agentExecute") respondTo(command as BridgeCommand, { ok: true });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace();
    await expect(client.agentExecute({ type: "input", input: { kind: "text", text: "بحث" } })).resolves.toEqual({ ok: true });
    expect(received.map((command) => command.action)).toEqual(["workspaceCreate", "agentExecute"]);
    expect(received[1]?.data).toMatchObject({ workspaceId: "ws-1", operation: { type: "input" } });
    client.dispose();
  });

  it("requires an explicit reconnect before retrying an interrupted agent action", async () => {
    const received: BridgeCommand[] = [];
    let agentAttempts = 0;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "status") respondTo(command as BridgeCommand, { available: true, version: "2.1.2", capabilities: ["status", "subscribe"], model: "managed-workspace", privacy: "origin-isolated" });
      if (command.action === "subscribe") respondTo(command as BridgeCommand, { subscribed: true });
      if (command.action === "agentExecute" && ++agentAttempts === 2) respondTo(command as BridgeCommand, { ok: true });
    });
    const client = new RealBrowserClient({ timeoutMs: 10 });
    await client.createWorkspace({ agentControl: true });
    const agent = createManagedBrowserAgent({ client });
    await expect(agent.type("لا تُكرّر تلقائيًا")).rejects.toThrow(/Connection interrupted/i);
    expect(received.map((command) => command.action)).toEqual(["workspaceCreate", "agentExecute"]);
    expect(client.getConnectionDiagnostic()).toMatchObject({ code: "reconnect-required" });
    await expect(client.reconnect({ timeoutMs: 500, retryIntervalMs: 150 })).resolves.toMatchObject({ version: "2.1.2" });
    await expect(agent.type("بعد إعادة الاتصال")).resolves.toEqual({ ok: true });
    expect(agent.getActivityLog().map((entry) => entry.status)).toEqual(["failed", "succeeded"]);
    client.dispose();
  });

  it("offers explicit typing, deletion, and configurable frame quality through the active workspace", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "workspaceInput") respondTo(command as BridgeCommand, { ok: true });
      if (command.action === "workspaceScreenshot") respondTo(command as BridgeCommand, { tabId: 8, dataUrl: "data:image/png;base64,AAA", capturedAt: 1 });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace();
    await client.typeText("مرحبا");
    await client.pressKey("Backspace", { code: "Backspace" });
    await client.screenshot(undefined, { format: "png", quality: 100 });
    expect(received.slice(1).map((command) => command.action)).toEqual(["workspaceInput", "workspaceInput", "workspaceInput", "workspaceScreenshot"]);
    expect(received[1]?.data).toMatchObject({ input: { kind: "text", text: "مرحبا" } });
    expect(received[2]?.data).toMatchObject({ input: { kind: "key", type: "keyDown", key: "Backspace", code: "Backspace" } });
    expect(received[4]?.data).toMatchObject({ format: "png", quality: 100 });
    client.dispose();
  });

  it("exposes tab preferences, duplication, labels, and monitoring only inside the current workspace", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "workspaceRename") respondTo(command as BridgeCommand, { workspace: { ...workspace, label: "بحث" } });
      if (command.action === "workspacePinTab" || command.action === "workspaceMuteTab") respondTo(command as BridgeCommand, { tab });
      if (command.action === "workspaceDuplicateTab") respondTo(command as BridgeCommand, { workspace, tab: { ...tab, id: 9 } });
      if (command.action === "workspaceList") respondTo(command as BridgeCommand, { workspace, tabs: [tab] });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace();
    await client.renameWorkspace("بحث");
    await client.pinWorkspaceTab(8);
    await client.muteWorkspaceTab(8);
    await client.duplicateWorkspaceTab(8);
    await expect(client.workspaceSnapshot()).resolves.toMatchObject({ workspace: { id: "ws-1" }, tabs: [{ id: 8 }] });
    expect(received.slice(1).map((command) => command.action)).toEqual(["workspaceRename", "workspacePinTab", "workspaceMuteTab", "workspaceDuplicateTab", "workspaceList"]);
    expect(received[1]?.data).toMatchObject({ workspaceId: "ws-1", label: "بحث" });
    client.dispose();
  });

  it("exposes a narrow agent facade for observing, typing, opening, and monitoring the active workspace", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "workspaceScreenshot") respondTo(command as BridgeCommand, { tabId: 8, dataUrl: "data:image/jpeg;base64,AAA", capturedAt: 1 });
      if (command.action === "agentExecute") respondTo(command as BridgeCommand, { ok: true });
      if (command.action === "workspaceList") respondTo(command as BridgeCommand, { workspace, tabs: [tab] });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace({ agentControl: true });
    const activity = vi.fn();
    const agent = createManagedBrowserAgent({ client, maxActivityEntries: 20, onActivity: activity });
    await expect(agent.observe(undefined, { format: "png", quality: 92 })).resolves.toMatchObject({ tabId: 8 });
    await expect(agent.type("مرحبا")).resolves.toEqual({ ok: true });
    await expect(agent.press("Enter", { code: "Enter" })).resolves.toEqual({ ok: true });
    await expect(agent.clear()).resolves.toEqual({ ok: true });
    await expect(agent.scroll(240, 10)).resolves.toEqual({ ok: true });
    await expect(agent.doubleClick(11, 22)).resolves.toEqual({ ok: true });
    await expect(agent.open("example.com")).resolves.toEqual({ ok: true });
    await expect(agent.snapshot()).resolves.toMatchObject({ workspace: { id: "ws-1" }, tabs: [{ id: 8 }] });
    expect(received.map((command) => command.action)).toEqual([
      "workspaceCreate", "workspaceScreenshot", "agentExecute", "agentExecute", "agentExecute", "agentExecute",
      "agentExecute", "agentExecute", "agentExecute", "agentExecute", "agentExecute", "agentExecute", "agentExecute", "workspaceList",
    ]);
    expect(received[1]?.data).toMatchObject({ format: "png", quality: 92 });
    expect(received[2]?.data).toMatchObject({ workspaceId: "ws-1", operation: { type: "input", input: { kind: "text", text: "مرحبا" } } });
    expect(received[3]?.data).toMatchObject({ operation: { input: { kind: "key", type: "keyDown", key: "Enter", code: "Enter" } } });
    expect(received[5]?.data).toMatchObject({ operation: { input: { kind: "key", type: "keyDown", key: "a", modifiers: 2 } } });
    expect(received[9]?.data).toMatchObject({ operation: { input: { kind: "wheel", deltaX: 10, deltaY: 240 } } });
    expect(received[10]?.data).toMatchObject({ operation: { input: { kind: "pointer", type: "mousePressed", x: 11, y: 22, clickCount: 2 } } });
    expect(agent.getActivityLog()).toHaveLength(11);
    expect(agent.getActivityLog()[0]).toMatchObject({ operation: { type: "input" }, status: "succeeded" });
    expect(activity).toHaveBeenCalled();
    client.dispose();
  });

  it("exposes controlled right-click, drag, clipboard, and zoom primitives only through agentExecute", async () => {
    const received: BridgeCommand[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      received.push(command as BridgeCommand);
      if (command.action === "workspaceCreate") respondTo(command as BridgeCommand, { workspace, tab });
      if (command.action === "agentExecute") respondTo(command as BridgeCommand, { ok: true });
    });
    const client = new RealBrowserClient();
    await client.createWorkspace({ agentControl: true });
    const agent = createManagedBrowserAgent({ client });
    await agent.tripleClick(10, 20);
    await agent.rightClick(10, 20);
    await agent.drag(10, 20, 30, 40);
    await agent.copy();
    await agent.cut();
    await agent.paste("ملصق");
    await agent.undo();
    await agent.redo();
    await agent.find();
    await agent.confirm();
    await agent.cancel();
    await agent.toggle();
    await agent.scrollUp(180);
    await agent.scrollDown(240);
    await agent.longPress(31, 41, 0);
    await agent.save();
    await agent.print();
    await agent.zoomIn();
    await agent.zoomOut();
    await agent.resetZoom();
    await agent.activate(8);
    await agent.back(8);
    await agent.forward(8);
    await agent.duplicate(8);
    await agent.pin(8);
    await agent.mute(8);
    await agent.close(8);
    const agentOperations = received.filter((command) => command.action === "agentExecute").map((command) => (command.data as { operation: { type: string; tabId?: number; input?: Record<string, unknown> } }).operation);
    const inputs = agentOperations.map((operation) => operation.input).filter((input): input is Record<string, unknown> => Boolean(input));
    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pointer", type: "mousePressed", clickCount: 3, button: "left" }),
      expect.objectContaining({ kind: "pointer", type: "mousePressed", button: "right" }),
      expect.objectContaining({ kind: "pointer", type: "mouseReleased", x: 30, y: 40 }),
      expect.objectContaining({ kind: "key", key: "c", modifiers: 2 }),
      expect.objectContaining({ kind: "text", text: "ملصق" }),
      expect.objectContaining({ kind: "wheel", deltaY: -180 }),
      expect.objectContaining({ kind: "pointer", type: "mouseReleased", x: 31, y: 41 }),
      expect.objectContaining({ kind: "key", key: "0", modifiers: 2 }),
    ]));
    expect(agentOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "activate", tabId: 8 }),
      expect.objectContaining({ type: "back", tabId: 8 }),
      expect.objectContaining({ type: "forward", tabId: 8 }),
      expect.objectContaining({ type: "duplicate", tabId: 8 }),
      expect.objectContaining({ type: "pin", tabId: 8 }),
      expect.objectContaining({ type: "mute", tabId: 8 }),
      expect.objectContaining({ type: "close", tabId: 8 }),
    ]));
    expect(agent.getActivityLog().every((entry) => entry.status === "succeeded")).toBe(true);
    client.dispose();
  });
});
