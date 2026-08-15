import { describe, expect, it, vi } from "vitest";
import { ensureSiteBridge } from "../src/extension-bridge-activation";

describe("ensureSiteBridge", () => {
  it("injects bridge.js and verifies its ready marker on an HTTP(S) web app page", async () => {
    const executeScript = vi.fn().mockResolvedValueOnce([{ result: false }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ result: true }]);
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "https://app.example.com/" }) },
      scripting: { executeScript },
    }, 17);
    expect(result).toEqual({ supported: true, injected: true, ready: true, url: "https://app.example.com/", attempts: 1 });
    expect(executeScript).toHaveBeenNthCalledWith(2, expect.objectContaining({ target: { tabId: 17 }, files: ["bridge.js"], injectImmediately: true }));
    expect(executeScript).toHaveBeenCalledTimes(3);
  });

  it("keeps the bridge injection out of the hot path when its marker already exists", async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: true }]);
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "https://app.example.com/" }) },
      scripting: { executeScript },
    }, 17);
    expect(result).toEqual({ supported: true, injected: false, ready: true, url: "https://app.example.com/", attempts: 1 });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).not.toHaveBeenCalledWith(expect.objectContaining({ files: ["bridge.js"] }));
  });

  it("retries a late bridge marker without reinjecting the file", async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{ result: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ result: false }])
      .mockResolvedValueOnce([{ result: true }]);
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "https://app.example.com/" }) },
      scripting: { executeScript },
    }, 17, { probeAttempts: 2, probeDelayMs: 0 });
    expect(result).toMatchObject({ injected: true, ready: true, attempts: 2 });
    expect(executeScript).toHaveBeenCalledTimes(4);
  });

  it("does not inject into a browser-internal page and reports its diagnostic state", async () => {
    const executeScript = vi.fn();
    const result = await ensureSiteBridge({
      tabs: { get: vi.fn().mockResolvedValue({ url: "chrome://extensions/" }) },
      scripting: { executeScript },
    }, 22);
    expect(result).toEqual({ supported: false, injected: false, ready: false, url: "chrome://extensions/", attempts: 0 });
    expect(executeScript).not.toHaveBeenCalled();
  });
});
