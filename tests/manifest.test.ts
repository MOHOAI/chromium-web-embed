import { describe, expect, it } from "vitest";
import { createRealBrowserExtensionManifest } from "../src/extension";

describe("extension manifest", () => {
  it("creates a restrictive Manifest V3 configuration", () => {
    const manifest = createRealBrowserExtensionManifest({ allowedOrigins: ["https://app.example.com/*"] });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["tabs", "tabGroups", "debugger", "scripting", "storage"]);
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.content_scripts[0]?.matches).toEqual(["https://app.example.com/*"]);
    expect(manifest.host_permissions).toEqual(["https://app.example.com/*"]);
  });

  it("requires at least one approved origin", () => {
    expect(() => createRealBrowserExtensionManifest({ allowedOrigins: [] })).toThrow("At least one allowed origin");
  });
});
