import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  BrowserEvent,
  BrowserTab,
  BridgeCommand,
  BridgeResponse,
  ExtensionStatus,
  SharedTabInput,
  SharedTabScreenshot,
  TabAction,
  isBridgeEvent,
  isBridgeResponse,
  normalizeTabUrl,
} from "./protocol";

export {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  normalizeTabUrl,
  type BrowserEvent,
  type BrowserTab,
  type ExtensionStatus,
  type SharedTabInput,
  type SharedTabScreenshot,
  type TabAction,
} from "./protocol";

export type RealBrowserClientOptions = { targetOrigin?: string; timeoutMs?: number };
export type OpenTabOptions = { active?: boolean; pinned?: boolean; index?: number };
export type TabListener = (event: BrowserEvent) => void;
export type SharedTabViewerOptions = { refreshIntervalMs?: number; onError?: (error: Error) => void; onFrame?: (frame: SharedTabScreenshot) => void };

type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };

/**
 * A client for the bundled Manifest V3 extension. Interactive input and screenshots are limited
 * to the single tab that the user explicitly selects through the extension popup.
 */
export class RealBrowserClient {
  private readonly targetOrigin: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<TabListener>();
  private disposed = false;

  constructor(options: RealBrowserClientOptions = {}) {
    if (typeof window === "undefined") throw new Error("RealBrowserClient must run in a browser window.");
    this.targetOrigin = options.targetOrigin ?? window.location.origin;
    this.timeoutMs = options.timeoutMs ?? 1_500;
    window.addEventListener("message", this.receive);
  }

  async connect(): Promise<ExtensionStatus> { const status = await this.status(); await this.request("subscribe"); return status; }
  status(): Promise<ExtensionStatus> { return this.request("status"); }
  open(url: string, options: OpenTabOptions = {}): Promise<{ tab: BrowserTab }> { return this.request("open", { url: normalizeTabUrl(url), ...options }); }
  list(currentWindow = true): Promise<{ tabs: BrowserTab[] }> { return this.request("list", { currentWindow }); }
  active(): Promise<{ tab: BrowserTab | null }> { return this.request("active"); }
  navigate(tabId: number, url: string): Promise<{ tab: BrowserTab }> { return this.request("navigate", { tabId, url: normalizeTabUrl(url) }); }
  activate(tabId: number): Promise<{ tab: BrowserTab }> { return this.request("activate", { tabId }); }
  reload(tabId: number): Promise<{ ok: true }> { return this.request("reload", { tabId }); }
  back(tabId: number): Promise<{ ok: true }> { return this.request("back", { tabId }); }
  forward(tabId: number): Promise<{ ok: true }> { return this.request("forward", { tabId }); }
  close(tabId: number): Promise<{ ok: true }> { return this.request("close", { tabId }); }
  pin(tabId: number, pinned = true): Promise<{ tab: BrowserTab }> { return this.request("pin", { tabId, pinned }); }
  mute(tabId: number, muted = true): Promise<{ tab: BrowserTab }> { return this.request("mute", { tabId, muted }); }
  shared(): Promise<{ tab: BrowserTab | null }> { return this.request("shared"); }
  screenshot(): Promise<SharedTabScreenshot> { return this.request("screenshot"); }
  input(input: SharedTabInput): Promise<{ ok: true }> { return this.request("input", { input }); }
  stopSharing(): Promise<{ ok: true }> { return this.request("stopShare"); }

  onTabEvent(listener: TabListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.receive);
    for (const [requestId, pending] of this.pending) { window.clearTimeout(pending.timer); pending.reject(new Error("The real browser client was disposed.")); this.pending.delete(requestId); }
    this.listeners.clear();
  }

  private request<T>(action: TabAction, data?: Record<string, unknown>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("The real browser client was disposed."));
    const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const command: BridgeCommand = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) };
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error("The real browser extension did not respond. Check that it is installed and that this origin is allowed.")); }, this.timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      window.postMessage(command, this.targetOrigin);
    });
  }

  private receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== this.targetOrigin) return;
    const message = event.data;
    if (isBridgeEvent(message)) { this.listeners.forEach((listener) => listener(message.event)); return; }
    if (!isBridgeResponse(message)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    window.clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error ?? "The extension rejected the command."));
  };
}

/** Renders periodic frames from the user-shared Chrome tab and forwards input to that same tab. */
export class SharedTabViewer {
  private readonly image = document.createElement("img");
  private readonly interval: number;
  private timer?: number;
  private disposed = false;

  constructor(private readonly client: RealBrowserClient, private readonly container: HTMLElement, private readonly options: SharedTabViewerOptions = {}) {
    this.interval = Math.max(200, options.refreshIntervalMs ?? 350);
    this.image.alt = "لقطة للتبويب الذي شاركه المستخدم";
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

export function createRealBrowserClient(options: RealBrowserClientOptions = {}): RealBrowserClient { return new RealBrowserClient(options); }
