import { describe, expect, it } from 'vitest';
import worker, { SECURITY_HEADERS } from '../src/index';

const ctx = { waitUntil() {}, passThroughOnException() {} } as never;

function envFor(asset: () => Promise<Response> = async () => new Response('asset')) {
  return { ASSETS: { fetch: asset } } as never;
}

const call = (request: Request, env: unknown = envFor()) =>
  (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(request, env, ctx);

function expectHardened(response: Response) {
  for (const [name, value] of SECURITY_HEADERS) expect(response.headers.get(name)).toBe(value);
}

describe('M11 baseline security headers', () => {
  it('hardens API success responses without changing the body or status', async () => {
    const response = await call(new Request('https://x.test/api/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, osuConfigured: false });
    expectHardened(response);
  });

  it('hardens API error and not-found responses', async () => {
    const method = await call(new Request('https://x.test/api/health', { method: 'POST' }));
    expect(method.status).toBe(405);
    expectHardened(method);
    const missing = await call(new Request('https://x.test/api/nope'));
    expect(missing.status).toBe(404);
    expectHardened(missing);
  });

  it('hardens static assets and preserves their content type', async () => {
    const env = envFor(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
    const response = await call(new Request('https://x.test/'), env);
    expect(await response.text()).toBe('<!doctype html>');
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expectHardened(response);
  });

  it('replaces a weaker upstream value instead of appending a duplicate', async () => {
    const env = envFor(async () => new Response('asset', {
      headers: { 'X-Content-Type-Options': 'sniff-me', 'Referrer-Policy': 'unsafe-url' },
    }));
    const response = await call(new Request('https://x.test/app.js'), env);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('X-Content-Type-Options')?.split(',').length).toBe(1);
  });
});
