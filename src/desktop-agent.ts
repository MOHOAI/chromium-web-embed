import type {
  AgentExecutionResult,
  BrowserEvent,
  CoordinateSpace,
  DesktopAgentStatus,
  DesktopScreenFrame,
  ModifierKey,
  MouseButton,
  ScrollDirection,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "./protocol.js";
import { SafetyPolicyEngine, type SafetyPolicyConfig } from "./safety-policy.js";

export interface DesktopBridgeTransport {
  desktopConnect(options?: { url?: string; token?: string }): Promise<DesktopAgentStatus>;
  desktopDisconnect(): Promise<{ ok: boolean }>;
  desktopStatus(): Promise<DesktopAgentStatus>;
  desktopExecute(action: string, payload?: Record<string, unknown>): Promise<unknown>;
  desktopStartStream(options?: DesktopStreamOptions): Promise<{ ok: boolean; streaming: boolean }>;
  desktopStopStream(): Promise<{ ok: boolean; streaming: boolean }>;
  desktopEmergencyStop(closeVirtualDesktop?: boolean): Promise<{ ok: boolean; emergencyStopped: boolean }>;
  desktopResume(): Promise<{ ok: boolean; emergencyStopped: boolean }>;
  onTabEvent(listener: (event: BrowserEvent) => void): () => void;
}

export interface DesktopStreamOptions {
  fps?: number;
  quality?: number;
  format?: "jpeg" | "png";
  maxWidth?: number;
}

export interface WindowsDesktopAgentOptions {
  /** Extension bridge client (recommended: routes web app -> extension -> Windows agent) */
  bridge?: DesktopBridgeTransport;
  /** Transport mode: "extension" routes via Chrome extension; "direct" connects straight to local WebSocket */
  mode?: "extension" | "direct";
  /** Local agent WebSocket endpoint (default ws://127.0.0.1:47892) */
  endpoint?: string;
  /** Auth token printed by moho_desktop_agent.py */
  token?: string;
  /** Optional safety policy engine */
  safety?: SafetyPolicyConfig | SafetyPolicyEngine;
}

export interface DesktopWindowInfo {
  hwnd: number;
  title: string;
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Client for the Moho Windows 10/11 Desktop Computer-Use Agent.
 * Connects via the Moho Browser Workspace Chrome extension (or directly over localhost WebSocket)
 * to create isolated empty Windows 10/11 Virtual Desktops, stream live screen previews,
 * and execute full mouse/drag/keyboard automation.
 */
export class WindowsDesktopAgentClient {
  private readonly bridge?: DesktopBridgeTransport;
  private readonly mode: "extension" | "direct";
  private readonly endpoint: string;
  private token: string;
  private readonly safety: SafetyPolicyEngine;

  private ws?: WebSocket;
  private directPending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private frameListeners = new Set<(frame: DesktopScreenFrame) => void>();
  private unsubBridge?: () => void;

  constructor(options: WindowsDesktopAgentOptions = {}) {
    this.bridge = options.bridge;
    this.mode = options.mode ?? (options.bridge ? "extension" : "direct");
    this.endpoint = options.endpoint ?? "ws://127.0.0.1:47892";
    this.token = options.token ?? "";
    this.safety =
      options.safety instanceof SafetyPolicyEngine
        ? options.safety
        : new SafetyPolicyEngine(options.safety);

    if (this.bridge) {
      this.unsubBridge = this.bridge.onTabEvent((ev) => {
        if (ev.type === "desktop.frame" && ev.payload) {
          this.emitFrame(ev.payload as unknown as DesktopScreenFrame);
        }
      });
    }
  }

  private emitFrame(frame: DesktopScreenFrame): void {
    for (const cb of this.frameListeners) {
      try {
        cb(frame);
      } catch {
        // ignore listener errors
      }
    }
  }

  setToken(token: string): void {
    this.token = token;
  }

  onFrame(listener: (frame: DesktopScreenFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  private async directCall<T = unknown>(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 15000
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new Error("Direct WebSocket to Windows Desktop Agent is not connected. Call connect() first.");
    }
    const id = `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.directPending.delete(id);
        reject(new Error(`Desktop agent request "${action}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.directPending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify({ id, action, token: this.token, payload }));
    });
  }

  async connect(options?: { url?: string; token?: string }): Promise<DesktopAgentStatus> {
    if (options?.token !== undefined) this.token = options.token;
    const url = options?.url ?? this.endpoint;

    if (this.mode === "extension") {
      if (!this.bridge) {
        throw new Error("WindowsDesktopAgentClient requires a RealBrowserClient bridge in extension mode.");
      }
      return this.bridge.desktopConnect({ url, token: this.token });
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket API is unavailable in this environment.");
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error(`Failed to connect to Windows Desktop Agent at ${url}`));
      ws.onclose = () => {
        for (const p of this.directPending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("Desktop Agent WebSocket closed."));
        }
        this.directPending.clear();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (msg.event === "desktop.frame" && msg.data) {
            this.emitFrame(msg.data as DesktopScreenFrame);
            return;
          }
          if (typeof msg.id === "string" && this.directPending.has(msg.id)) {
            const p = this.directPending.get(msg.id)!;
            this.directPending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.ok) p.resolve(msg.data);
            else p.reject(new Error(String(msg.error ?? "Desktop agent error")));
          }
        } catch {
          // ignore malformed messages
        }
      };
    });

    return this.status();
  }

  async disconnect(): Promise<void> {
    if (this.mode === "extension" && this.bridge) {
      await this.bridge.desktopDisconnect();
      return;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  async status(): Promise<DesktopAgentStatus> {
    if (this.mode === "extension" && this.bridge) {
      return this.bridge.desktopStatus();
    }
    return this.directCall<DesktopAgentStatus>("status");
  }

  private async exec<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (this.mode === "extension" && this.bridge) {
      return (await this.bridge.desktopExecute(action, payload)) as T;
    }
    return this.directCall<T>(action, payload);
  }

  // --- Virtual Desktop Management (Windows 10 / 11) ---
  async createVirtualDesktop(options?: {
    launchApp?: string;
    launchArgs?: string[];
  }): Promise<{ ok: boolean; virtualDesktopActive: boolean; createdCount: number; message?: string }> {
    return this.exec("create_virtual_desktop", options ?? {});
  }

  async switchVirtualDesktop(direction: "left" | "right" = "right"): Promise<{ ok: boolean; direction: string }> {
    return this.exec("switch_virtual_desktop", { direction });
  }

  async closeVirtualDesktop(): Promise<{ ok: boolean; virtualDesktopActive: boolean }> {
    return this.exec("close_virtual_desktop");
  }

  // --- Live Screen Preview Streaming ---
  async startLivePreview(options?: DesktopStreamOptions): Promise<{ ok: boolean; streaming: boolean }> {
    if (this.mode === "extension" && this.bridge) {
      return this.bridge.desktopStartStream(options);
    }
    return this.directCall("start_stream", (options ?? {}) as Record<string, unknown>);
  }

  async stopLivePreview(): Promise<{ ok: boolean; streaming: boolean }> {
    if (this.mode === "extension" && this.bridge) {
      return this.bridge.desktopStopStream();
    }
    return this.directCall("stop_stream");
  }

  async emergencyStop(closeVirtualDesktop = false): Promise<{ ok: boolean; emergencyStopped: boolean }> {
    if (this.mode === "extension" && this.bridge) {
      return this.bridge.desktopEmergencyStop(closeVirtualDesktop);
    }
    return this.directCall("emergency_stop", { closeVirtualDesktop });
  }

  async resume(): Promise<{ ok: boolean; emergencyStopped: boolean }> {
    if (this.mode === "extension" && this.bridge) {
      return this.bridge.desktopResume();
    }
    return this.directCall("resume");
  }

  // --- Screenshot & Vision ---
  async screenshot(options?: {
    format?: "png" | "jpeg";
    quality?: number;
    maxWidth?: number;
  }): Promise<SharedTabScreenshot> {
    const frame = await this.exec<DesktopScreenFrame>("screenshot", options ?? {});
    return {
      tabId: 0,
      url: "windows://virtual-desktop",
      title: "Windows Virtual Desktop",
      format: frame.format,
      mimeType: frame.mimeType,
      dataUrl: frame.dataUrl,
      base64: frame.base64,
      width: frame.width,
      height: frame.height,
      devicePixelRatio: 1,
      capturedAt: frame.capturedAt,
    };
  }

  async zoom(
    region: [number, number, number, number],
    coordinateSpace: CoordinateSpace = "pixels"
  ): Promise<DesktopScreenFrame> {
    return this.exec<DesktopScreenFrame>("zoom", { region, coordinateSpace });
  }

  // --- Full Mouse & Keyboard Control ---
  async move(x: number, y: number, options?: { smooth?: boolean; steps?: number; coordinateSpace?: CoordinateSpace }) {
    return this.exec("move", { x, y, ...options });
  }

  async click(
    x: number,
    y: number,
    options?: { button?: MouseButton; clickCount?: number; modifiers?: ModifierKey[]; coordinateSpace?: CoordinateSpace }
  ) {
    return this.exec("click", { x, y, ...options });
  }

  async doubleClick(x: number, y: number, coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("double_click", { x, y, coordinateSpace });
  }

  async tripleClick(x: number, y: number, coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("triple_click", { x, y, coordinateSpace });
  }

  async rightClick(x: number, y: number, coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("right_click", { x, y, coordinateSpace });
  }

  async middleClick(x: number, y: number, coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("middle_click", { x, y, coordinateSpace });
  }

  async mouseDown(x?: number, y?: number, button: MouseButton = "left", coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("mouse_down", { x, y, button, coordinateSpace });
  }

  async mouseUp(x?: number, y?: number, button: MouseButton = "left", coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("mouse_up", { x, y, button, coordinateSpace });
  }

  async longPress(x: number, y: number, seconds = 1.5, button: MouseButton = "left", coordinateSpace: CoordinateSpace = "pixels") {
    return this.exec("long_press", { x, y, seconds, button, coordinateSpace });
  }

  async dragAndDrop(options: {
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    path?: Array<{ x: number; y: number }>;
    button?: MouseButton;
    steps?: number;
    modifiers?: ModifierKey[];
    coordinateSpace?: CoordinateSpace;
  }) {
    return this.exec("drag_and_drop", options as Record<string, unknown>);
  }

  async scroll(options: {
    x?: number;
    y?: number;
    direction?: ScrollDirection;
    magnitudeInPixels?: number;
    deltaX?: number;
    deltaY?: number;
    modifiers?: ModifierKey[];
    coordinateSpace?: CoordinateSpace;
  }) {
    return this.exec("scroll", options as Record<string, unknown>);
  }

  async type(
    text: string,
    options?: { x?: number; y?: number; pressEnter?: boolean; clearFirst?: boolean; coordinateSpace?: CoordinateSpace }
  ) {
    return this.exec("type", { text, ...options });
  }

  async pressKey(key: string, options?: { repeat?: number; modifiers?: ModifierKey[] }) {
    return this.exec("press_key", { key, ...options });
  }

  async keyDown(key: string) {
    return this.exec("key_down", { key });
  }

  async keyUp(key: string) {
    return this.exec("key_up", { key });
  }

  async holdKey(key: string, seconds = 1, modifiers?: ModifierKey[]) {
    return this.exec("hold_key", { key, seconds, modifiers });
  }

  async hotkey(keys: string[]) {
    return this.exec("hotkey", { keys });
  }

  async listWindows(): Promise<DesktopWindowInfo[]> {
    const res = await this.exec<{ windows: DesktopWindowInfo[] }>("list_windows");
    return res.windows ?? [];
  }

  async inspectWindowControls(options?: { hwnd?: number; maxControls?: number }): Promise<{
    hwnd: number;
    controls: Array<{
      index: number;
      hwnd: number;
      className: string;
      text: string;
      rect: { x: number; y: number; width: number; height: number };
      center: { x: number; y: number };
    }>;
  }> {
    return this.exec("inspect_window_controls", options ?? {});
  }

  async focusWindow(options: { hwnd?: number; titleContains?: string }) {
    return this.exec("focus_window", options as Record<string, unknown>);
  }

  async launchApp(command: string, args?: string[]) {
    return this.exec("launch_app", { command, args });
  }

  async clipboardGet(): Promise<string> {
    const res = await this.exec<{ text: string }>("clipboard_get");
    return res.text ?? "";
  }

  async clipboardSet(text: string): Promise<void> {
    await this.exec("clipboard_set", { text });
  }

  /**
   * Compatible with `ComputerUseAgentRunner` so Gemini / Claude / OpenAI CUA
   * can drive the isolated Windows 10/11 Virtual Desktop directly!
   */
  async executeComputerAction(
    action: UnifiedComputerAction | Record<string, unknown>
  ): Promise<AgentExecutionResult> {
    const started = Date.now();
    const unified = action as UnifiedComputerAction;
    const decision = this.safety.evaluateAction(unified);
    if (decision.decision === "blocked") {
      return {
        ok: false,
        actionType: unified.type,
        tabId: 0,
        url: "windows://virtual-desktop",
        error: decision.explanation ?? "Action blocked by safety policy",
        durationMs: 0,
      };
    }

    try {
      const data = await this.exec(unified.type, unified as unknown as Record<string, unknown>);
      return {
        ok: true,
        actionType: unified.type,
        tabId: 0,
        url: "windows://virtual-desktop",
        title: "Windows Virtual Desktop",
        data,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        actionType: unified.type,
        tabId: 0,
        url: "windows://virtual-desktop",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  dispose(): void {
    this.unsubBridge?.();
    this.frameListeners.clear();
    void this.disconnect();
  }
}

export interface DesktopLiveViewerOptions {
  agent: WindowsDesktopAgentClient;
  container: HTMLElement;
  interactive?: boolean;
  streamOptions?: DesktopStreamOptions;
}

/**
 * Interactive Live Screen Preview Viewer for the Windows 10/11 Virtual Desktop.
 * Accurately maps clicks, right-clicks, double-clicks, drag-and-drop, wheel scrolling,
 * and keyboard input even when the preview is letterboxed (`object-fit: contain`).
 */
export class DesktopLiveViewer {
  private readonly agent: WindowsDesktopAgentClient;
  private readonly container: HTMLElement;
  private readonly interactive: boolean;
  private readonly streamOptions: DesktopStreamOptions;
  private readonly img: HTMLImageElement;
  private lastFrame?: DesktopScreenFrame;
  private unsubFrame?: () => void;
  private isDragging = false;
  private dragStart?: { x: number; y: number };
  private dragButton: MouseButton = "left";

  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;
  private readonly onDblClick: (e: MouseEvent) => void;
  private readonly onContextMenu: (e: MouseEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(options: DesktopLiveViewerOptions) {
    this.agent = options.agent;
    this.container = options.container;
    this.interactive = options.interactive ?? true;
    this.streamOptions = options.streamOptions ?? { fps: 10, quality: 70, format: "jpeg", maxWidth: 1280 };

    this.img = document.createElement("img");
    this.img.style.width = "100%";
    this.img.style.height = "100%";
    this.img.style.objectFit = "contain";
    this.img.style.display = "block";
    this.img.style.userSelect = "none";
    this.img.draggable = false;
    this.img.tabIndex = 0;
    this.container.appendChild(this.img);

    this.onMouseDown = (e: MouseEvent) => {
      if (!this.interactive) return;
      const pt = this.mapCoords(e);
      if (!pt) return;
      this.img.focus();
      this.dragButton = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
      this.dragStart = pt;
      this.isDragging = true;
      void this.agent.mouseDown(pt.x, pt.y, this.dragButton);
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.interactive || !this.isDragging) return;
      const pt = this.mapCoords(e);
      if (!pt) return;
      void this.agent.move(pt.x, pt.y);
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (!this.interactive || !this.isDragging) return;
      const pt = this.mapCoords(e);
      this.isDragging = false;
      this.dragStart = undefined;
      if (!pt) return;
      void this.agent.mouseUp(pt.x, pt.y, this.dragButton);
    };

    this.onDblClick = (e: MouseEvent) => {
      if (!this.interactive) return;
      const pt = this.mapCoords(e);
      if (!pt) return;
      void this.agent.doubleClick(pt.x, pt.y);
    };

    this.onContextMenu = (e: MouseEvent) => {
      if (this.interactive) e.preventDefault();
    };

    this.onWheel = (e: WheelEvent) => {
      if (!this.interactive) return;
      const pt = this.mapCoords(e);
      if (!pt) return;
      e.preventDefault();
      void this.agent.scroll({ x: pt.x, y: pt.y, deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) });
    };

    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.interactive) return;
      e.preventDefault();
      const mods: ModifierKey[] = [];
      if (e.ctrlKey) mods.push("ctrl");
      if (e.altKey) mods.push("alt");
      if (e.shiftKey) mods.push("shift");
      if (e.metaKey) mods.push("win");
      if (e.key.length === 1 && mods.length === 0) {
        void this.agent.type(e.key);
      } else {
        void this.agent.pressKey(e.key, { modifiers: mods });
      }
    };

    this.img.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.img.addEventListener("dblclick", this.onDblClick);
    this.img.addEventListener("contextmenu", this.onContextMenu);
    this.img.addEventListener("wheel", this.onWheel, { passive: false });
    this.img.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Computes exact real-screen pixel coordinates inside an `object-fit: contain` image box.
   */
  private mapCoords(e: MouseEvent): { x: number; y: number } | null {
    if (!this.lastFrame) return null;
    const rect = this.img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const imgAspect = this.lastFrame.width / Math.max(1, this.lastFrame.height);
    const boxAspect = rect.width / rect.height;

    let renderW = rect.width;
    let renderH = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (imgAspect > boxAspect) {
      renderH = rect.width / imgAspect;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderW = rect.height * imgAspect;
      offsetX = (rect.width - renderW) / 2;
    }

    const relX = (e.clientX - rect.left - offsetX) / renderW;
    const relY = (e.clientY - rect.top - offsetY) / renderH;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

    return {
      x: Math.round(relX * this.lastFrame.screenWidth),
      y: Math.round(relY * this.lastFrame.screenHeight),
    };
  }

  async start(): Promise<void> {
    this.unsubFrame = this.agent.onFrame((frame) => {
      this.lastFrame = frame;
      this.img.src = frame.dataUrl;
    });
    await this.agent.startLivePreview(this.streamOptions);
  }

  async stop(): Promise<void> {
    this.unsubFrame?.();
    this.unsubFrame = undefined;
    await this.agent.stopLivePreview();
  }

  dispose(): void {
    void this.stop();
    this.img.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.img.removeEventListener("dblclick", this.onDblClick);
    this.img.removeEventListener("contextmenu", this.onContextMenu);
    this.img.removeEventListener("wheel", this.onWheel);
    this.img.removeEventListener("keydown", this.onKeyDown);
    this.img.remove();
  }
}

export function createWindowsDesktopAgent(
  options?: WindowsDesktopAgentOptions
): WindowsDesktopAgentClient {
  return new WindowsDesktopAgentClient(options);
}


export const MOHO_PROTOCOL_URLS = {
  startSandbox: "moho-agent://start-sandbox",
  startAgent: "moho-agent://start-agent",
  openWorkspace: "moho-agent://open-workspace",
  openPersistent: "moho-agent://open-persistent",
} as const;

export type MohoProtocolAction = keyof typeof MOHO_PROTOCOL_URLS;

export const MOHO_DOWNLOAD_URLS = {
  extensionZip: "https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/extension-download/real-browser-web-bridge-extension.zip",
  desktopAgentZip: "https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip",
  installerBat: "https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/Moho-OneClick-Installer.bat",
  repository: "https://github.com/MOHOAI/chromium-web-embed",
  releases: "https://github.com/MOHOAI/chromium-web-embed/releases",
} as const;

export function triggerMohoProtocol(action: MohoProtocolAction): string {
  const uri = MOHO_PROTOCOL_URLS[action];
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return uri;
}

export function launchOrInstallMohoAgent(
  action: MohoProtocolAction = "startSandbox",
  fallbackDelayMs = 1800,
  onFallbackDownload?: (installerUrl: string) => void
): void {
  triggerMohoProtocol(action);
  if (typeof window === "undefined") return;
  let blurred = false;
  const onBlur = () => { blurred = true; };
  window.addEventListener("blur", onBlur, { once: true });
  window.setTimeout(() => {
    window.removeEventListener("blur", onBlur);
    if (!blurred) {
      const url = MOHO_DOWNLOAD_URLS.installerBat;
      if (onFallbackDownload) onFallbackDownload(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Moho-OneClick-Installer.bat";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, fallbackDelayMs);
}
