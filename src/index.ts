import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  type AgentExecutionResult,
  type AgentOperation,
  type BrowserEvent,
  type BrowserTab,
  type BrowserWindowMode,
  type ExtensionStatus,
  type InteractiveDomElement,
  type ManagedBrowserWorkspace,
  type ManagedWorkspaceSnapshot,
  type ModifierKey,
  type ScrollDirection,
  type SharedTabInput,
  type SharedTabScreenshot,
  type TabAction,
  type UnifiedComputerAction,
} from "./protocol.js";
import {
  SafetyPolicyEngine,
  type AgentAuditEntry,
  type SafetyPolicyConfig,
} from "./safety-policy.js";

export * from "./protocol.js";
export * from "./agent-control-policy.js";
export * from "./safety-policy.js";
export * from "./providers/index.js";
export * from "./agent-runner.js";

export interface RealBrowserClientOptions {
  timeoutMs?: number;
  workspaceId?: string;
  label?: string;
}

export interface ConnectionDiagnostic {
  connected: boolean;
  embeddedInIframe: boolean;
  origin: string;
  extensionInstalled: boolean;
  bridgeVersion?: number;
  workspaceId?: string;
  error?: string;
}

export function denormalizeCoordinate(value: number, dimension: number): number {
  const clamped = Math.max(0, Math.min(999, value));
  return Math.round((clamped / 1000) * dimension);
}

export function getEmbeddedApplicationContext(): {
  embeddedInIframe: boolean;
  origin: string;
  href: string;
} {
  if (typeof window === "undefined") {
    return { embeddedInIframe: false, origin: "", href: "" };
  }
  let embeddedInIframe = false;
  try {
    embeddedInIframe = window.self !== window.top;
  } catch {
    embeddedInIframe = true;
  }
  return {
    embeddedInIframe,
    origin: window.location.origin,
    href: window.location.href,
  };
}

export class RealBrowserClient {
  private readonly timeoutMs: number;
  private workspaceId?: string;
  private label?: string;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private eventListeners = new Set<(event: BrowserEvent) => void>();
  private messageListener?: (event: MessageEvent) => void;

  constructor(options: RealBrowserClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.workspaceId = options.workspaceId;
    this.label = options.label;
    this.attachListener();
  }

  private attachListener(): void {
    if (typeof window === "undefined" || this.messageListener) return;
    this.messageListener = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== "object") {
        return;
      }
      const msg = event.data as Record<string, unknown>;
      if (msg.channel !== BRIDGE_CHANNEL && msg.channel !== "real-browser-web/v3") {
        return;
      }
      if (msg.event && typeof msg.event === "object") {
        for (const cb of this.eventListeners) {
          try {
            cb(msg.event as BrowserEvent);
          } catch {
            // ignore listener errors
          }
        }
        return;
      }
      if (typeof msg.id === "string" && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) {
          entry.resolve(msg.data);
        } else {
          entry.reject(new Error(String(msg.error ?? "Extension bridge error")));
        }
      }
    };
    window.addEventListener("message", this.messageListener);
  }

  private request<T = unknown>(
    action: TabAction,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    if (typeof window === "undefined") {
      return Promise.reject(
        new Error("RealBrowserClient requires a browser window environment.")
      );
    }
    this.attachListener();
    const id = `rbe_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request "${action}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          id,
          action,
          payload: {
            ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
            ...payload,
          },
        },
        window.location.origin || "*"
      );
    });
  }

  async status(): Promise<ExtensionStatus> {
    return this.request<ExtensionStatus>("status");
  }

  async waitForExtension(retries = 10, intervalMs = 250): Promise<ExtensionStatus> {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        const st = await this.status();
        if (st?.installed) return st;
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Moho Browser Workspace extension did not respond.");
  }

  async connect(): Promise<ExtensionStatus> {
    const st = await this.waitForExtension();
    await this.request("subscribe");
    return st;
  }

  async createWorkspace(options?: {
    url?: string;
    label?: string;
    agentControlEnabled?: boolean;
  }): Promise<ManagedBrowserWorkspace> {
    const ws = await this.request<ManagedBrowserWorkspace>("workspaceCreate", {
      label: options?.label ?? this.label ?? "AI Workspace",
      url: options?.url,
      agentControlEnabled: options?.agentControlEnabled ?? false,
    });
    this.workspaceId = ws.id;
    return ws;
  }

  async reconnect(workspaceId?: string): Promise<ManagedBrowserWorkspace> {
    const ws = await this.request<ManagedBrowserWorkspace>("workspaceGet", {
      workspaceId: workspaceId ?? this.workspaceId,
    });
    this.workspaceId = ws.id;
    return ws;
  }

  async workspace(): Promise<ManagedBrowserWorkspace> {
    return this.request<ManagedBrowserWorkspace>("workspaceGet");
  }

  async listWorkspaceTabs(): Promise<BrowserTab[]> {
    return this.request<BrowserTab[]>("workspaceList");
  }

  async workspaceSnapshot(): Promise<ManagedWorkspaceSnapshot> {
    return this.request<ManagedWorkspaceSnapshot>("workspaceGet", {
      includeTabs: true,
    });
  }

  async openInWorkspace(url: string, active = true): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspaceOpen", { url, active });
  }

  async navigateInWorkspace(url: string, tabId?: number): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspaceNavigate", { url, tabId });
  }

  async activateInWorkspace(tabId: number): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspaceActivate", { tabId });
  }

  async reloadInWorkspace(tabId?: number): Promise<void> {
    await this.request("workspaceReload", { tabId });
  }

  async backInWorkspace(tabId?: number): Promise<void> {
    await this.request("workspaceBack", { tabId });
  }

  async forwardInWorkspace(tabId?: number): Promise<void> {
    await this.request("workspaceForward", { tabId });
  }

  async renameWorkspace(label: string): Promise<ManagedBrowserWorkspace> {
    return this.request<ManagedBrowserWorkspace>("workspaceRename", { label });
  }

  async pinWorkspaceTab(tabId: number, pinned = true): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspacePinTab", { tabId, pinned });
  }

  async muteWorkspaceTab(tabId: number, muted = true): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspaceMuteTab", { tabId, muted });
  }

  async duplicateWorkspaceTab(tabId: number): Promise<BrowserTab> {
    return this.request<BrowserTab>("workspaceDuplicateTab", { tabId });
  }

  async closeWorkspaceTab(tabId: number): Promise<void> {
    await this.request("workspaceCloseTab", { tabId });
  }

  async closeWorkspace(): Promise<void> {
    await this.request("workspaceClose");
    this.workspaceId = undefined;
  }

  async setAgentControl(enabled: boolean): Promise<ManagedBrowserWorkspace> {
    return this.request<ManagedBrowserWorkspace>("workspaceSetAgentControl", {
      enabled,
    });
  }

  async screenshot(options?: {
    tabId?: number;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<SharedTabScreenshot> {
    return this.request<SharedTabScreenshot>("workspaceScreenshot", options ?? {});
  }

  async zoomScreenshot(
    region: [number, number, number, number],
    options?: { tabId?: number; coordinateSpace?: "normalized_1000" | "pixels" }
  ): Promise<SharedTabScreenshot> {
    return this.request<SharedTabScreenshot>("workspaceZoomScreenshot", {
      region,
      coordinateSpace: options?.coordinateSpace ?? "pixels",
      tabId: options?.tabId,
    });
  }

  async cursorPosition(tabId?: number): Promise<{ x: number; y: number }> {
    return this.request<{ x: number; y: number }>("workspaceCursorPosition", {
      tabId,
    });
  }

  async getInteractiveElements(tabId?: number): Promise<InteractiveDomElement[]> {
    return this.request<InteractiveDomElement[]>("workspaceInteractiveElements", {
      tabId,
    });
  }

  async getPageText(tabId?: number): Promise<{ title: string; url: string; text: string }> {
    return this.request<{ title: string; url: string; text: string }>(
      "workspacePageText",
      { tabId }
    );
  }

  async setWindowMode(mode: BrowserWindowMode, tabId?: number): Promise<void> {
    await this.request("workspaceWindowMode", { mode, tabId });
  }

  async setZoom(zoomFactor: number, tabId?: number): Promise<{ zoomFactor: number }> {
    return this.request<{ zoomFactor: number }>("workspaceSetZoom", {
      zoomFactor,
      tabId,
    });
  }

  async printPdf(tabId?: number): Promise<{ base64: string; mimeType: "application/pdf" }> {
    return this.request<{ base64: string; mimeType: "application/pdf" }>(
      "workspacePrintPdf",
      { tabId }
    );
  }

  async waitForSelector(
    selector: string,
    options?: { timeoutMs?: number; tabId?: number }
  ): Promise<{ found: boolean; elapsedMs: number }> {
    return this.request<{ found: boolean; elapsedMs: number }>(
      "workspaceWaitForSelector",
      { selector, timeoutMs: options?.timeoutMs, tabId: options?.tabId }
    );
  }

  async getStorage(
    key?: string,
    options?: { storageType?: "local" | "session"; tabId?: number }
  ): Promise<{ value?: string | null; items?: Record<string, string> }> {
    return this.request("workspaceStorage", {
      op: "get",
      key,
      storageType: options?.storageType ?? "local",
      tabId: options?.tabId,
    });
  }

  async setStorage(
    key: string,
    value: string,
    options?: { storageType?: "local" | "session"; tabId?: number }
  ): Promise<void> {
    await this.request("workspaceStorage", {
      op: "set",
      key,
      value,
      storageType: options?.storageType ?? "local",
      tabId: options?.tabId,
    });
  }

  async input(input: SharedTabInput, tabId?: number): Promise<void> {
    await this.request("workspaceInput", { input, tabId });
  }

  async typeText(text: string, tabId?: number): Promise<void> {
    await this.input({ type: "text", text }, tabId);
  }

  async pressKey(key: string, tabId?: number): Promise<void> {
    await this.input({ type: "key", action: "press", key }, tabId);
  }

  async agentExecute(operation: AgentOperation): Promise<AgentExecutionResult> {
    return this.request<AgentExecutionResult>(
      "agentExecute",
      operation as unknown as Record<string, unknown>
    );
  }

  async getConnectionDiagnostic(): Promise<ConnectionDiagnostic> {
    const ctx = getEmbeddedApplicationContext();
    try {
      const st = await this.status();
      return {
        connected: Boolean(st.installed),
        embeddedInIframe: ctx.embeddedInIframe,
        origin: ctx.origin,
        extensionInstalled: Boolean(st.installed),
        bridgeVersion: st.bridgeVersion ?? BRIDGE_VERSION,
        workspaceId: this.workspaceId,
      };
    } catch (err) {
      return {
        connected: false,
        embeddedInIframe: ctx.embeddedInIframe,
        origin: ctx.origin,
        extensionInstalled: false,
        workspaceId: this.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  onTabEvent(listener: (event: BrowserEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  dispose(): void {
    if (typeof window !== "undefined" && this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = undefined;
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("RealBrowserClient disposed"));
    }
    this.pending.clear();
    this.eventListeners.clear();
  }
}

export function createEmbeddedBrowserClient(
  options?: RealBrowserClientOptions
): RealBrowserClient {
  return new RealBrowserClient(options);
}

export type RenderProfile = "responsive" | "balanced" | "sharp";

const RENDER_PROFILE_CONFIG: Record<
  RenderProfile,
  { intervalMs: number; format: "png" | "jpeg"; quality?: number }
> = {
  responsive: { intervalMs: 180, format: "jpeg", quality: 58 },
  balanced: { intervalMs: 300, format: "jpeg", quality: 78 },
  sharp: { intervalMs: 450, format: "png" },
};

export interface SharedTabViewerOptions {
  client: RealBrowserClient;
  container: HTMLElement;
  tabId?: number;
  renderProfile?: RenderProfile;
  intervalMs?: number;
  pauseWhenHidden?: boolean;
}

export class SharedTabViewer {
  private readonly client: RealBrowserClient;
  private readonly container: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly profile: RenderProfile;
  private readonly intervalMs: number;
  private readonly pauseWhenHidden: boolean;
  private tabId?: number;
  private timer?: ReturnType<typeof setInterval>;
  private lastShot?: SharedTabScreenshot;
  private readonly onClick: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(options: SharedTabViewerOptions) {
    this.client = options.client;
    this.container = options.container;
    this.tabId = options.tabId;
    this.profile = options.renderProfile ?? "balanced";
    const cfg = RENDER_PROFILE_CONFIG[this.profile];
    this.intervalMs = Math.max(120, options.intervalMs ?? cfg.intervalMs);
    this.pauseWhenHidden = options.pauseWhenHidden ?? true;

    this.img = document.createElement("img");
    this.img.style.width = "100%";
    this.img.style.height = "100%";
    this.img.style.objectFit = "contain";
    this.img.style.display = "block";
    this.img.tabIndex = 0;
    this.container.appendChild(this.img);

    this.onClick = (e: MouseEvent) => {
      const coords = this.mapPointerCoords(e);
      if (!coords) return;
      void this.client.input(
        { type: "pointer", action: "click", x: coords.x, y: coords.y, button: "left" },
        this.tabId
      );
    };
    this.onWheel = (e: WheelEvent) => {
      const coords = this.mapPointerCoords(e);
      if (!coords) return;
      void this.client.input(
        { type: "wheel", x: coords.x, y: coords.y, deltaX: e.deltaX, deltaY: e.deltaY },
        this.tabId
      );
    };
    this.onKeyDown = (e: KeyboardEvent) => {
      void this.client.input({ type: "key", action: "press", key: e.key }, this.tabId);
    };

    this.img.addEventListener("click", this.onClick);
    this.img.addEventListener("wheel", this.onWheel);
    this.img.addEventListener("keydown", this.onKeyDown);
  }

  private mapPointerCoords(e: MouseEvent): { x: number; y: number } | null {
    if (!this.lastShot) return null;
    const rect = this.img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scaleX = this.lastShot.width / rect.width;
    const scaleY = this.lastShot.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  start(): void {
    if (this.timer) return;
    const cfg = RENDER_PROFILE_CONFIG[this.profile];
    const tick = async () => {
      if (this.pauseWhenHidden && typeof document !== "undefined" && document.hidden) {
        return;
      }
      try {
        const shot = await this.client.screenshot({
          tabId: this.tabId,
          format: cfg.format,
          quality: cfg.quality,
        });
        this.lastShot = shot;
        this.img.src = shot.dataUrl;
      } catch {
        // ignore transient frame capture errors
      }
    };
    void tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
    this.img.removeEventListener("click", this.onClick);
    this.img.removeEventListener("wheel", this.onWheel);
    this.img.removeEventListener("keydown", this.onKeyDown);
    this.img.remove();
  }
}

export interface ManagedBrowserAgentOptions {
  client: RealBrowserClient;
  safety?: SafetyPolicyConfig | SafetyPolicyEngine;
}

export class ManagedBrowserAgent {
  private readonly client: RealBrowserClient;
  private readonly safety: SafetyPolicyEngine;
  private readonly activityLog: AgentAuditEntry[] = [];

  constructor(options: ManagedBrowserAgentOptions | RealBrowserClient) {
    if (options instanceof RealBrowserClient) {
      this.client = options;
      this.safety = new SafetyPolicyEngine();
    } else {
      this.client = options.client;
      this.safety =
        options.safety instanceof SafetyPolicyEngine
          ? options.safety
          : new SafetyPolicyEngine(options.safety);
    }
  }

  async executeComputerAction(
    action: UnifiedComputerAction | Record<string, unknown>,
    options?: {
      tabId?: number;
      provider?: "gemini" | "anthropic" | "openai" | "generic";
      callId?: string;
      safetyAcknowledged?: boolean;
    }
  ): Promise<AgentExecutionResult> {
    const unified = action as UnifiedComputerAction;
    const decision = this.safety.evaluateAction(unified);
    if (decision.decision === "blocked") {
      const blocked: AgentExecutionResult = {
        ok: false,
        actionType: unified.type,
        tabId: options?.tabId ?? 0,
        url: "",
        error: decision.explanation ?? "Action blocked by safety policy",
        durationMs: 0,
      };
      this.activityLog.push({
        timestamp: Date.now(),
        provider: options?.provider ?? "generic",
        actionType: unified.type,
        intent: unified.intent,
        safetyDecision: decision,
        ok: false,
        error: blocked.error,
        durationMs: 0,
      });
      return blocked;
    }

    const result = await this.client.agentExecute({
      action: unified,
      tabId: options?.tabId,
      provider: options?.provider ?? "generic",
      callId: options?.callId,
      intent: unified.intent,
      safetyDecision: decision,
      safetyAcknowledged: options?.safetyAcknowledged,
    });

    this.activityLog.push({
      timestamp: Date.now(),
      provider: options?.provider ?? "generic",
      actionType: unified.type,
      intent: unified.intent,
      url: result.url,
      safetyDecision: decision,
      userApproved: options?.safetyAcknowledged,
      ok: result.ok,
      error: result.error,
      durationMs: result.durationMs,
    });

    return result;
  }

  async execute(action: UnifiedComputerAction, tabId?: number): Promise<AgentExecutionResult> {
    return this.executeComputerAction(action, { tabId });
  }

  async executeBatch(
    actions: UnifiedComputerAction[],
    options?: { tabId?: number; stopOnError?: boolean }
  ): Promise<AgentExecutionResult[]> {
    const results: AgentExecutionResult[] = [];
    for (const act of actions) {
      const res = await this.execute(act, options?.tabId);
      results.push(res);
      if (!res.ok && options?.stopOnError !== false) break;
    }
    return results;
  }

  async open(url: string, active = true): Promise<BrowserTab> {
    const check = this.safety.isUrlAllowed(url);
    if (!check.allowed) throw new Error(check.reason);
    return this.client.openInWorkspace(url, active);
  }

  async navigate(url: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "navigate", url }, tabId);
  }

  async activate(tabId: number): Promise<BrowserTab> {
    return this.client.activateInWorkspace(tabId);
  }

  async reload(tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "reload" }, tabId);
  }

  async back(tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "go_back" }, tabId);
  }

  async forward(tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "go_forward" }, tabId);
  }

  async duplicate(tabId: number): Promise<BrowserTab> {
    return this.client.duplicateWorkspaceTab(tabId);
  }

  async pin(tabId: number, pinned = true): Promise<BrowserTab> {
    return this.client.pinWorkspaceTab(tabId, pinned);
  }

  async mute(tabId: number, muted = true): Promise<BrowserTab> {
    return this.client.muteWorkspaceTab(tabId, muted);
  }

  async close(tabId: number): Promise<void> {
    return this.client.closeWorkspaceTab(tabId);
  }

  async snapshot(): Promise<ManagedWorkspaceSnapshot> {
    return this.client.workspaceSnapshot();
  }

  async observe(tabId?: number): Promise<SharedTabScreenshot> {
    return this.client.screenshot({ tabId, format: "png" });
  }

  async observeRich(tabId?: number): Promise<{
    screenshot: SharedTabScreenshot;
    elements: InteractiveDomElement[];
    pageText: { title: string; url: string; text: string };
  }> {
    const [screenshot, elements, pageText] = await Promise.all([
      this.client.screenshot({ tabId, format: "png" }),
      this.client.getInteractiveElements(tabId),
      this.client.getPageText(tabId),
    ]);
    return { screenshot, elements, pageText };
  }

  async getInteractiveElements(tabId?: number): Promise<InteractiveDomElement[]> {
    return this.client.getInteractiveElements(tabId);
  }

  async getPageText(tabId?: number): Promise<{ title: string; url: string; text: string }> {
    return this.client.getPageText(tabId);
  }

  async waitForSelector(
    selector: string,
    options?: { timeoutMs?: number; tabId?: number }
  ): Promise<{ found: boolean; elapsedMs: number }> {
    return this.client.waitForSelector(selector, options);
  }

  async getStorage(
    key?: string,
    options?: { storageType?: "local" | "session"; tabId?: number }
  ): Promise<{ value?: string | null; items?: Record<string, string> }> {
    return this.client.getStorage(key, options);
  }

  async setStorage(
    key: string,
    value: string,
    options?: { storageType?: "local" | "session"; tabId?: number }
  ): Promise<void> {
    return this.client.setStorage(key, value, options);
  }

  async screenshot(options?: {
    tabId?: number;
    format?: "png" | "jpeg";
    quality?: number;
  }): Promise<SharedTabScreenshot> {
    return this.client.screenshot(options);
  }

  async zoom(
    region: [number, number, number, number],
    tabId?: number,
    coordinateSpace: "normalized_1000" | "pixels" = "pixels"
  ): Promise<SharedTabScreenshot> {
    return this.client.zoomScreenshot(region, { tabId, coordinateSpace });
  }

  async cursorPosition(tabId?: number): Promise<{ x: number; y: number }> {
    return this.client.cursorPosition(tabId);
  }

  async windowMode(mode: BrowserWindowMode, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "window_mode", mode }, tabId);
  }

  async setZoom(zoomFactor: number, tabId?: number): Promise<{ zoomFactor: number }> {
    return this.client.setZoom(zoomFactor, tabId);
  }

  async zoomReset(tabId?: number): Promise<{ zoomFactor: number }> {
    return this.client.setZoom(1, tabId);
  }

  async printPdf(tabId?: number): Promise<{ base64: string; mimeType: "application/pdf" }> {
    return this.client.printPdf(tabId);
  }

  async clickSelector(selector: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "click_selector", selector }, tabId);
  }

  async typeSelector(
    selector: string,
    text: string,
    options?: { pressEnter?: boolean; clearFirst?: boolean; tabId?: number }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "type_selector",
        selector,
        text,
        pressEnter: options?.pressEnter,
        clearFirst: options?.clearFirst,
      },
      options?.tabId
    );
  }

  async selectOption(
    selector: string,
    value: string,
    tabId?: number
  ): Promise<AgentExecutionResult> {
    return this.execute({ type: "select_option", selector, value }, tabId);
  }

  async findInPage(query: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "find_in_page", query }, tabId);
  }

  async scrollToTop(tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "scroll_to", target: "top" }, tabId);
  }

  async scrollToBottom(tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "scroll_to", target: "bottom" }, tabId);
  }

  async scrollToElement(selector: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "scroll_to", target: "selector", selector }, tabId);
  }

  async click(
    x: number,
    y: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
      intent?: string;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "click",
        x,
        y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
        intent: options?.intent,
      },
      options?.tabId
    );
  }

  async doubleClick(
    x: number,
    y: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "double_click",
        x,
        y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async tripleClick(
    x: number,
    y: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "triple_click",
        x,
        y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async rightClick(
    x: number,
    y: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "right_click",
        x,
        y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async middleClick(
    x: number,
    y: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "middle_click",
        x,
        y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async mouseDown(x?: number, y?: number, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "mouse_down", x, y, coordinateSpace: "pixels" }, tabId);
  }

  async mouseUp(x?: number, y?: number, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "mouse_up", x, y, coordinateSpace: "pixels" }, tabId);
  }

  async hover(
    x: number,
    y: number,
    coordinateSpace: "normalized_1000" | "pixels" = "pixels",
    tabId?: number
  ): Promise<AgentExecutionResult> {
    return this.execute({ type: "move", x, y, coordinateSpace }, tabId);
  }

  async drag(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: {
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "drag_and_drop",
        startX,
        startY,
        endX,
        endY,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async longPress(
    x: number,
    y: number,
    seconds = 2,
    coordinateSpace: "normalized_1000" | "pixels" = "pixels",
    tabId?: number
  ): Promise<AgentExecutionResult> {
    return this.execute(
      { type: "long_press", x, y, seconds, coordinateSpace },
      tabId
    );
  }

  async type(
    text: string,
    options?: {
      x?: number;
      y?: number;
      coordinateSpace?: "normalized_1000" | "pixels";
      pressEnter?: boolean;
      clearFirst?: boolean;
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "type",
        text,
        x: options?.x,
        y: options?.y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        pressEnter: options?.pressEnter,
        clearFirst: options?.clearFirst,
      },
      options?.tabId
    );
  }

  async press(key: string, repeat = 1, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "press_key", key, repeat }, tabId);
  }

  async keyDown(key: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "key_down", key }, tabId);
  }

  async keyUp(key: string, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "key_up", key }, tabId);
  }

  async holdKey(key: string, seconds: number, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "hold_key", key, seconds }, tabId);
  }

  async hotkey(keys: string[], tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "hotkey", keys }, tabId);
  }

  async scroll(
    direction: ScrollDirection = "down",
    magnitudeInPixels = 300,
    options?: {
      x?: number;
      y?: number;
      coordinateSpace?: "normalized_1000" | "pixels";
      modifiers?: ModifierKey[];
      tabId?: number;
    }
  ): Promise<AgentExecutionResult> {
    return this.execute(
      {
        type: "scroll",
        direction,
        magnitudeInPixels,
        x: options?.x,
        y: options?.y,
        coordinateSpace: options?.coordinateSpace ?? "pixels",
        modifiers: options?.modifiers,
      },
      options?.tabId
    );
  }

  async scrollUp(magnitudeInPixels = 300, tabId?: number): Promise<AgentExecutionResult> {
    return this.scroll("up", magnitudeInPixels, { tabId });
  }

  async scrollDown(magnitudeInPixels = 300, tabId?: number): Promise<AgentExecutionResult> {
    return this.scroll("down", magnitudeInPixels, { tabId });
  }

  async wait(seconds = 1, tabId?: number): Promise<AgentExecutionResult> {
    return this.execute({ type: "wait", seconds }, tabId);
  }

  async selectAll(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "A"], tabId);
  }

  async clear(tabId?: number): Promise<AgentExecutionResult> {
    await this.selectAll(tabId);
    return this.press("Backspace", 1, tabId);
  }

  async copy(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "C"], tabId);
  }

  async cut(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "X"], tabId);
  }

  async paste(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "V"], tabId);
  }

  async undo(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "Z"], tabId);
  }

  async redo(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "Shift", "Z"], tabId);
  }

  async find(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "F"], tabId);
  }

  async save(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "S"], tabId);
  }

  async print(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "P"], tabId);
  }

  async zoomIn(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "="], tabId);
  }

  async zoomOut(tabId?: number): Promise<AgentExecutionResult> {
    return this.hotkey(["Control", "-"], tabId);
  }

  async confirm(tabId?: number): Promise<AgentExecutionResult> {
    return this.press("Enter", 1, tabId);
  }

  async cancel(tabId?: number): Promise<AgentExecutionResult> {
    return this.press("Escape", 1, tabId);
  }

  getActivityLog(): AgentAuditEntry[] {
    return [...this.activityLog];
  }
}

export function createManagedBrowserAgent(
  options: ManagedBrowserAgentOptions | RealBrowserClient
): ManagedBrowserAgent {
  return new ManagedBrowserAgent(options);
}
