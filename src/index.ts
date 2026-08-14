import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  BrowserEvent,
  BrowserTab,
  BridgeCommand,
  BridgeResponse,
  ExtensionStatus,
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
  type TabAction,
} from "./protocol";

export type RealBrowserClientOptions = {
  /** Origin used for the local postMessage bridge. Defaults to the current page origin. */
  targetOrigin?: string;
  /** Maximum time to wait for a response from the installed extension. */
  timeoutMs?: number;
};

export type OpenTabOptions = { active?: boolean; pinned?: boolean; index?: number };
export type TabListener = (event: BrowserEvent) => void;

type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };

/**
 * A client for the bundled Manifest V3 extension. It controls the user's real Chrome tabs;
 * it never streams, screenshots, embeds, or executes JavaScript inside remote pages.
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

  async connect(): Promise<ExtensionStatus> {
    const status = await this.status();
    await this.request("subscribe");
    return status;
  }

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

  onTabEvent(listener: TabListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.receive);
    for (const [requestId, pending] of this.pending) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("The real browser client was disposed."));
      this.pending.delete(requestId);
    }
    this.listeners.clear();
  }

  private request<T>(action: TabAction, data?: Record<string, unknown>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("The real browser client was disposed."));
    const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const command: BridgeCommand = { channel: BRIDGE_CHANNEL, version: BRIDGE_VERSION, kind: "command", requestId, action, ...(data ? { data } : {}) };
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The real browser extension did not respond. Check that it is installed and that this origin is allowed."));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      window.postMessage(command, this.targetOrigin);
    });
  }

  private receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== this.targetOrigin) return;
    const message = event.data;
    if (isBridgeEvent(message)) {
      this.listeners.forEach((listener) => listener(message.event));
      return;
    }
    if (!isBridgeResponse(message)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    window.clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error ?? "The extension rejected the command."));
  };
}

export function createRealBrowserClient(options: RealBrowserClientOptions = {}): RealBrowserClient {
  return new RealBrowserClient(options);
}
