import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, Page } from 'playwright-core';
import type { InputEvent, NavigateOptions, EvaluateOptions } from './index.js';

export interface ChromiumControlServerOptions {
  browser: Browser;
  page?: Page;
  token?: string;
  corsOrigin?: string;
  screenshotQuality?: number;
  maxBodyBytes?: number;
}

export interface ListenOptions {
  host?: string;
  port?: number;
}

export interface ServerAddress {
  host: string;
  port: number;
  url: string;
}

export class ChromiumControlServer {
  readonly browser: Browser;
  readonly pagePromise: Promise<Page>;
  private readonly token?: string;
  private readonly corsOrigin: string;
  private readonly screenshotQuality: number;
  private readonly maxBodyBytes: number;
  private server?: Server;
  private page?: Page;

  constructor(options: ChromiumControlServerOptions) {
    this.browser = options.browser;
    this.token = options.token;
    this.corsOrigin = options.corsOrigin ?? '*';
    this.screenshotQuality = Math.max(1, Math.min(100, Math.round(options.screenshotQuality ?? 80)));
    this.maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
    this.pagePromise = options.page ? Promise.resolve(options.page) : this.browser.newPage();
    void this.pagePromise.then((page) => { this.page = page; });
  }

  async listen(options: ListenOptions = {}): Promise<ServerAddress> {
    if (this.server) throw new Error('ChromiumControlServer is already listening');
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => this.writeError(response, error));
    });
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 8787;
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    return { host: address.address, port: address.port, url: `http://${host}:${address.port}` };
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.setCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!this.authorized(request)) {
      this.writeJson(response, 401, { error: 'Unauthorized' });
      return;
    }

    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'GET' && path === '/health') {
      this.writeJson(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && path === '/screenshot') {
      const page = await this.getPage();
      const image = await page.screenshot({ type: 'jpeg', quality: this.screenshotQuality });
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      response.end(image);
      return;
    }
    if (request.method === 'POST' && path === '/navigate') {
      const body = await this.readJson(request) as { url?: string } & NavigateOptions;
      if (!body.url || !/^https?:\/\//i.test(body.url)) throw new TypeError('url must be an http:// or https:// URL');
      const page = await this.getPage();
      await page.goto(body.url, { waitUntil: body.waitUntil ?? 'load', timeout: body.timeout });
      this.writeJson(response, 200, { url: page.url() });
      return;
    }
    if (request.method === 'POST' && path === '/evaluate') {
      const body = await this.readJson(request) as EvaluateOptions;
      if (!body.expression?.trim()) throw new TypeError('expression must not be empty');
      const page = await this.getPage();
      const value = await page.evaluate(body.expression);
      this.writeJson(response, 200, { value });
      return;
    }
    if (request.method === 'POST' && path === '/input') {
      const event = await this.readJson(request) as InputEvent;
      await this.applyInput(event);
      this.writeJson(response, 204, undefined);
      return;
    }
    this.writeJson(response, 404, { error: 'Not found' });
  }

  private async applyInput(event: InputEvent): Promise<void> {
    const page = await this.getPage();
    if (event.type === 'mouse') {
      const point = { x: event.x, y: event.y };
      if (event.action === 'move') await page.mouse.move(point.x, point.y);
      else if (event.action === 'down') await page.mouse.down({ button: event.button ?? 'left' });
      else if (event.action === 'up') await page.mouse.up({ button: event.button ?? 'left' });
      else await page.mouse.click(point.x, point.y, { button: event.button ?? 'left' });
      return;
    }
    if (event.type === 'wheel') {
      await page.mouse.move(event.x, event.y);
      await page.mouse.wheel(event.deltaX, event.deltaY);
      return;
    }
    if (event.type === 'keyboard') {
      if (event.action === 'down') await page.keyboard.down(event.key);
      else await page.keyboard.up(event.key);
      return;
    }
    throw new TypeError('Unsupported input event');
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.page = await this.pagePromise;
    return this.page;
  }

  private authorized(request: IncomingMessage): boolean {
    if (!this.token) return true;
    const authorization = request.headers.authorization ?? '';
    return authorization === `Bearer ${this.token}`;
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > this.maxBodyBytes) throw new Error('Request body is too large');
      chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new TypeError('Request body must be valid JSON');
    }
  }

  private setCors(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  private writeJson(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, value === undefined ? {} : { 'Content-Type': 'application/json' });
    if (value !== undefined) response.end(JSON.stringify(value));
    else response.end();
  }

  private writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.writeJson(response, 400, { error: message });
  }
}

export function createChromiumControlServer(options: ChromiumControlServerOptions): ChromiumControlServer {
  return new ChromiumControlServer(options);
}

