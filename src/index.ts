export type InputEvent =
  | { type: 'mouse'; action: 'move' | 'down' | 'up' | 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keyboard'; action: 'down' | 'up'; key: string };

export interface ChromiumViewerOptions {
  /** Base URL of the Chromium control server, for example http://localhost:8787. */
  endpoint: string;
  /** Optional bearer token sent with every request. */
  token?: string;
  /** Refresh interval for screenshots in milliseconds. Set to 0 to disable polling. */
  refreshInterval?: number;
  /** Automatically focus the viewer when it is mounted. */
  autoFocus?: boolean;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

export interface EvaluateOptions {
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

export interface ChromiumViewerEvents {
  onError?: (error: Error) => void;
  onScreenshot?: (image: Blob) => void;
}

function normalizeEndpoint(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(normalized)) {
    throw new TypeError('endpoint must be an absolute http:// or https:// URL');
  }
  return normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * A lightweight browser-side viewer for a remote Chromium page.
 * The server returns JPEG screenshots and accepts input events over HTTP.
 */
export class ChromiumViewer {
  readonly element: HTMLDivElement;
  private readonly image: HTMLImageElement;
  private readonly endpoint: string;
  private readonly token?: string;
  private readonly refreshInterval: number;
  private readonly events: ChromiumViewerEvents;
  private timer?: number;
  private objectUrl?: string;
  private running = false;

  constructor(options: ChromiumViewerOptions, events: ChromiumViewerEvents = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.token = options.token;
    this.refreshInterval = options.refreshInterval ?? 250;
    this.events = events;

    this.element = document.createElement('div');
    this.element.className = 'chromium-web-embed-viewer';
    this.element.tabIndex = 0;
    this.element.style.position = 'relative';
    this.element.style.overflow = 'hidden';
    this.element.style.background = '#111';
    this.element.setAttribute('aria-label', 'Embedded Chromium browser');

    this.image = document.createElement('img');
    this.image.alt = 'Embedded Chromium browser';
    this.image.draggable = false;
    this.image.style.display = 'block';
    this.image.style.width = '100%';
    this.image.style.height = '100%';
    this.image.style.objectFit = 'contain';
    this.image.style.userSelect = 'none';
    this.image.style.pointerEvents = 'none';
    this.element.appendChild(this.image);

    this.bindInputEvents();
    if (options.autoFocus) this.element.focus();
  }

  mount(container: HTMLElement): this {
    container.appendChild(this.element);
    return this;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.refresh();
    if (this.refreshInterval > 0) {
      this.timer = window.setInterval(() => void this.refresh(), this.refreshInterval);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.releaseObjectUrl();
  }

  async refresh(): Promise<void> {
    try {
      const response = await this.request('/screenshot');
      if (!response.ok) throw await this.responseError(response);
      const blob = await response.blob();
      this.releaseObjectUrl();
      this.objectUrl = URL.createObjectURL(blob);
      this.image.src = this.objectUrl;
      this.events.onScreenshot?.(blob);
    } catch (error) {
      this.reportError(error);
    }
  }

  async navigate(url: string, options: NavigateOptions = {}): Promise<{ url: string }> {
    if (!url.trim()) throw new TypeError('url must not be empty');
    const response = await this.request('/navigate', {
      method: 'POST',
      body: JSON.stringify({ url, ...options })
    });
    if (!response.ok) throw await this.responseError(response);
    return response.json() as Promise<{ url: string }>;
  }

  async evaluate<T = unknown>(options: EvaluateOptions): Promise<T> {
    if (!options.expression.trim()) throw new TypeError('expression must not be empty');
    const response = await this.request('/evaluate', {
      method: 'POST',
      body: JSON.stringify(options)
    });
    if (!response.ok) throw await this.responseError(response);
    const payload = (await response.json()) as { value: T };
    return payload.value;
  }

  async sendInput(event: InputEvent): Promise<void> {
    const response = await this.request('/input', {
      method: 'POST',
      body: JSON.stringify(event)
    });
    if (!response.ok) throw await this.responseError(response);
  }

  private bindInputEvents(): void {
    this.element.addEventListener('pointermove', (event) => {
      void this.sendInput(this.pointerEvent('move', event)).catch((error) => this.reportError(error));
    });
    this.element.addEventListener('pointerdown', (event) => {
      this.element.focus();
      void this.sendInput(this.pointerEvent('down', event)).catch((error) => this.reportError(error));
    });
    this.element.addEventListener('pointerup', (event) => {
      void this.sendInput(this.pointerEvent('up', event)).catch((error) => this.reportError(error));
    });
    this.element.addEventListener('wheel', (event) => {
      event.preventDefault();
      const point = this.pointFromEvent(event);
      void this.sendInput({
        type: 'wheel',
        ...point,
        deltaX: event.deltaX,
        deltaY: event.deltaY
      }).catch((error) => this.reportError(error));
    }, { passive: false });
    this.element.addEventListener('keydown', (event) => {
      event.preventDefault();
      void this.sendInput({ type: 'keyboard', action: 'down', key: event.key }).catch((error) => this.reportError(error));
    });
    this.element.addEventListener('keyup', (event) => {
      event.preventDefault();
      void this.sendInput({ type: 'keyboard', action: 'up', key: event.key }).catch((error) => this.reportError(error));
    });
  }

  private pointerEvent(action: 'move' | 'down' | 'up' | 'click', event: PointerEvent | MouseEvent): InputEvent {
    return {
      type: 'mouse',
      action,
      ...this.pointFromEvent(event),
      button: event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left'
    };
  }

  private pointFromEvent(event: MouseEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    const naturalWidth = this.image.naturalWidth || rect.width;
    const naturalHeight = this.image.naturalHeight || rect.height;
    return {
      x: clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * naturalWidth, 0, naturalWidth),
      y: clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * naturalHeight, 0, naturalHeight)
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    return fetch(`${this.endpoint}${path}`, { ...init, headers });
  }

  private async responseError(response: Response): Promise<Error> {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    return new Error(message);
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.events.onError?.(normalized);
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }
}

export function createChromiumViewer(
  container: HTMLElement,
  options: ChromiumViewerOptions,
  events: ChromiumViewerEvents = {}
): ChromiumViewer {
  const viewer = new ChromiumViewer(options, events);
  viewer.mount(container);
  return viewer;
}

export { normalizeEndpoint };

