import { describe, expect, it, vi } from "vitest";
import { ChromeTabsAdapter, createExtensionStatus, handleTabAction, toBrowserTab } from "../src/extension-core";

function createTabs(): ChromeTabsAdapter {
  return {
    create: vi.fn().mockResolvedValue({ id: 7, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0, pinned: false }),
    query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0, pinned: false }]),
    update: vi.fn().mockResolvedValue({ id: 7, url: "https://example.com/", title: "Example", active: true, windowId: 1, index: 0, pinned: false }),
    reload: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
  };
}

describe("extension tab controller", () => {
  it("exposes only the documented capabilities", () => {
    expect(createExtensionStatus("1.0.0")).toMatchObject({ available: true, version: "1.0.0" });
    expect(createExtensionStatus("1.0.0").capabilities).not.toContain("evaluate");
  });

  it("opens normalized real-browser tabs with explicit options", async () => {
    const tabs = createTabs();
    await expect(handleTabAction(tabs, "open", { url: "example.com", pinned: true, active: false })).resolves.toMatchObject({ tab: { id: 7 } });
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://example.com/", active: false, pinned: true });
  });

  it("manages navigation and tab lifecycle without page execution", async () => {
    const tabs = createTabs();
    await handleTabAction(tabs, "navigate", { tabId: 7, url: "https://example.org" });
    await handleTabAction(tabs, "reload", { tabId: 7 });
    await handleTabAction(tabs, "mute", { tabId: 7, muted: true });
    await handleTabAction(tabs, "close", { tabId: 7 });
    expect(tabs.update).toHaveBeenCalledWith(7, { url: "https://example.org/" });
    expect(tabs.update).toHaveBeenCalledWith(7, { muted: true });
    expect(tabs.reload).toHaveBeenCalledWith(7);
    expect(tabs.remove).toHaveBeenCalledWith(7);
  });

  it("rejects malformed tab records", () => {
    expect(() => toBrowserTab({ url: "https://example.com" })).toThrow("without an identifier");
  });
});
