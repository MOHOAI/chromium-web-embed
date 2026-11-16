export const BRIDGE_CHANNEL = "real-browser-web/v4" as const;
export const LEGACY_BRIDGE_CHANNELS = ["real-browser-web/v3"] as const;
export const BRIDGE_VERSION = 4 as const;

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
  "workspaceZoomScreenshot",
  "workspaceCursorPosition",
  "workspaceInput",
  "workspaceInteractiveElements",
  "workspacePageText",
  "workspaceWindowMode",
  "workspaceSetZoom",
  "workspacePrintPdf",
  "agentExecute",
] as const;

export type TabAction = (typeof TAB_ACTIONS)[number];

export type CoordinateSpace = "normalized_1000" | "pixels";
export type MouseButton = "left" | "right" | "middle";
export type ModifierKey = "shift" | "ctrl" | "alt" | "meta" | "super";
export type ScrollDirection = "up" | "down" | "left" | "right";
export type ComputerUseEnvironment = "browser" | "mobile" | "desktop";
export type BrowserWindowMode = "normal" | "maximized" | "minimized" | "fullscreen";

export type SafetyPolicyCategory =
  | "FINANCIAL_TRANSACTIONS"
  | "SENSITIVE_DATA_MODIFICATION"
  | "COMMUNICATION_TOOL"
  | "ACCOUNT_CREATION"
  | "DATA_MODIFICATION"
  | "USER_CONSENT_MANAGEMENT"
  | "LEGAL_TERMS_AND_AGREEMENTS";

export interface SafetyDecision {
  decision: "allowed" | "require_confirmation" | "blocked";
  explanation?: string;
  category?: SafetyPolicyCategory | string;
  id?: string;
}

export interface BrowserTab {
  id: number;
  windowId: number;
  groupId?: number;
  url: string;
  title: string;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  status?: "loading" | "complete";
  favIconUrl?: string;
}

export interface ManagedBrowserWorkspace {
  id: string;
  origin: string;
  groupId: number;
  label: string;
  tabIds: number[];
  activeTabId: number | null;
  agentControlEnabled: boolean;
  createdAt: number;
}

export interface ManagedWorkspaceSnapshot {
  workspace: ManagedBrowserWorkspace;
  tabs: BrowserTab[];
  activeTab: BrowserTab | null;
}

export interface InteractiveDomElement {
  index: number;
  tag: string;
  role: string;
  type?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  text: string;
  href?: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  normalizedCenter: { x: number; y: number };
  disabled?: boolean;
  checked?: boolean;
}

export interface BrowserEvent {
  type:
    | "workspace.created"
    | "workspace.updated"
    | "workspace.closed"
    | "tab.created"
    | "tab.updated"
    | "tab.activated"
    | "tab.removed"
    | "agent.action"
    | "agent.safety_prompt";
  workspaceId: string;
  tabId?: number;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface SharedTabScreenshot {
  tabId: number;
  url: string;
  title: string;
  format: "png" | "jpeg";
  mimeType: "image/png" | "image/jpeg";
  dataUrl: string;
  base64: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  capturedAt: number;
}

export interface SharedTabInput {
  type: "pointer" | "wheel" | "key" | "text";
  action?:
    | "move"
    | "down"
    | "up"
    | "click"
    | "dblclick"
    | "tripleclick"
    | "rightclick"
    | "middleclick"
    | "keyDown"
    | "keyUp"
    | "press";
  x?: number;
  y?: number;
  button?: MouseButton;
  clickCount?: number;
  modifiers?: ModifierKey[];
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
}

export type UnifiedComputerAction =
  | {
      type: "click" | "double_click" | "triple_click" | "middle_click" | "right_click" | "mouse_down" | "mouse_up" | "move";
      x?: number;
      y?: number;
      coordinateSpace?: CoordinateSpace;
      modifiers?: ModifierKey[];
      intent?: string;
    }
  | {
      type: "long_press";
      x: number;
      y: number;
      seconds?: number;
      coordinateSpace?: CoordinateSpace;
      intent?: string;
    }
  | {
      type: "type";
      text: string;
      x?: number;
      y?: number;
      coordinateSpace?: CoordinateSpace;
      pressEnter?: boolean;
      clearFirst?: boolean;
      intent?: string;
    }
  | {
      type: "drag_and_drop";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      path?: Array<{ x: number; y: number }>;
      coordinateSpace?: CoordinateSpace;
      modifiers?: ModifierKey[];
      intent?: string;
    }
  | {
      type: "press_key" | "key_down" | "key_up";
      key: string;
      repeat?: number;
      modifiers?: ModifierKey[];
      intent?: string;
    }
  | {
      type: "hold_key";
      key: string;
      seconds: number;
      modifiers?: ModifierKey[];
      intent?: string;
    }
  | {
      type: "hotkey";
      keys: string[];
      intent?: string;
    }
  | {
      type: "scroll";
      x?: number;
      y?: number;
      direction?: ScrollDirection;
      magnitudeInPixels?: number;
      deltaX?: number;
      deltaY?: number;
      coordinateSpace?: CoordinateSpace;
      modifiers?: ModifierKey[];
      intent?: string;
    }
  | {
      type: "scroll_to";
      target: "top" | "bottom" | "selector";
      selector?: string;
      intent?: string;
    }
  | {
      type: "click_selector";
      selector: string;
      intent?: string;
    }
  | {
      type: "type_selector";
      selector: string;
      text: string;
      pressEnter?: boolean;
      clearFirst?: boolean;
      intent?: string;
    }
  | {
      type: "select_option";
      selector: string;
      value: string;
      intent?: string;
    }
  | {
      type: "find_in_page";
      query: string;
      intent?: string;
    }
  | {
      type: "window_mode";
      mode?: BrowserWindowMode;
      zoomFactor?: number;
      intent?: string;
    }
  | {
      type: "navigate";
      url: string;
      intent?: string;
    }
  | {
      type: "go_back" | "go_forward" | "reload" | "take_screenshot" | "cursor_position";
      intent?: string;
    }
  | {
      type: "zoom";
      region: [number, number, number, number];
      coordinateSpace?: CoordinateSpace;
      intent?: string;
    }
  | {
      type: "wait";
      seconds?: number;
      intent?: string;
    };

export interface AgentOperation {
  action: UnifiedComputerAction | Record<string, unknown>;
  tabId?: number;
  provider?: "gemini" | "anthropic" | "openai" | "generic";
  callId?: string;
  intent?: string;
  safetyDecision?: SafetyDecision;
  safetyAcknowledged?: boolean;
}

export interface AgentExecutionResult {
  ok: boolean;
  actionType: string;
  tabId: number;
  url: string;
  title?: string;
  cursorPosition?: { x: number; y: number };
  screenshot?: SharedTabScreenshot;
  data?: unknown;
  safetyAcknowledgement?: boolean;
  error?: string;
  durationMs: number;
}

export interface ExtensionStatus {
  installed: boolean;
  version: string;
  bridgeVersion: number;
  channel: string;
  capabilities: string[];
}

export interface BridgeCommand {
  channel: typeof BRIDGE_CHANNEL | (typeof LEGACY_BRIDGE_CHANNELS)[number];
  id: string;
  action: TabAction;
  payload?: Record<string, unknown>;
}

export interface BridgeResponse {
  channel: typeof BRIDGE_CHANNEL | (typeof LEGACY_BRIDGE_CHANNELS)[number];
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function isBridgeCommand(value: unknown): value is BridgeCommand {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const validChannel =
    record.channel === BRIDGE_CHANNEL ||
    (LEGACY_BRIDGE_CHANNELS as readonly string[]).includes(String(record.channel));
  return (
    validChannel &&
    typeof record.id === "string" &&
    typeof record.action === "string" &&
    (TAB_ACTIONS as readonly string[]).includes(record.action)
  );
}
