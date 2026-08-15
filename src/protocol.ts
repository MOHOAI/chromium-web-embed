export const BRIDGE_CHANNEL = "real-browser-web/v1";
export const BRIDGE_VERSION = 1;

export const TAB_ACTIONS = [
  "status",
  "subscribe",
  "open",
  "list",
  "active",
  "navigate",
  "activate",
  "reload",
  "back",
  "forward",
  "close",
  "pin",
  "mute",
  "shared",
  "screenshot",
  "input",
  "stopShare",
] as const;

export type TabAction = (typeof TAB_ACTIONS)[number];

export type BrowserTab = {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  index: number;
  status?: "loading" | "complete";
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  favIconUrl?: string;
};

export type BrowserEvent =
  | { type: "updated"; tab: BrowserTab }
  | { type: "activated"; tab: BrowserTab }
  | { type: "removed"; tabId: number }
  | { type: "share-started"; tab: BrowserTab }
  | { type: "share-stopped"; tabId: number; reason: string };

export type SharedTabScreenshot = {
  tabId: number;
  dataUrl: string;
  capturedAt: number;
};

export type SharedTabInput =
  | { kind: "pointer"; type: "mouseMoved" | "mousePressed" | "mouseReleased"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; type: "keyDown" | "keyUp" | "char"; key: string; code?: string; modifiers?: number }
  | { kind: "text"; text: string };

export type ExtensionStatus = {
  available: true;
  version: string;
  capabilities: readonly TabAction[];
};

export type BridgeCommand = {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  kind: "command";
  requestId: string;
  action: TabAction;
  data?: Record<string, unknown>;
};

export type BridgeResponse<T = unknown> = {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: T;
  error?: string;
};

export type BridgeEvent = {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  kind: "event";
  event: BrowserEvent;
};

export type BridgeReady = {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  kind: "ready";
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTabAction(value: unknown): value is TabAction {
  return typeof value === "string" && (TAB_ACTIONS as readonly string[]).includes(value);
}

export function isBridgeCommand(value: unknown): value is BridgeCommand {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.kind === "command"
    && typeof value.requestId === "string"
    && isTabAction(value.action)
    && (value.data === undefined || isRecord(value.data));
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.kind === "response"
    && typeof value.requestId === "string"
    && typeof value.ok === "boolean";
}

export function isBridgeEvent(value: unknown): value is BridgeEvent {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.kind === "event"
    && isRecord(value.event)
    && typeof value.event.type === "string";
}

export function normalizeTabUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new TypeError("A URL is required.");
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:/i.test(input)) {
    throw new TypeError("Only HTTP and HTTPS URLs are supported.");
  }
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Only HTTP and HTTPS URLs are supported.");
  }
  return url.href;
}
