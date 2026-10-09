/// <reference lib="webworker" />
// Built to /sw.js (see vite.config.ts). Must not import anything: a classic service
// worker script cannot load ES module chunks.

declare const self: ServiceWorkerGlobalScope;
// Replaced at build time: every built file (relative to this script) and a hash of their contents.
declare const __PRECACHE_FILES__: string[];
declare const __PRECACHE_VERSION__: string;

const CACHE_PREFIX = 'fx-shell-';
const CACHE_NAME = CACHE_PREFIX + __PRECACHE_VERSION__;
const APP_SHELL = ['./', ...__PRECACHE_FILES__];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' bypasses the browser's HTTP cache so we never store stale files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for the app's own files. Cross-origin requests (the rate API) are
// not intercepted; the app handles their failure and falls back to localStorage.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)),
  );
});

export {};
