import { describe, expect, it, vi } from 'vitest';
import { ChromiumViewer, normalizeEndpoint } from '../src/index';

describe('normalizeEndpoint', () => {
  it('accepts absolute HTTP URLs and removes a trailing slash', () => {
    expect(normalizeEndpoint(' https://example.test/ ')).toBe('https://example.test');
  });

  it('rejects relative and unsupported URLs', () => {
    expect(() => normalizeEndpoint('/api')).toThrow(/absolute/);
    expect(() => normalizeEndpoint('ws://example.test')).toThrow(/absolute/);
  });
});

describe('ChromiumViewer', () => {
  it('mounts a viewer and sends authenticated navigation requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://example.test' }), { status: 200 })
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewer = new ChromiumViewer({ endpoint: 'http://localhost:8787/', token: 'secret', refreshInterval: 0 });

    viewer.mount(container);
    await viewer.navigate('https://example.test');

    expect(container.contains(viewer.element)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/navigate', expect.objectContaining({
      method: 'POST',
      headers: expect.any(Headers)
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer secret');
    fetchMock.mockRestore();
  });
});

