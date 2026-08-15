import { BrowserTab, ExtensionStatus, TAB_ACTIONS, TabAction, isRecord, normalizeTabUrl } from "./protocol";

export type ChromeLikeTab = {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  index?: number;
  status?: "loading" | "complete";
  pinned?: boolean;
  audible?: boolean;
  mutedInfo?: { muted?: boolean };
  favIconUrl?: string;
};

export type ChromeTabsAdapter = {
  create(createProperties: Record<string, unknown>): Promise<ChromeLikeTab>;
  query(queryInfo: Record<string, unknown>): Promise<ChromeLikeTab[]>;
  update(tabId: number, updateProperties: Record<string, unknown>): Promise<ChromeLikeTab>;
  reload(tabId: number): Promise<void>;
  remove(tabId: number): Promise<void>;
  goBack?: (tabId: number) => Promise<void>;
  goForward?: (tabId: number) => Promise<void>;
};

export function toBrowserTab(tab: ChromeLikeTab): BrowserTab {
  if (!Number.isInteger(tab.id)) throw new Error("Chrome returned a tab without an identifier.");
  const id = tab.id as number;
  const windowId = Number.isInteger(tab.windowId) ? tab.windowId as number : -1;
  const index = Number.isInteger(tab.index) ? tab.index as number : -1;
  return {
    id,
    url: tab.url ?? tab.pendingUrl ?? "",
    title: tab.title ?? "",
    active: Boolean(tab.active),
    windowId,
    index,
    ...(tab.status ? { status: tab.status } : {}),
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.mutedInfo?.muted),
    audible: Boolean(tab.audible),
    ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
  };
}

function record(data: unknown): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

function tabId(data: unknown): number {
  const id = record(data).tabId;
  if (!Number.isInteger(id)) throw new TypeError("A numeric tabId is required.");
  return id as number;
}

function booleanValue(data: unknown, key: string, fallback?: boolean): boolean | undefined {
  const value = record(data)[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${key} must be a boolean.`);
  return value;
}

function numberValue(data: unknown, key: string): number | undefined {
  const value = record(data)[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new TypeError(`${key} must be an integer.`);
  return value as number;
}

function urlValue(data: unknown): string {
  const value = record(data).url;
  if (typeof value !== "string") throw new TypeError("A URL is required.");
  return normalizeTabUrl(value);
}

export function createExtensionStatus(version: string): ExtensionStatus {
  return { available: true, version, capabilities: TAB_ACTIONS };
}

export async function handleTabAction(
  tabs: ChromeTabsAdapter,
  action: Exclude<TabAction, "status" | "subscribe" | "shared" | "screenshot" | "input" | "stopShare">,
  data?: Record<string, unknown>,
): Promise<unknown> {
  if (action === "open") {
    const tab = await tabs.create({
      url: urlValue(data),
      active: booleanValue(data, "active", true),
      pinned: booleanValue(data, "pinned", false),
      ...(numberValue(data, "index") !== undefined ? { index: numberValue(data, "index") } : {}),
    });
    return { tab: toBrowserTab(tab) };
  }

  if (action === "list") {
    const currentWindow = booleanValue(data, "currentWindow", true);
    const tabsInWindow = await tabs.query(currentWindow ? { currentWindow: true } : {});
    return { tabs: tabsInWindow.filter((tab) => Number.isInteger(tab.id)).map(toBrowserTab) };
  }

  if (action === "active") {
    const [active] = await tabs.query({ active: true, lastFocusedWindow: true });
    return { tab: active && Number.isInteger(active.id) ? toBrowserTab(active) : null };
  }

  const id = tabId(data);
  if (action === "navigate") return { tab: toBrowserTab(await tabs.update(id, { url: urlValue(data) })) };
  if (action === "activate") return { tab: toBrowserTab(await tabs.update(id, { active: true })) };
  if (action === "pin") return { tab: toBrowserTab(await tabs.update(id, { pinned: booleanValue(data, "pinned", true) })) };
  if (action === "mute") return { tab: toBrowserTab(await tabs.update(id, { muted: booleanValue(data, "muted", true) })) };
  if (action === "reload") {
    await tabs.reload(id);
    return { ok: true };
  }
  if (action === "close") {
    await tabs.remove(id);
    return { ok: true };
  }
  if (action === "back") {
    if (!tabs.goBack) throw new Error("Back navigation is not supported by this Chrome version.");
    await tabs.goBack(id);
    return { ok: true };
  }
  if (action === "forward") {
    if (!tabs.goForward) throw new Error("Forward navigation is not supported by this Chrome version.");
    await tabs.goForward(id);
    return { ok: true };
  }
  throw new Error(`Unsupported action: ${action satisfies never}`);
}
