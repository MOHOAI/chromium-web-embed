import { ChromeLikeTab, createExtensionStatus, handleTabAction, toBrowserTab } from "./extension-core";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, BridgeEvent, BridgeResponse, isBridgeCommand } from "./protocol";

declare const chrome: any;

const EXTENSION_VERSION = "1.0.0";
const subscriberTabIds = new Set<number>();

function response(requestId: string, ok: boolean, result?: unknown, error?: string): BridgeResponse {
  return { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "response", requestId, ok, ...(ok ? { result } : { error }) };
}

async function broadcast(event: BridgeEvent["event"]): Promise<void> {
  const message: BridgeEvent = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "event", event };
  await Promise.all([...subscriberTabIds].map(async (tabId) => {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      subscriberTabIds.delete(tabId);
    }
  }));
}

chrome.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number } }, sendResponse: (payload: BridgeResponse) => void) => {
  if (!isBridgeCommand(message)) return;
  void (async () => {
    try {
      if (message.action === "status") return response(message.requestId, true, createExtensionStatus(EXTENSION_VERSION));
      if (message.action === "subscribe") {
        const siteTabId = sender.tab?.id;
        if (!Number.isInteger(siteTabId)) throw new Error("Subscriptions are only allowed from an approved web page.");
        subscriberTabIds.add(siteTabId as number);
        return response(message.requestId, true, { subscribed: true });
      }
      const result = await handleTabAction(chrome.tabs, message.action, message.data);
      return response(message.requestId, true, result);
    } catch (error) {
      return response(message.requestId, false, undefined, error instanceof Error ? error.message : "The extension could not complete the command.");
    }
  })().then(sendResponse);
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId: number, _changeInfo: unknown, tab: ChromeLikeTab) => {
  if (!Number.isInteger(tab.id)) return;
  await broadcast({ type: "updated", tab: toBrowserTab(tab) });
});

chrome.tabs.onActivated.addListener(async ({ tabId }: { tabId: number }) => {
  try {
    const tab = await chrome.tabs.get(tabId) as ChromeLikeTab;
    await broadcast({ type: "activated", tab: toBrowserTab(tab) });
  } catch {
    // A tab can disappear while Chrome processes the activation event.
  }
});

chrome.tabs.onRemoved.addListener(async (tabId: number) => {
  await broadcast({ type: "removed", tabId });
});
