// Standalone desktop build: one executable that serves the web app on localhost and runs the
// same /api code as the Cloudflare Worker. Credentials are optional: without them the
// "recent plays" list is disabled, but dropping a local .osr + .osz still renders.
//
// Config (env vars win over the file): osu-render.env next to the exe, KEY=VALUE per line.
//   OSU_CLIENT_ID, OSU_CLIENT_SECRET   osu! API v2 app credentials (optional)
//   PORT                               default 8787
//   OPEN_BROWSER                       set to 0 to skip opening a browser window

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { handleApi, type Env } from '../../worker/src/index';
import { HttpError } from '../../worker/src/osu';
import { files } from './embedded.gen';

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const fileVars = {
  ...loadEnvFile(join(dirname(process.execPath), 'osu-render.env')),
  ...loadEnvFile(join(process.cwd(), 'osu-render.env')),
};
const pick = (key: string) => process.env[key] || fileVars[key] || undefined;

const env: Env = {
  OSU_CLIENT_ID: pick('OSU_CLIENT_ID'),
  OSU_CLIENT_SECRET: pick('OSU_CLIENT_SECRET'),
  ASSETS: undefined as never,
};

// The Worker's ExecutionContext; nothing here needs background work, so these are no-ops.
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const port = Number(pick('PORT') ?? 8787);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, ctx);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: 'Something went wrong' }, 500);
      }
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = files[path];
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(file));
  },
});

const address = `http://127.0.0.1:${server.port}/`;
const hasCredentials = Boolean(env.OSU_CLIENT_ID && env.OSU_CLIENT_SECRET);
console.log('osu-render is running at ' + address);
console.log(hasCredentials ? 'osu! API: configured (recent plays enabled).' : 'osu! API: not configured. Drop a .osr and .osz file to render locally, or add osu-render.env next to this exe.');
console.log('Press Ctrl+C to stop.');

if (pick('OPEN_BROWSER') !== '0') {
  try {
    if (process.platform === 'win32') Bun.spawn(['cmd', '/c', 'start', '', address]);
    else if (process.platform === 'darwin') Bun.spawn(['open', address]);
    else Bun.spawn(['xdg-open', address]);
  } catch {
    // No browser launcher available; the address above is enough.
  }
}
