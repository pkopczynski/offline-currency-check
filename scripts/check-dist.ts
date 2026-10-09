// Post-build sanity checks for dist/: the service worker precache matches the
// files on disk, and nothing uses root-absolute URLs (which would break when
// GitHub Pages serves the app under /<repo>/).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const DIST = 'dist';
const read = (file: string) => readFileSync(join(DIST, file), 'utf8');
const exists = (url: string) => existsSync(join(DIST, url === './' ? 'index.html' : url));

// 1. Run the built service worker in a sandbox and capture what it precaches.
//    Running it as a classic script also proves it has no import/export statements.
type Handler = (event: unknown) => void;
const handlers: Record<string, Handler> = {};
let precached: string[] = [];
const sandbox = {
  self: {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    location: { origin: 'https://example.test' },
  },
  caches: { open: async () => ({ addAll: async (reqs: { url: string }[]) => { precached = reqs.map((r) => r.url); } }) },
  Request: class { url: string; constructor(url: string) { this.url = url; } },
};
vm.runInNewContext(read('sw.js'), sandbox, { filename: 'sw.js' });
for (const type of ['install', 'activate', 'fetch']) assert.ok(handlers[type], `sw.js registers a ${type} handler`);

const pending: Promise<unknown>[] = [];
handlers.install!({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
await Promise.all(pending);

assert.ok(precached.includes('./'), 'precache includes ./');
assert.ok(precached.includes('./index.html'), 'precache includes ./index.html (offline navigation fallback)');
for (const url of precached) {
  assert.ok(url.startsWith('./'), `precache URL is relative: ${url}`);
  assert.ok(exists(url), `precached file exists: ${url}`);
}

// 2. Every manifest icon exists, and start_url/scope stay relative.
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) {
  assert.ok(exists(icon.src), `manifest icon exists: ${icon.src}`);
  assert.ok(precached.includes(`./${icon.src}`), `manifest icon is precached: ${icon.src}`);
}

// 3. index.html references only relative, existing local files.
const html = read('index.html');
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^[a-z]+:/i.test(url!)) continue; // https:, mailto:, data:
  assert.ok(!url!.startsWith('/'), `index.html URL is relative: ${url}`);
  assert.ok(exists(url!), `index.html reference exists: ${url}`);
}

// 4. No root-absolute url() in CSS.
for (const file of readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.css'))) {
  assert.ok(!/url\(\s*["']?\//.test(read(`assets/${file}`)), `no root-absolute url() in ${file}`);
}

console.log(`dist OK: ${precached.length} precached URLs, ${manifest.icons.length} manifest icons.`);
