import { describe, expect, it } from "vitest";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, TAB_ACTIONS, isBridgeCommand, isBridgeReady, normalizeTabUrl } from "../src/protocol";

describe("browser bridge protocol", () => {
  it("normalizes HTTP and HTTPS tab URLs", () => {
    expect(normalizeTabUrl("example.com")).toBe("https://example.com/");
    expect(normalizeTabUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("rejects unsafe URL schemes", () => {
    expect(() => normalizeTabUrl("javascript:alert(1)")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeTabUrl("file:///etc/passwd")).toThrow("Only HTTP and HTTPS");
  });

  it("accepts only recognized, versioned bridge commands", () => {
    expect(isBridgeCommand({
      channel: BRIDGE_CHANNEL,
      version: BRIDGE_VERSION,
      kind: "command",
      requestId: "request-1",
      action: "workspaceCreate",
      data: { url: "https://example.com" },
    })).toBe(true);
    expect(isBridgeCommand({ channel: BRIDGE_CHANNEL, version: 99, kind: "command", requestId: "request-1", action: "workspaceCreate" })).toBe(false);
    expect(isBridgeCommand({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId: "request-1", action: "evaluate" })).toBe(false);
  });

  it("recognizes a versioned bridge-ready handshake with an extension version", () => {
    expect(isBridgeReady({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "ready", extensionVersion: "1.2.0" })).toBe(true);
    expect(isBridgeReady({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "ready" })).toBe(false);
  });

  it("exposes the managed-tab preference and duplication actions in the versioned protocol", () => {
    expect(TAB_ACTIONS).toContain("workspaceRename");
    expect(TAB_ACTIONS).toContain("workspacePinTab");
    expect(TAB_ACTIONS).toContain("workspaceMuteTab");
    expect(TAB_ACTIONS).toContain("workspaceDuplicateTab");
  });
});
