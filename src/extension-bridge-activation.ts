import { isSupportedWebAppUrl } from "./extension-bridge-policy";

type SiteTab = { url?: string; pendingUrl?: string };
type ScriptResult = { result?: unknown };

export type BridgeActivationApi = {
  tabs: { get(tabId: number): Promise<SiteTab> };
  scripting: {
    executeScript(options: Record<string, unknown>): Promise<ScriptResult[]>;
  };
};

export type BridgeActivationOptions = { probeAttempts?: number; probeDelayMs?: number };
export type BridgeActivationResult = { supported: boolean; injected: boolean; ready: boolean; url: string; attempts: number };

const bridgeProbe = () => Boolean((globalThis as typeof globalThis & { __realBrowserWebBridgeInstalled?: boolean }).__realBrowserWebBridgeInstalled);
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Injects and verifies the bridge only on origins bundled in the extension manifest. */
export async function ensureSiteBridge(api: BridgeActivationApi, tabId: number, options: BridgeActivationOptions = {}): Promise<BridgeActivationResult> {
  const tab = await api.tabs.get(tabId);
  const url = tab.url ?? tab.pendingUrl ?? "";
  if (!isSupportedWebAppUrl(url)) return { supported: false, injected: false, ready: false, url, attempts: 0 };
  const attempts = Math.max(1, Math.min(5, Math.round(options.probeAttempts ?? 3)));
  const pause = Math.max(0, Math.min(1_000, Math.round(options.probeDelayMs ?? 50)));
  const probe = () => api.scripting.executeScript({ target: { tabId }, func: bridgeProbe, injectImmediately: true });
  if (await probe().then((result) => result[0]?.result === true).catch(() => false)) return { supported: true, injected: false, ready: true, url, attempts: 1 };
  await api.scripting.executeScript({ target: { tabId }, files: ["bridge.js"], injectImmediately: true });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await probe().then((result) => result[0]?.result === true).catch(() => false)) return { supported: true, injected: true, ready: true, url, attempts: attempt };
    if (attempt < attempts && pause > 0) await delay(pause);
  }
  return { supported: true, injected: true, ready: false, url, attempts };
}
