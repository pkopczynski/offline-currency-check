# Currency Converter PWA

A small offline-first currency converter for **EUR**, **PLN** and **TRY**.

- Exchange rates come from [Frankfurter](https://frankfurter.dev/) (European Central Bank
  reference rates, published once per working day around 16:00 CET). No API key needed.
- The latest successfully fetched rates and the fetch time are stored in `localStorage`.
- If the device is offline or the request fails, the most recently cached rates are used,
  and the app says clearly that they are cached and when they were last updated.
- After one successful online visit, the app works fully offline (service worker) and can
  be installed as a standalone app on Android and other platforms.

TypeScript, built with [Vite](https://vite.dev/). No framework and no runtime dependencies.

## Requirements

Node.js 22.18+ (tests and scripts run TypeScript directly via Node's built-in type stripping).

## Develop

```bash
npm install
npm run dev        # dev server with hot reload (no service worker)
npm run build      # production build into dist/, then scripts/check-dist.ts
npm run preview    # serve dist/ – use this to test the service worker and installation
npm run typecheck  # app, service worker, tests and scripts
npm test           # unit tests (node:test)
```

`localhost` counts as a secure context, so the service worker and "Install app" work in
`npm run preview` without HTTPS. Other devices need a real HTTPS host (e.g. GitHub Pages).

To check the app under a GitHub Pages-style subpath locally:

```bash
npm run build && npx vite preview --base /offline-currency-check/
```

## Project layout

```
index.html               page markup (Vite entry)
src/main.ts              UI: DOM wiring and rendering
src/rates.ts             exchange-rate logic (no DOM; unit tested)
src/sw.ts                service worker, built to dist/sw.js
src/styles/tokens.css    design tokens (palette, spacing, radii, type, glass, motion)
src/styles/main.css      layout and components, using only semantic tokens
public/                  copied as-is: web app manifest and icons
scripts/check-dist.ts    post-build checks (precache list, relative URLs, manifest icons)
scripts/generate-icons.ts  renders public/icons/* (npm run icons)
tests/                   unit tests
```

## Service worker and updates

The service worker precaches every file of the build. The file list and the cache version
are generated at build time (see `vite.config.ts`), so there is nothing to bump by hand:
any change to a built file produces a new cache, and old caches are deleted on activation.

App files are served cache-first, so after a deployment the new version is downloaded in
the background and shown on the next launch.

All URLs are relative (`base: './'`), so the same build works at a domain root and under
a repository subpath such as `https://<user>.github.io/<repo>/`.

## Icons

The icons are generated from one geometry definition in `scripts/generate-icons.ts`
(no dependencies or system tools). After changing it, run `npm run icons` and commit the
files in `public/icons/`. Maskable icons keep the symbol inside the central safe zone.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` type-checks, tests and builds every push and pull request,
and deploys `dist/` to GitHub Pages on pushes to `main`.

One-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The app is then served at `https://<user>.github.io/<repo>/`.

### Manual checklist

1. First load online → status shows **Current**.
2. Enable airplane mode and reload → app still opens, status shows **Cached** with timestamp.
3. Press **Refresh rates** while offline → clear error message, cached rates kept.
4. Back online, press **Refresh rates** → status returns to **Current**.
5. Install the app (Chrome menu → Install app / Add to home screen) and open it offline.
6. On Android: the launcher icon fills its mask shape, the splash screen and status bar are
   dark navy, and the app opens without browser UI.
7. After deploying a change: open the app, close it, reopen → the change is visible.
