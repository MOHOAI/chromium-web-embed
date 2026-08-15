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
  type TabAction,
} from "./protocol";

export type RealBrowserClientOptions = { targetOrigin?: string; timeoutMs?: number };
export type ExtensionWaitOptions = { timeoutMs?: number; retryIntervalMs?: number };
export type ExtensionDiagnosticCode = "bridge-not-detected" | "bridge-ready" | "subscribe-failed" | "connected";
export type ExtensionDiagnostic = { code: ExtensionDiagnosticCode; message: string; checkedAt: number; extensionVersion?: string; bridgeReadyAt?: number };
export type WorkspaceCreateOptions = { url?: string; label?: string; agentControl?: boolean };
export type WorkspaceOpenOptions = { active?: boolean };
export type ManagedBrowserAgentOptions = { client: RealBrowserClient };
export type TabListener = (event: BrowserEvent) => void;
export type SharedTabViewerOptions = { refreshIntervalMs?: number; onError?: (error: Error) => void; onFrame?: (frame: SharedTabScreenshot) => void };

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
    const result = await this.request<{ workspace: ManagedBrowserWorkspace; tab: BrowserTab }>("workspaceCreate", {
      ...(options.url ? { url: normalizeTabUrl(options.url) } : {}),
      ...(options.label ? { label: options.label } : {}),
      agentControl: Boolean(options.agentControl),
    });
    this.workspaceId = result.workspace.id;
    return result;
  }

  async workspace(): Promise<{ workspace: ManagedBrowserWorkspace | null }> {
    const result = await this.request<{ workspace: ManagedBrowserWorkspace | null }>("workspaceGet", this.workspaceData());
    if (result.workspace) this.workspaceId = result.workspace.id;
    return result;
  }

  listWorkspaceTabs(): Promise<{ workspace: ManagedBrowserWorkspace; tabs: BrowserTab[] }> { return this.request("workspaceList", this.workspaceData()); }
  async workspaceSnapshot(): Promise<ManagedWorkspaceSnapshot> {
    const { workspace, tabs } = await this.listWorkspaceTabs();
    return { workspace, tabs, capturedAt: Date.now() };
  }
  openInWorkspace(url: string, options: WorkspaceOpenOptions = {}): Promise<{ tab: BrowserTab; workspace: ManagedBrowserWorkspace }> {
    return this.request("workspaceOpen", { ...this.workspaceData(), url: normalizeTabUrl(url), active: options.active ?? true });
  }
  navigateInWorkspace(tabId: number, url: string): Promise<{ tab: BrowserTab }> { return this.request("workspaceNavigate", { ...this.workspaceData(), tabId, url: normalizeTabUrl(url) }); }
  activateInWorkspace(tabId: number): Promise<{ tab: BrowserTab }> { return this.request("workspaceActivate", { ...this.workspaceData(), tabId }); }
  reloadInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.request("workspaceReload", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  backInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.request("workspaceBack", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  forwardInWorkspace(tabId?: number): Promise<{ ok: true }> { return this.request("workspaceForward", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  renameWorkspace(label: string): Promise<{ workspace: ManagedBrowserWorkspace }> { return this.request("workspaceRename", { ...this.workspaceData(), label }); }
  pinWorkspaceTab(tabId: number, pinned = true): Promise<{ tab: BrowserTab }> { return this.request("workspacePinTab", { ...this.workspaceData(), tabId, pinned }); }
  muteWorkspaceTab(tabId: number, muted = true): Promise<{ tab: BrowserTab }> { return this.request("workspaceMuteTab", { ...this.workspaceData(), tabId, muted }); }
  duplicateWorkspaceTab(tabId: number, options: WorkspaceOpenOptions = {}): Promise<{ tab: BrowserTab; workspace: ManagedBrowserWorkspace }> {
    return this.request("workspaceDuplicateTab", { ...this.workspaceData(), tabId, active: options.active ?? true });
  }
  closeWorkspaceTab(tabId: number): Promise<{ ok: true; workspace: ManagedBrowserWorkspace | null }> { return this.request("workspaceCloseTab", { ...this.workspaceData(), tabId }); }
  async closeWorkspace(): Promise<{ ok: true }> { const result = await this.request<{ ok: true }>("workspaceClose", this.workspaceData()); this.workspaceId = undefined; return result; }
  setAgentControl(enabled: boolean): Promise<{ workspace: ManagedBrowserWorkspace }> { return this.request("workspaceSetAgentControl", { ...this.workspaceData(), enabled }); }
  screenshot(tabId?: number): Promise<SharedTabScreenshot> { return this.request("workspaceScreenshot", { ...this.workspaceData(), ...(tabId ? { tabId } : {}) }); }
  input(input: SharedTabInput, tabId?: number): Promise<{ ok: true }> { return this.request("workspaceInput", { ...this.workspaceData(), input, ...(tabId ? { tabId } : {}) }); }
  agentExecute(operation: AgentOperation): Promise<unknown> { return this.request("agentExecute", { ...this.workspaceData(), operation }); }
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

/** Renders periodic frames from the active tab in the current managed workspace and forwards input only to that workspace. */
export class SharedTabViewer {
  private readonly image = document.createElement("img");
  private readonly interval: number;
  private timer?: number;
  private disposed = false;

  constructor(private readonly client: RealBrowserClient, private readonly container: HTMLElement, private readonly options: SharedTabViewerOptions = {}) {
    this.interval = Math.max(200, options.refreshIntervalMs ?? 350);
    this.image.alt = "لقطة تفاعلية للتبويب الموجود في مساحة متصفح التطبيق";
    this.image.draggable = false;
    Object.assign(this.image.style, { display: "block", width: "100%", height: "100%", objectFit: "contain" });
    this.container.replaceChildren(this.image);
    this.container.tabIndex = this.container.tabIndex >= 0 ? this.container.tabIndex : 0;
    this.bindInput();
  }

  async start(): Promise<void> { if (this.timer || this.disposed) return; await this.refresh(); this.timer = window.setInterval(() => void this.refresh(), this.interval); }
  async refresh(): Promise<void> {
    if (this.disposed) return;
    try { const frame = await this.client.screenshot(); this.image.src = frame.dataUrl; this.options.onFrame?.(frame); }
    catch (error) { this.options.onError?.(error instanceof Error ? error : new Error(String(error))); }
  }
  dispose(): void { this.disposed = true; if (this.timer !== undefined) window.clearInterval(this.timer); this.timer = undefined; }

  private bindInput(): void {
    const point = (event: MouseEvent) => {
      const bounds = this.container.getBoundingClientRect(); const width = this.image.naturalWidth || bounds.width; const height = this.image.naturalHeight || bounds.height;
      return { x: Math.max(0, Math.min(width, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width)), y: Math.max(0, Math.min(height, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height)) };
    };
    const button = (value: number): "left" | "middle" | "right" => value === 1 ? "middle" : value === 2 ? "right" : "left";
    this.container.addEventListener("pointerdown", (event) => { this.container.focus(); void this.client.input({ kind: "pointer", type: "mousePressed", ...point(event), button: button(event.button), clickCount: event.detail || 1 }); });
    this.container.addEventListener("pointermove", (event) => { void this.client.input({ kind: "pointer", type: "mouseMoved", ...point(event), button: button(event.button) }); });
    this.container.addEventListener("pointerup", (event) => { void this.client.input({ kind: "pointer", type: "mouseReleased", ...point(event), button: button(event.button), clickCount: event.detail || 1 }); });
    this.container.addEventListener("wheel", (event) => { event.preventDefault(); void this.client.input({ kind: "wheel", ...point(event), deltaX: event.deltaX, deltaY: event.deltaY }); }, { passive: false });
    this.container.addEventListener("keydown", (event) => { event.preventDefault(); void this.client.input({ kind: "key", type: "keyDown", key: event.key, code: event.code }); if (event.key.length === 1) void this.client.input({ kind: "key", type: "char", key: event.key }); });
    this.container.addEventListener("keyup", (event) => { event.preventDefault(); void this.client.input({ kind: "key", type: "keyUp", key: event.key, code: event.code }); });
  }
}

/**
 * A narrow automation facade for AI applications. Every operation is routed through the active
 * managed workspace, and the extension rejects it unless the user enabled agent control there.
 * It controls Chrome tabs created for the application; it does not provide operating-system control.
 */
export class ManagedBrowserAgent {
  constructor(private readonly client: RealBrowserClient) {}

  execute(operation: AgentOperation): Promise<unknown> { return this.client.agentExecute(operation); }
  open(url: string, active = true): Promise<unknown> { return this.execute({ type: "open", url, active }); }
  navigate(tabId: number, url: string): Promise<unknown> { return this.execute({ type: "navigate", tabId, url }); }
  reload(tabId: number): Promise<unknown> { return this.execute({ type: "reload", tabId }); }
  snapshot(): Promise<ManagedWorkspaceSnapshot> { return this.client.workspaceSnapshot(); }
  observe(tabId?: number): Promise<SharedTabScreenshot> { return this.client.screenshot(tabId); }
  type(text: string, tabId?: number): Promise<{ ok: true }> { return this.client.agentExecute({ type: "input", ...(tabId ? { tabId } : {}), input: { kind: "text", text } }) as Promise<{ ok: true }>; }
  click(x: number, y: number, tabId?: number): Promise<{ ok: true }> {
    return this.client.agentExecute({ type: "input", ...(tabId ? { tabId } : {}), input: { kind: "pointer", type: "mousePressed", x, y, button: "left", clickCount: 1 } })
      .then(() => this.client.agentExecute({ type: "input", ...(tabId ? { tabId } : {}), input: { kind: "pointer", type: "mouseReleased", x, y, button: "left", clickCount: 1 } })) as Promise<{ ok: true }>;
  }
}

export function createRealBrowserClient(options: RealBrowserClientOptions = {}): RealBrowserClient { return new RealBrowserClient(options); }
export function createManagedBrowserAgent(options: ManagedBrowserAgentOptions): ManagedBrowserAgent { return new ManagedBrowserAgent(options.client); }
