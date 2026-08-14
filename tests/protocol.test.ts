import { describe, expect, it } from "vitest";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, isBridgeCommand, normalizeTabUrl } from "../src/protocol";

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
      action: "open",
      data: { url: "https://example.com" },
    })).toBe(true);
    expect(isBridgeCommand({ channel: BRIDGE_CHANNEL, version: 99, kind: "command", requestId: "request-1", action: "open" })).toBe(false);
    expect(isBridgeCommand({ channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId: "request-1", action: "evaluate" })).toBe(false);
  });
});
