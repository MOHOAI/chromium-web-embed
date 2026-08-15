import { isSupportedWebAppUrl } from "./extension-bridge-policy";

type SiteTab = { url?: string; pendingUrl?: string };
type ScriptResult = { result?: unknown };

export type BridgeActivationApi = {
  tabs: { get(tabId: number): Promise<SiteTab> };
  scripting: {
    executeScript(options: Record<string, unknown>): Promise<ScriptResult[]>;
  };
};

export type BridgeActivationResult = { supported: boolean; injected: boolean; ready: boolean; url: string };

/** Injects and verifies the bridge only on origins bundled in the extension manifest. */
export async function ensureSiteBridge(api: BridgeActivationApi, tabId: number): Promise<BridgeActivationResult> {
  const tab = await api.tabs.get(tabId);
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (!isSupportedWebAppUrl(url)) return { supported: false, injected: false, ready: false, url };
  await api.scripting.executeScript({ target: { tabId }, files: ["bridge.js"], injectImmediately: true });
  const probe = await api.scripting.executeScript({
    target: { tabId },
    func: () => Boolean((globalThis as typeof globalThis & { __realBrowserWebBridgeInstalled?: boolean }).__realBrowserWebBridgeInstalled),
    injectImmediately: true,
  });
  return { supported: true, injected: true, ready: probe[0]?.result === true, url };
}
