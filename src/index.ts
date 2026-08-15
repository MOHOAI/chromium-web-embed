import {
  AgentOperation,
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  BrowserEvent,
  BrowserTab,
  BridgeCommand,
  BridgeResponse,
  ExtensionStatus,
  ManagedBrowserWorkspace,
  ManagedWorkspaceSnapshot,
  SharedTabInput,
  SharedTabScreenshot,
  SharedTabScreenshotOptions,
  TabAction,
  isBridgeEvent,
  isBridgeReady,
  isBridgeResponse,
  normalizeTabUrl,
} from "./protocol";

export {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  normalizeTabUrl,
  type AgentOperation,
  type BrowserEvent,
  type BrowserTab,
  type ExtensionStatus,
  type ManagedBrowserWorkspace,
  type ManagedWorkspaceSnapshot,
  type SharedTabInput,
  type SharedTabScreenshot,
  type SharedTabScreenshotOptions,
  type TabAction,
} from "./protocol";

export type RealBrowserClientOptions = { targetOrigin?: string; timeoutMs?: number };
/** Identifies whether this application is running in an iframe without reading its parent document. */
export type EmbeddedApplicationContext = { embedded: boolean; origin: string };
export type ExtensionWaitOptions = { timeoutMs?: number; retryIntervalMs?: number };
export type ExtensionDiagnosticCode = "bridge-not-detected" | "bridge-ready" | "subscribe-failed" | "reconnecting" | "reconnect-required" | "connected";
export type ExtensionDiagnostic = { code: ExtensionDiagnosticCode; message: string; checkedAt: number; extensionVersion?: string; bridgeReadyAt?: number };
export type WorkspaceCreateOptions = { url?: string; label?: string; agentControl?: boolean };
export type WorkspaceOpenOptions = { active?: boolean };
export type AgentActivityStatus = "started" | "succeeded" | "failed";
export type AgentActivityEntry = {
  id: string;
  operation: AgentOperation;
  status: AgentActivityStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
};
export type ManagedBrowserAgentOptions = {
  client: RealBrowserClient;
  maxActivityEntries?: number;
  onActivity?: (entry: AgentActivityEntry) => void;
};
export type TabListener = (event: BrowserEvent) => void;
export type KeyPressOptions = { code?: string; modifiers?: number; location?: number };
export type AgentObserveOptions = SharedTabScreenshotOptions;
export type SharedTabRenderProfile = "responsive" | "balanced" | "sharp";
export type SharedTabViewerMetrics = {
  framesRendered: number;
  queuedRefreshes: number;
  lastCaptureMs?: number;
  averageCaptureLatencyMs?: number;
  averageRefreshIntervalMs?: number;
  effectiveFps?: number;
  lastFrameAt?: number;
};
export type SharedTabContextMenuEvent = {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
};
export type SharedTabViewerOptions = {
  /** responsive favors low-latency JPEG frames, balanced is the default, and sharp preserves text edges with PNG frames. */
  renderProfile?: SharedTabRenderProfile;
  refreshIntervalMs?: number;
  screenshot?: SharedTabScreenshotOptions;
  pauseWhenHidden?: boolean;
  onError?: (error: Error) => void;
  onFrame?: (frame: SharedTabScreenshot) => void;
  /** Receives a right-click in viewer and lets the embedding app render its own safe action menu. */
  onContextMenu?: (event: SharedTabContextMenuEvent) => void;
};

type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };

/**
 * A client for the Manifest V3 extension's managed-workspace API. It never lists or controls
 * user tabs outside the workspace created for the calling application's origin.
 */
export class RealBrowserClient {
  private readonly targetOrigin: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<TabListener>();
  private disposed = false;
  private lastBridgeReadyAt?: number;
  private diagnostic: ExtensionDiagnostic = { code: "bridge-not-detected", message: "لم تصل استجابة من جسر الإضافة بعد.", checkedAt: Date.now() };
  private workspaceId?: string;

  constructor(options: RealBrowserClientOptions = {}) {
    if (typeof window === "undefined") throw new Error("RealBrowserClient must run in a browser window.");
    this.targetOrigin = options.targetOrigin ?? window.location.origin;
    this.timeoutMs = options.timeoutMs ?? 1_500;
    window.addEventListener("message", this.receive);
  }

  async connect(): Promise<ExtensionStatus> {
    let status: ExtensionStatus;
    try { status = await this.status(); }
    catch (error) {
      this.setDiagnostic({ code: "bridge-not-detected", message: error instanceof Error ? error.message : "لم يستجب جسر الإضافة.", bridgeReadyAt: this.lastBridgeReadyAt });
      throw error;
    }
    try { await this.request("subscribe"); }
    catch (error) {
      this.setDiagnostic({ code: "subscribe-failed", message: error instanceof Error ? error.message : "تعذّر الاشتراك في أحداث الإضافة.", extensionVersion: status.version, bridgeReadyAt: this.lastBridgeReadyAt });
      throw error;
    }
    this.setDiagnostic({ code: "connected", message: "الإضافة متصلة وجاهزة لإنشاء مساحة متصفح خاصة بهذا التطبيق.", extensionVersion: status.version, bridgeReadyAt: this.lastBridgeReadyAt });
    return status;
  }

  async waitForExtension(options: ExtensionWaitOptions = {}): Promise<ExtensionStatus> {
    const timeoutMs = Math.max(this.timeoutMs, options.timeoutMs ?? 8_000);
    const retryIntervalMs = Math.max(150, options.retryIntervalMs ?? 400);
    const deadline = Date.now() + timeoutMs;
    let lastError: Error | undefined;
    while (!this.disposed && Date.now() < deadline) {
      try { return await this.connect(); }
      catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); }
      await new Promise<void>((resolve) => window.setTimeout(resolve, retryIntervalMs));
    }
    throw new Error(lastError?.message ?? "The managed-browser extension did not respond. Check that it is installed and enabled for this site.");
  }

  status(): Promise<ExtensionStatus> { return this.request("status"); }

  async createWorkspace(options: WorkspaceCreateOptions = {}): Promise<{ workspace: ManagedBrowserWorkspace; tab: BrowserTab }> {
    const result = await this.requestMutation<{ workspace: ManagedBrowserWorkspace; tab: BrowserTab }>("workspaceCreate", {
      ...(options.url ? { url: normalizeTabUrl(options.url) } : {}),
      ...(options.label ? { label: options.label } : {}),
      agentControl: Boolean(options.agentControl),
    });
    this.workspaceId = result.workspace.id;
    return result;
  }

  async reconnect(options: ExtensionWaitOptions = {}): Promise<ExtensionStatus> {
    this.setDiagnostic({ code: "reconnecting", message: "انقطع جسر الإضافة؛ تجري إعادة الاتصال بصورة آمنة.", bridgeReadyAt: this.lastBridgeReadyAt });
    return this.waitForExtension(options);
  }

  async workspace(): Promise<{ workspace: ManagedBrowserWorkspace | null }> {
    // Workspace discovery is intentionally allowed before createWorkspace().
    // This lets applications resume an origin-owned workspace or create one on first use.
    const result = await this.requestWithRecovery<{ workspace: ManagedBrowserWorkspace | null }>("workspaceGet", this.workspaceId ? this.workspaceData() : undefined);
    if (result.workspace) this.workspaceId = result.workspace.id;
    return result;
  }

  listWorkspaceTabs(): Promise<{ workspace: ManagedBrowserWorkspace; tabs: BrowserTab[] }> { return this.requestWithRecovery("workspaceList", this.workspaceData()); }
  async workspaceSnapshot(): Promise<ManagedWorkspaceSnapshot> {
    const { workspace, tabs } = await this.listWorkspaceTabs();
    return { workspace, tabs, capturedAt: Date.now() };
  }
  openInWorkspace(url: string, options: WorkspaceOpenOptions = {}): Promise<{ tab: BrowserTab; workspace: ManagedBrowserWorkspace }> {
    return this.requestMutation("workspaceOpen", { ...this.workspaceData(), url: normalizeTabUrl(url), active: options.active ?? true });
  }
  navigateInWorkspace(tabId: number, url: string): Promise<{ tab: BrowserTab }> { return this.requestMutation("workspaceNavigate", { ...this.workspaceData(), tabId, url: normalizeTabUrl(url) }); }
  activateInWorkspace(tabId: number): Promise<{ tab: BrowserTab }> { return this.requestMutation("workspaceActivate", { ...this.workspaceData(), tabId }); }
  reloadInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.requestMutation("workspaceReload", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  backInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.requestMutation("workspaceBack", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  forwardInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.requestMutation("workspaceForward", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  renameWorkspace(label: string): Promise<{ workspace: ManagedBrowserWorkspace }> { return this.requestMutation("workspaceRename", { ...this.workspaceData(), label }); }
  pinWorkspaceTab(tabId: number, pinned = true): Promise<{ tab: BrowserTab }> { return this.requestMutation("workspacePinTab", { ...this.workspaceData(), tabId, pinned }); }
  muteWorkspaceTab(tabId: number, muted = true): Promise<{ tab: BrowserTab }> { return this.requestMutation("workspaceMuteTab", { ...this.workspaceData(), tabId, muted }); }
  duplicateWorkspaceTab(tabId: number, options: WorkspaceOpenOptions = {}): Promise<{ tab: BrowserTab; workspace: ManagedBrowserWorkspace }> {
    return this.requestMutation("workspaceDuplicateTab", { ...this.workspaceData(), tabId, active: options.active ?? true });
  }
  closeWorkspaceTab(tabId: number): Promise<{ ok: true; workspace: ManagedBrowserWorkspace | null }> { return this.requestMutation("workspaceCloseTab", { ...this.workspaceData(), tabId }); }
  async closeWorkspace(): Promise<{ ok: true }> { const result = await this.requestMutation<{ ok: true }>("workspaceClose", this.workspaceData()); this.workspaceId = undefined; return result; }
  setAgentControl(enabled: boolean): Promise<{ workspace: ManagedBrowserWorkspace }> { return this.requestMutation("workspaceSetAgentControl", { ...this.workspaceData(), enabled }); }
  screenshot(tabId?: number, options: SharedTabScreenshotOptions = {}): Promise<SharedTabScreenshot> {
    return this.requestWithRecovery("workspaceScreenshot", { ...this.workspaceData(), ...(tabId ? { tabId } : {}), ...(options.format ? { format: options.format } : {}), ...(options.quality !== undefined ? { quality: options.quality } : {}) });
  }
  input(input: SharedTabInput, tabId?: number): Promise<{ ok: true }> { return this.requestMutation("workspaceInput", { ...this.workspaceData(), input, ...(tabId ? { tabId } : {}) }); }
  typeText(text: string, tabId?: number): Promise<{ ok: true }> { return this.input({ kind: "text", text }, tabId); }
  async pressKey(key: string, options: KeyPressOptions = {}, tabId?: number): Promise<{ ok: true }> {
    await this.input({ kind: "key", type: "keyDown", key, ...options }, tabId);
    return this.input({ kind: "key", type: "keyUp", key, ...options }, tabId);
  }
  agentExecute(operation: AgentOperation): Promise<unknown> { return this.requestMutation("agentExecute", { ...this.workspaceData(), operation }); }
  getConnectionDiagnostic(): ExtensionDiagnostic { return { ...this.diagnostic }; }
  getWorkspaceId(): string | undefined { return this.workspaceId; }
  onTabEvent(listener: TabListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.receive);
    for (const [requestId, pending] of this.pending) { window.clearTimeout(pending.timer); pending.reject(new Error("The managed-browser client was disposed.")); this.pending.delete(requestId); }
    this.listeners.clear();
  }

  private workspaceData(): Record<string, unknown> {
    if (!this.workspaceId) throw new Error("No managed browser workspace exists. Call createWorkspace first.");
    return { workspaceId: this.workspaceId };
  }

  private request<T>(action: TabAction, data?: Record<string, unknown>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("The managed-browser client was disposed."));
    const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const command: BridgeCommand = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) };
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error("The managed-browser extension did not respond. Check that it is installed and enabled for this origin.")); }, this.timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      window.postMessage(command, this.targetOrigin);
    });
  }

  /** Retries read-only operations after a new bridge handshake. Mutating commands remain explicit to prevent duplicate typing, clicks, or navigation. */
  private async requestWithRecovery<T>(action: TabAction, data?: Record<string, unknown>): Promise<T> {
    try { return await this.request<T>(action, data); }
    catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      if (!/did not respond|not respond|bridge.*(?:not|missing)/i.test(reason.message)) throw reason;
      await this.reconnect({ timeoutMs: Math.max(1_000, this.timeoutMs * 3), retryIntervalMs: 150 });
      return this.request<T>(action, data);
    }
  }

  /** Mutating commands are never replayed automatically: the extension may have already applied a click, keypress, or navigation before the reply was lost. */
  private async requestMutation<T>(action: TabAction, data?: Record<string, unknown>): Promise<T> {
    try { return await this.request<T>(action, data); }
    catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      if (!/did not respond|not respond|bridge.*(?:not|missing)/i.test(reason.message)) throw reason;
      const message = `Connection interrupted while running ${action}. The command was not replayed. Call client.reconnect() and explicitly decide whether to retry it.`;
      this.setDiagnostic({ code: "reconnect-required", message, bridgeReadyAt: this.lastBridgeReadyAt });
      throw new Error(message);
    }
  }

  private receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== this.targetOrigin) return;
    const message = event.data;
    if (isBridgeReady(message)) {
      this.lastBridgeReadyAt = Date.now();
      this.setDiagnostic({ code: "bridge-ready", message: "تم حقن جسر الإضافة في هذه الصفحة وهو بانتظار المصافحة.", extensionVersion: message.extensionVersion, bridgeReadyAt: this.lastBridgeReadyAt });
      return;
    }
    if (isBridgeEvent(message)) { this.listeners.forEach((listener) => listener(message.event)); return; }
    if (!isBridgeResponse(message)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    window.clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error ?? "The extension rejected the command."));
  };

  private setDiagnostic(next: Omit<ExtensionDiagnostic, "checkedAt">): void { this.diagnostic = { ...next, checkedAt: Date.now() }; }
}

/**
 * Creates a client for an application running inside an iframe. The extension installs an
 * independent bridge in this frame and keys its workspace to this frame's own HTTP(S) origin.
 * No parent-window message channel, parent-origin trust, or shared workspace is introduced.
 */
export function createEmbeddedBrowserClient(options: RealBrowserClientOptions = {}): RealBrowserClient {
  if (typeof window === "undefined") throw new Error("createEmbeddedBrowserClient must run in a browser window.");
  return new RealBrowserClient({ ...options, targetOrigin: options.targetOrigin ?? window.location.origin });
}

/** Returns frame-local context for diagnostics and consent copy without touching parent-window state. */
export function getEmbeddedApplicationContext(): EmbeddedApplicationContext {
  if (typeof window === "undefined") throw new Error("getEmbeddedApplicationContext must run in a browser window.");
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  return { embedded, origin: window.location.origin };
}

/** Renders periodic frames from the active tab in the current managed workspace and forwards input only to that workspace. */
export class SharedTabViewer {
  private readonly image = document.createElement("img");
  private readonly interval: number;
  private readonly screenshotOptions: SharedTabScreenshotOptions;
  private readonly abort = new AbortController();
  private timer?: number;
  private moveFrame?: number;
  private pendingMove?: Extract<SharedTabInput, { kind: "pointer" }>;
  private inFlight?: Promise<void>;
  private refreshQueued = false;
  private composing = false;
  private disposed = false;
  private captureLatencyTotal = 0;
  private captureSamples = 0;
  private refreshIntervalTotal = 0;
  private refreshIntervalSamples = 0;
  private lastRefreshStartedAt?: number;
  private readonly metrics: SharedTabViewerMetrics = { framesRendered: 0, queuedRefreshes: 0 };

  constructor(private readonly client: RealBrowserClient, private readonly container: HTMLElement, private readonly options: SharedTabViewerOptions = {}) {
    const profile = options.renderProfile ?? "balanced";
    const defaults: Record<SharedTabRenderProfile, { interval: number; screenshot: SharedTabScreenshotOptions }> = {
      responsive: { interval: 180, screenshot: { format: "jpeg", quality: 58 } },
      balanced: { interval: 300, screenshot: { format: "jpeg", quality: 78 } },
      sharp: { interval: 450, screenshot: { format: "png" } },
    };
    this.interval = Math.max(120, options.refreshIntervalMs ?? defaults[profile].interval);
    this.screenshotOptions = { ...defaults[profile].screenshot, ...options.screenshot };
    this.image.alt = "لقطة تفاعلية للتبويب الموجود في مساحة متصفح التطبيق";
    this.image.draggable = false;
    Object.assign(this.image.style, { display: "block", width: "100%", height: "100%", objectFit: "contain" });
    this.container.replaceChildren(this.image);
    this.container.tabIndex = this.container.tabIndex >= 0 ? this.container.tabIndex : 0;
    this.bindInput();
  }

  async start(): Promise<void> {
    if (this.timer || this.disposed) return;
    await this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), this.interval);
  }
  async refresh(): Promise<void> {
    if (this.disposed || (this.options.pauseWhenHidden !== false && document.hidden)) return;
    if (this.inFlight) { this.refreshQueued = true; this.metrics.queuedRefreshes += 1; return this.inFlight; }
    const work = (async () => {
      try {
        const startedAt = performance.now();
        const priorRefreshStartedAt = this.lastRefreshStartedAt;
        this.lastRefreshStartedAt = startedAt;
        const frame = await this.client.screenshot(undefined, this.screenshotOptions);
        if (!this.disposed) {
          this.image.src = frame.dataUrl;
          this.metrics.framesRendered += 1;
          const captureLatencyMs = Math.round(performance.now() - startedAt);
          this.captureLatencyTotal += captureLatencyMs;
          this.captureSamples += 1;
          this.metrics.lastCaptureMs = captureLatencyMs;
          this.metrics.averageCaptureLatencyMs = Math.round(this.captureLatencyTotal / this.captureSamples);
          if (priorRefreshStartedAt !== undefined) {
            this.refreshIntervalTotal += Math.max(0, startedAt - priorRefreshStartedAt);
            this.refreshIntervalSamples += 1;
            const averageRefreshIntervalMs = Math.round(this.refreshIntervalTotal / this.refreshIntervalSamples);
            this.metrics.averageRefreshIntervalMs = averageRefreshIntervalMs;
            this.metrics.effectiveFps = averageRefreshIntervalMs > 0 ? Math.round((1_000 / averageRefreshIntervalMs) * 100) / 100 : undefined;
          }
          this.metrics.lastFrameAt = frame.capturedAt;
          this.options.onFrame?.(frame);
        }
      } catch (error) { this.report(error); }
    })();
    this.inFlight = work;
    try { await work; }
    finally {
      this.inFlight = undefined;
      if (this.refreshQueued && !this.disposed) { this.refreshQueued = false; void this.refresh(); }
    }
  }
  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    if (this.timer !== undefined) window.clearInterval(this.timer);
    if (this.moveFrame !== undefined) window.cancelAnimationFrame(this.moveFrame);
    this.timer = undefined;
    this.moveFrame = undefined;
    this.pendingMove = undefined;
    this.image.removeAttribute("src");
  }
  getMetrics(): SharedTabViewerMetrics { return { ...this.metrics }; }

  private bindInput(): void {
    const signal = this.abort.signal;
    const point = (event: MouseEvent) => {
      const bounds = this.image.getBoundingClientRect();
      const width = this.image.naturalWidth || bounds.width;
      const height = this.image.naturalHeight || bounds.height;
      const scale = Math.min(bounds.width / Math.max(1, width), bounds.height / Math.max(1, height));
      const paintedWidth = width * scale;
      const paintedHeight = height * scale;
      const left = bounds.left + (bounds.width - paintedWidth) / 2;
      const top = bounds.top + (bounds.height - paintedHeight) / 2;
      return { x: Math.round(Math.max(0, Math.min(width, (event.clientX - left) / Math.max(scale, 0.0001)))), y: Math.round(Math.max(0, Math.min(height, (event.clientY - top) / Math.max(scale, 0.0001)))) };
    };
    const button = (value: number): "left" | "middle" | "right" => value === 1 ? "middle" : value === 2 ? "right" : "left";
    const modifiers = (event: KeyboardEvent) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    const send = (input: SharedTabInput) => { void this.client.input(input).catch((error: unknown) => this.report(error)); };
    const queueMove = (input: Extract<SharedTabInput, { kind: "pointer" }>) => {
      this.pendingMove = input;
      if (this.moveFrame !== undefined) return;
      this.moveFrame = window.requestAnimationFrame(() => {
        this.moveFrame = undefined;
        const pending = this.pendingMove;
        this.pendingMove = undefined;
        if (pending) send(pending);
      });
    };
    this.container.addEventListener("pointerdown", (event) => { event.preventDefault(); this.container.focus({ preventScroll: true }); send({ kind: "pointer", type: "mousePressed", ...point(event), button: button(event.button), clickCount: event.detail || 1 }); }, { signal });
    this.container.addEventListener("pointermove", (event) => { queueMove({ kind: "pointer", type: "mouseMoved", ...point(event), button: button(event.button) }); }, { signal });
    this.container.addEventListener("pointerup", (event) => { event.preventDefault(); send({ kind: "pointer", type: "mouseReleased", ...point(event), button: button(event.button), clickCount: event.detail || 1 }); }, { signal });
    this.container.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.container.focus({ preventScroll: true });
      const position = point(event);
      this.options.onContextMenu?.({ clientX: event.clientX, clientY: event.clientY, ...position });
    }, { signal });
    this.container.addEventListener("wheel", (event) => { event.preventDefault(); send({ kind: "wheel", ...point(event), deltaX: event.deltaX, deltaY: event.deltaY }); }, { passive: false, signal });
    this.container.addEventListener("compositionstart", () => { this.composing = true; }, { signal });
    this.container.addEventListener("compositionend", (event) => { this.composing = false; if (event.data) send({ kind: "text", text: event.data }); }, { signal });
    this.container.addEventListener("paste", (event) => { const text = event.clipboardData?.getData("text/plain"); if (text) { event.preventDefault(); send({ kind: "text", text }); } }, { signal });
    this.container.addEventListener("keydown", (event) => {
      event.preventDefault();
      const options = { code: event.code || undefined, modifiers: modifiers(event), location: event.location };
      send({ kind: "key", type: "keyDown", key: event.key, ...options });
      if (!this.composing && !event.ctrlKey && !event.metaKey && !event.altKey && Array.from(event.key).length === 1) send({ kind: "key", type: "char", key: event.key, ...options });
    }, { signal });
    this.container.addEventListener("keyup", (event) => { event.preventDefault(); send({ kind: "key", type: "keyUp", key: event.key, code: event.code || undefined, modifiers: modifiers(event), location: event.location }); }, { signal });
  }

  private report(error: unknown): void { this.options.onError?.(error instanceof Error ? error : new Error(String(error))); }
}

/**
 * A narrow automation facade for AI applications. Every operation is routed through the active
 * managed workspace, and the extension rejects it unless the user enabled agent control there.
 * It controls Chrome tabs created for the application; it does not provide operating-system control.
 */
export class ManagedBrowserAgent {
  private readonly activity: AgentActivityEntry[] = [];
  private readonly limit: number;

  constructor(private readonly client: RealBrowserClient, private readonly options: Omit<ManagedBrowserAgentOptions, "client"> = {}) {
    this.limit = Math.max(10, Math.min(1_000, Math.round(options.maxActivityEntries ?? 100)));
  }

  execute(operation: AgentOperation): Promise<unknown> { return this.run(operation); }
  open(url: string, active = true): Promise<unknown> { return this.execute({ type: "open", url, active }); }
  navigate(tabId: number, url: string): Promise<unknown> { return this.execute({ type: "navigate", tabId, url }); }
  activate(tabId: number): Promise<unknown> { return this.execute({ type: "activate", tabId }); }
  reload(tabId: number): Promise<unknown> { return this.execute({ type: "reload", tabId }); }
  back(tabId: number): Promise<unknown> { return this.execute({ type: "back", tabId }); }
  forward(tabId: number): Promise<unknown> { return this.execute({ type: "forward", tabId }); }
  duplicate(tabId: number, active = true): Promise<unknown> { return this.execute({ type: "duplicate", tabId, active }); }
  pin(tabId: number, pinned = true): Promise<unknown> { return this.execute({ type: "pin", tabId, pinned }); }
  mute(tabId: number, muted = true): Promise<unknown> { return this.execute({ type: "mute", tabId, muted }); }
  close(tabId: number): Promise<unknown> { return this.execute({ type: "close", tabId }); }
  snapshot(): Promise<ManagedWorkspaceSnapshot> { return this.client.workspaceSnapshot(); }
  observe(tabId?: number, options: AgentObserveOptions = {}): Promise<SharedTabScreenshot> { return this.client.screenshot(tabId, options); }
  type(text: string, tabId?: number): Promise<{ ok: true }> {
    return this.run({ type: "input", ...(tabId ? { tabId } : {}), input: { kind: "text", text } }) as Promise<{ ok: true }>;
  }
  press(key: string, options: KeyPressOptions = {}, tabId?: number): Promise<{ ok: true }> {
    return this.keySequence(key, options, tabId);
  }
  async selectAll(tabId?: number): Promise<{ ok: true }> { return this.keySequence("a", { code: "KeyA", modifiers: 2 }, tabId); }
  async clear(tabId?: number): Promise<{ ok: true }> {
    await this.selectAll(tabId);
    return this.keySequence("Backspace", { code: "Backspace" }, tabId);
  }
  scroll(deltaY: number, deltaX = 0, tabId?: number, x = 0, y = 0): Promise<{ ok: true }> {
    return this.agentInput({ kind: "wheel", x, y, deltaX, deltaY }, tabId);
  }
  scrollUp(amount = 520, tabId?: number, x = 0, y = 0): Promise<{ ok: true }> { return this.scroll(-Math.abs(amount), 0, tabId, x, y); }
  scrollDown(amount = 520, tabId?: number, x = 0, y = 0): Promise<{ ok: true }> { return this.scroll(Math.abs(amount), 0, tabId, x, y); }
  click(x: number, y: number, tabId?: number): Promise<{ ok: true }> {
    return this.pointerSequence(x, y, 1, tabId);
  }
  doubleClick(x: number, y: number, tabId?: number): Promise<{ ok: true }> { return this.pointerSequence(x, y, 2, tabId); }
  tripleClick(x: number, y: number, tabId?: number): Promise<{ ok: true }> { return this.pointerSequence(x, y, 3, tabId); }
  rightClick(x: number, y: number, tabId?: number): Promise<{ ok: true }> { return this.pointerSequence(x, y, 1, tabId, "right"); }
  hover(x: number, y: number, tabId?: number): Promise<{ ok: true }> { return this.agentInput({ kind: "pointer", type: "mouseMoved", x, y }, tabId); }
  async drag(fromX: number, fromY: number, toX: number, toY: number, tabId?: number): Promise<{ ok: true }> {
    await this.hover(fromX, fromY, tabId);
    await this.agentInput({ kind: "pointer", type: "mousePressed", x: fromX, y: fromY, button: "left", clickCount: 1 }, tabId);
    await this.hover(toX, toY, tabId);
    return this.agentInput({ kind: "pointer", type: "mouseReleased", x: toX, y: toY, button: "left", clickCount: 1 }, tabId);
  }
  async longPress(x: number, y: number, durationMs = 600, tabId?: number): Promise<{ ok: true }> {
    await this.agentInput({ kind: "pointer", type: "mousePressed", x, y, button: "left", clickCount: 1 }, tabId);
    await this.wait(Math.max(120, Math.min(5_000, durationMs)));
    return this.agentInput({ kind: "pointer", type: "mouseReleased", x, y, button: "left", clickCount: 1 }, tabId);
  }
  copy(tabId?: number): Promise<{ ok: true }> { return this.keySequence("c", { code: "KeyC", modifiers: 2 }, tabId); }
  cut(tabId?: number): Promise<{ ok: true }> { return this.keySequence("x", { code: "KeyX", modifiers: 2 }, tabId); }
  paste(text: string, tabId?: number): Promise<{ ok: true }> { return this.type(text, tabId); }
  undo(tabId?: number): Promise<{ ok: true }> { return this.keySequence("z", { code: "KeyZ", modifiers: 2 }, tabId); }
  redo(tabId?: number): Promise<{ ok: true }> { return this.keySequence("y", { code: "KeyY", modifiers: 2 }, tabId); }
  find(tabId?: number): Promise<{ ok: true }> { return this.keySequence("f", { code: "KeyF", modifiers: 2 }, tabId); }
  confirm(tabId?: number): Promise<{ ok: true }> { return this.press("Enter", { code: "Enter" }, tabId); }
  cancel(tabId?: number): Promise<{ ok: true }> { return this.press("Escape", { code: "Escape" }, tabId); }
  toggle(tabId?: number): Promise<{ ok: true }> { return this.press(" ", { code: "Space" }, tabId); }
  save(tabId?: number): Promise<{ ok: true }> { return this.keySequence("s", { code: "KeyS", modifiers: 2 }, tabId); }
  print(tabId?: number): Promise<{ ok: true }> { return this.keySequence("p", { code: "KeyP", modifiers: 2 }, tabId); }
  zoomIn(tabId?: number): Promise<{ ok: true }> { return this.keySequence("+", { code: "Equal", modifiers: 2 }, tabId); }
  zoomOut(tabId?: number): Promise<{ ok: true }> { return this.keySequence("-", { code: "Minus", modifiers: 2 }, tabId); }
  resetZoom(tabId?: number): Promise<{ ok: true }> { return this.keySequence("0", { code: "Digit0", modifiers: 2 }, tabId); }
  wait(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Math.min(30_000, Math.round(milliseconds))))); }
  getActivityLog(): readonly AgentActivityEntry[] { return this.activity.map((entry) => ({ ...entry })); }
  clearActivityLog(): void { this.activity.splice(0); }

  private agentInput(input: SharedTabInput, tabId?: number): Promise<{ ok: true }> {
    return this.run({ type: "input", ...(tabId ? { tabId } : {}), input }) as Promise<{ ok: true }>;
  }

  private async run(operation: AgentOperation): Promise<unknown> {
    const entry: AgentActivityEntry = { id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, operation, status: "started", startedAt: Date.now() };
    this.record(entry);
    try {
      const result = await this.client.agentExecute(operation);
      entry.status = "succeeded";
      entry.completedAt = Date.now();
      this.options.onActivity?.({ ...entry });
      return result;
    } catch (error) {
      entry.status = "failed";
      entry.completedAt = Date.now();
      entry.error = error instanceof Error ? error.message : String(error);
      this.options.onActivity?.({ ...entry });
      throw error;
    }
  }

  private record(entry: AgentActivityEntry): void {
    this.activity.push(entry);
    if (this.activity.length > this.limit) this.activity.splice(0, this.activity.length - this.limit);
    this.options.onActivity?.({ ...entry });
  }

  private async keySequence(key: string, options: KeyPressOptions, tabId?: number): Promise<{ ok: true }> {
    await this.agentInput({ kind: "key", type: "keyDown", key, ...options }, tabId);
    return this.agentInput({ kind: "key", type: "keyUp", key, ...options }, tabId);
  }

  private async pointerSequence(x: number, y: number, clickCount: number, tabId?: number, button: "left" | "middle" | "right" = "left"): Promise<{ ok: true }> {
    await this.agentInput({ kind: "pointer", type: "mousePressed", x, y, button, clickCount }, tabId);
    return this.agentInput({ kind: "pointer", type: "mouseReleased", x, y, button, clickCount }, tabId);
  }
}

export function createRealBrowserClient(options: RealBrowserClientOptions = {}): RealBrowserClient { return new RealBrowserClient(options); }
export function createManagedBrowserAgent(options: ManagedBrowserAgentOptions): ManagedBrowserAgent {
  return new ManagedBrowserAgent(options.client, { maxActivityEntries: options.maxActivityEntries, onActivity: options.onActivity });
}
