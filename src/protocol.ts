export const BRIDGE_CHANNEL = "real-browser-web/v2";
export const BRIDGE_VERSION = 2;

export const TAB_ACTIONS = [
  "status",
  "subscribe",
  "workspaceCreate",
  "workspaceGet",
  "workspaceList",
  "workspaceOpen",
  "workspaceNavigate",
  "workspaceActivate",
  "workspaceReload",
  "workspaceBack",
  "workspaceForward",
  "workspaceRename",
  "workspacePinTab",
  "workspaceMuteTab",
  "workspaceDuplicateTab",
  "workspaceCloseTab",
  "workspaceClose",
  "workspaceSetAgentControl",
  "workspaceScreenshot",
  "workspaceInput",
  "agentExecute",
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

/** A set of tabs created by the extension for one approved web-app origin. */
export type ManagedBrowserWorkspace = {
  id: string;
  origin: string;
  groupId: number | null;
  label: string;
  tabIds: number[];
  activeTabId: number | null;
  agentControlEnabled: boolean;
  createdAt: number;
};

/** A read-only view suitable for monitoring, logging, and AI planning loops. */
export type ManagedWorkspaceSnapshot = {
  workspace: ManagedBrowserWorkspace;
  tabs: BrowserTab[];
  capturedAt: number;
};

export type BrowserEvent =
  | { type: "workspace-created"; workspace: ManagedBrowserWorkspace; tab: BrowserTab }
  | { type: "workspace-updated"; workspace: ManagedBrowserWorkspace }
  | { type: "workspace-closed"; workspaceId: string; reason: string }
  | { type: "workspace-tab-opened"; workspaceId: string; tab: BrowserTab }
  | { type: "workspace-tab-updated"; workspaceId: string; tab: BrowserTab }
  | { type: "workspace-tab-activated"; workspaceId: string; tab: BrowserTab }
  | { type: "workspace-tab-removed"; workspaceId: string; tabId: number };

export type SharedTabScreenshot = {
  tabId: number;
  dataUrl: string;
  capturedAt: number;
};

/** Negotiates a visual quality/speed trade-off for a shared browser frame. */
export type SharedTabScreenshotOptions = {
  format?: "jpeg" | "png";
  quality?: number;
};

export type SharedTabInput =
  | { kind: "pointer"; type: "mouseMoved" | "mousePressed" | "mouseReleased"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "key"; type: "keyDown" | "keyUp" | "char"; key: string; code?: string; modifiers?: number; location?: number }
  | { kind: "text"; text: string };

export type AgentOperation =
  | { type: "open"; url: string; active?: boolean }
  | { type: "navigate"; tabId: number; url: string }
  | { type: "activate"; tabId: number }
  | { type: "reload"; tabId: number }
  | { type: "back"; tabId: number }
  | { type: "forward"; tabId: number }
  | { type: "duplicate"; tabId: number; active?: boolean }
  | { type: "pin"; tabId: number; pinned: boolean }
  | { type: "mute"; tabId: number; muted: boolean }
  | { type: "close"; tabId: number }
  | { type: "screenshot"; tabId?: number }
  | { type: "input"; tabId?: number; input: SharedTabInput };

export type ExtensionStatus = {
  available: true;
  version: string;
  capabilities: readonly TabAction[];
  model: "managed-workspace";
  privacy: "origin-isolated";
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
  extensionVersion: string;
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

export function isBridgeReady(value: unknown): value is BridgeReady {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.kind === "ready"
    && typeof value.extensionVersion === "string";
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
