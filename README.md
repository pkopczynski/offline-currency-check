# Currency Converter PWA

A small offline-first currency converter for **EUR**, **PLN** and **TRY**.

- Exchange rates come from [Frankfurter](https://frankfurter.dev/) (European Central Bank
  reference rates, published once per working day around 16:00 CET). No API key needed.
- The latest successfully fetched rates and the fetch time are stored in `localStorage`.
- If the device is offline or the request fails, the most recently cached rates are used,
  and the app says clearly that they are cached and when they were last updated.
- After one successful online visit, the app works fully offline (service worker).

Plain HTML, CSS and JavaScript. No framework, no build step, no runtime or dev dependencies.

## Run locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. `localhost` counts as a secure context, so the service
worker and "Install app" work without HTTPS. Other devices need a real HTTPS host.

## Test

Requires Node.js 18+ (uses the built-in `node:test` runner).

```bash
npm test
```

### Manual checklist

1. First load online → status shows **Current**.
2. Enable airplane mode and reload → app still opens, status shows **Cached** with timestamp.
3. Press **Refresh rates** while offline → clear error message, cached rates kept.
4. Back online, press **Refresh rates** → status returns to **Current**.
5. Install the app (browser menu → Install app) and open it offline.

## Updating the app

Static files are served cache-first by the service worker. After changing any app file,
bump `CACHE_VERSION` in `sw.js` so clients pick up the new version.
