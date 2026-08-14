import { afterEach, describe, expect, it } from 'vitest';
import { ChromiumControlServer } from '../src/server';

const pages: Array<Record<string, unknown>> = [];
const fakePage = {
  isClosed: () => false,
  url: () => 'https://example.test/',
  screenshot: async () => Buffer.from('jpeg'),
  goto: async () => undefined,
  evaluate: async (expression: string) => ({ expression }),
  mouse: {
    move: async () => undefined,
    down: async () => undefined,
    up: async () => undefined,
    click: async () => undefined,
    wheel: async () => undefined
  },
  keyboard: {
    down: async () => undefined,
    up: async () => undefined
  }
};

const fakeBrowser = {
  newPage: async () => fakePage
};

const servers: ChromiumControlServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()?.close();
  pages.length = 0;
});

describe('ChromiumControlServer', () => {
  it('serves health and protects routes with a bearer token', async () => {
    const server = new ChromiumControlServer({
      browser: fakeBrowser as never,
      token: 'secret'
    });
    servers.push(server);
    const address = await server.listen({ port: 0 });

    const unauthorized = await fetch(`${address.url}/health`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${address.url}/health`, {
      headers: { Authorization: 'Bearer secret' }
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true });
  });

  it('returns screenshots and accepts navigation, evaluation, and input', async () => {
    const server = new ChromiumControlServer({ browser: fakeBrowser as never });
    servers.push(server);
    const address = await server.listen({ port: 0 });

    const screenshot = await fetch(`${address.url}/screenshot`);
    expect(screenshot.status).toBe(200);
    expect(screenshot.headers.get('content-type')).toContain('image/jpeg');

    const navigation = await fetch(`${address.url}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test' })
    });
    expect(navigation.status).toBe(200);

    const evaluation = await fetch(`${address.url}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: '1 + 1' })
    });
    expect(await evaluation.json()).toEqual({ value: { expression: '1 + 1' } });

    const input = await fetch(`${address.url}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'mouse', action: 'click', x: 10, y: 20 })
    });
    expect(input.status).toBe(204);
  });
});

