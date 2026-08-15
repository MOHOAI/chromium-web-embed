import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedBrowserAgent, RealBrowserClient } from "../src";
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

  it("sends a versioned status request and receives the isolated workspace state", async () => {
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind === "command" && command.action === "status") respondTo(command as BridgeCommand, { available: true, version: "2.1.0", capabilities: ["status"], model: "managed-workspace", privacy: "origin-isolated" });
    });
    const client = new RealBrowserClient();
    await expect(client.status()).resolves.toMatchObject({ available: true, version: "2.1.0", model: "managed-workspace", privacy: "origin-isolated" });
    client.dispose();
  });

  it("retries the handshake until a bridge injected after page load responds", async () => {
    let statusAttempts = 0;
    vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      const command = message as Partial<BridgeCommand>;
      if (command.kind !== "command") return;
      if (command.action === "status" && ++statusAttempts >= 2) respondTo(command as BridgeCommand, { available: true, version: "2.1.0", capabilities: ["status", "subscribe"], model: "managed-workspace", privacy: "origin-isolated" });
      if (command.action === "subscribe") respondTo(command as BridgeCommand, { subscribed: true });
    });
    const client = new RealBrowserClient({ timeoutMs: 10 });
    await expect(client.waitForExtension({ timeoutMs: 500, retryIntervalMs: 150 })).resolves.toMatchObject({ version: "2.1.0" });
    expect(statusAttempts).toBe(2);
    expect(client.getConnectionDiagnostic()).toMatchObject({ code: "connected", extensionVersion: "2.1.0" });
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
    const agent = createManagedBrowserAgent({ client });
    await expect(agent.observe()).resolves.toMatchObject({ tabId: 8 });
    await expect(agent.type("مرحبا")).resolves.toEqual({ ok: true });
    await expect(agent.open("example.com")).resolves.toEqual({ ok: true });
    await expect(agent.snapshot()).resolves.toMatchObject({ workspace: { id: "ws-1" }, tabs: [{ id: 8 }] });
    expect(received.map((command) => command.action)).toEqual(["workspaceCreate", "workspaceScreenshot", "agentExecute", "agentExecute", "workspaceList"]);
    expect(received[2]?.data).toMatchObject({ workspaceId: "ws-1", operation: { type: "input", input: { kind: "text", text: "مرحبا" } } });
    client.dispose();
  });
});
