import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("release assets", () => {
  it("ships the branded icon at every Manifest V3 size", () => {
    for (const size of [16, 32, 48, 128]) {
      const icon = resolve(root, "extension", "icons", `icon-${size}.png`);
      expect(existsSync(icon)).toBe(true);
      expect(statSync(icon).size).toBeGreaterThan(64);
      expect(readFileSync(icon).subarray(0, 8)).toEqual(pngSignature);
    }
  });

  it("keeps the four developer integration guides and the agent reference example available", () => {
    const requiredFiles = [
      "docs/guides/plain-javascript.md",
      "docs/guides/react.md",
      "docs/guides/backend-coordination.md",
      "docs/guides/ai-agent.md",
      "examples/ai-agent-reference.ts",
    ];

    for (const file of requiredFiles) {
      expect(existsSync(resolve(root, file))).toBe(true);
    }

    const agentGuide = readFileSync(resolve(root, "docs/guides/ai-agent.md"), "utf8");
    const reference = readFileSync(resolve(root, "examples/ai-agent-reference.ts"), "utf8");
    expect(agentGuide).toContain("client.setAgentControl(false)");
    expect(reference).toContain("createManagedBrowserAgent");
    expect(reference).toContain("agent.snapshot()");
  });
});
