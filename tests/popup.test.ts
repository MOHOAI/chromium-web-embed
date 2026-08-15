// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const popupHtml = await readFile(resolve(process.cwd(), "extension/popup.html"), "utf8");
const popupSource = await readFile(resolve(process.cwd(), "extension/popup.js"), "utf8");

async function mountPopup(url: string, bridge: { supported: boolean; ready: boolean; error?: string }, workspace: unknown = null) {
  document.documentElement.innerHTML = popupHtml;
  const sendMessage = vi.fn(async (message: { action: string }) => {
    if (message.action === "ensure-site-bridge") return { ok: !bridge.error, ...bridge };
    if (message.action === "workspace-status") return { ok: true, workspace };
    if (message.action === "close-workspace") return { ok: true };
    return { ok: false };
  });
  vi.stubGlobal("chrome", {
    tabs: { query: vi.fn(async () => [{ id: 27, url }]) },
    runtime: { sendMessage },
  });
  const encoded = Buffer.from(`${popupSource}\n// test-run ${Date.now()}-${Math.random()}`).toString("base64");
  await import(`data:text/javascript;base64,${encoded}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { sendMessage, bridgeText: document.querySelector("#bridge-status")?.textContent ?? "", statusText: document.querySelector("#status")?.textContent ?? "" };
}

describe("نافذة إضافة المتصفح المُدار", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = "";
  });

  it("تعلن أن جسر الموقع جاهز فوق تطبيق HTTPS وتعرض حالة مساحة التطبيق", async () => {
    const result = await mountPopup("https://app.example.test/dashboard", { supported: true, ready: true }, { label: "تطبيق الاختبار", tabIds: [11, 12], agentControlEnabled: false });
    expect(result.bridgeText).toContain("جسر الاتصال جاهز");
    expect(result.statusText).toContain("المساحة المتصلة جاهزة");
    expect(document.querySelector("#workspace-status")?.textContent).toContain("تطبيق الاختبار");
    expect(result.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: "ensure-site-bridge", tabId: 27 }));
  });

  it("يعرض تشخيصًا واضحًا عند فتح النافذة فوق صفحة خارج نطاق HTTP أو HTTPS", async () => {
    const result = await mountPopup("chrome://extensions", { supported: false, ready: false });
    expect(result.statusText).toContain("HTTP أو HTTPS");
  });
});
