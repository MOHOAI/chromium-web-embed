import { describe, expect, it, vi } from "vitest";
import { ensureSiteBridge } from "../src/extension-bridge-activation";

describe("ensureSiteBridge", () => {
  it("injects bridge.js and verifies its ready marker on an HTTP(S) web app page", async () => {
    const executeScript = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: true }]);
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "https://app.example.com/" }) },
      scripting: { executeScript },
    }, 17);
    expect(result).toEqual({ supported: true, injected: true, ready: true, url: "https://app.example.com/" });
    expect(executeScript).toHaveBeenNthCalledWith(1, expect.objectContaining({ target: { tabId: 17 }, files: ["bridge.js"], injectImmediately: true }));
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("does not inject into a browser-internal page and reports its diagnostic state", async () => {
    const executeScript = vi.fn();
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "chrome://extensions/" }) },
      scripting: { executeScript },
    }, 22);
    expect(result).toEqual({ supported: false, injected: false, ready: false, url: "chrome://extensions/" });
    expect(executeScript).not.toHaveBeenCalled();
  });
});
