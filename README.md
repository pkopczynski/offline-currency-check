# Currency Converter PWA

A small offline-first converter between the currencies the European Central Bank publishes
reference rates for.

- Exchange rates come from [Frankfurter](https://frankfurter.dev/) (European Central Bank
  reference rates, published once per working day around 16:00 CET). No API key needed.
- The latest successfully fetched rates and the fetch time are stored in `localStorage`.
- If the device is offline or the request fails, the most recently cached rates are used,
  and the app says clearly that they are cached and when they were last updated.
- After one successful online visit, the app works fully offline (service worker) and can
  be installed as a standalone app on Android and other platforms.

- **My currencies**: the coins button in the top-right corner opens **Manage currencies**,
  where currencies are added and removed (see [My currencies](#my-currencies)).
- Light, dark and automatic theme, chosen from the icon in the top-right corner
  (see [Theme](#theme)).

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
src/my-currencies.ts     My currencies and the From/To pair: load, save, add, remove, dropdown entries (no DOM; unit tested)
src/currencies-control.ts  Manage currencies popup
src/popup.ts             header popup behaviour shared by both popups (open/close, Escape, tap outside, one at a time)
src/theme.ts             theme decisions: clock schedule, light thresholds, variants, prefs (no DOM; unit tested)
src/theme-control.ts     theme popup, applying themes, Auto-mode inputs and transitions
src/ambient-light.ts     AmbientLightSensor wrapper
src/glass-audio.ts       synthesized glass-tap sounds (Web Audio)
src/sw.ts                service worker, built to dist/sw.js
src/styles/tokens.css    design tokens (palette, light/dark themes and variants, spacing, radii, type, glass, motion)
src/styles/main.css      layout and components, using only semantic tokens
public/                  copied as-is: web app manifest and icons
scripts/check-dist.ts    post-build checks (precache list, relative URLs, manifest icons)
scripts/generate-icons.ts  renders public/icons/* (npm run icons)
tests/                   unit tests
```

## My currencies

The coins button in the top-right corner (before the theme button) opens **Manage
currencies**. It lists My currencies, each with a × button, and an **Add currency…** select
with every Supported currency not yet added. Picking one adds it at once; removing is refused
below two currencies (the × buttons are disabled). Adding leaves From/To alone; removing the
currency shown in From or To switches that side to the first remaining currency, by code, that
isn't on the other side. My currencies and the From/To pair are stored in `localStorage`
(`my-currencies-v1`). Rates for every Supported currency are cached on each refresh (ADR 0001),
so a currency added offline converts straight away from the saved rates.

The popup behaves like the theme popup: Escape and tapping outside close it, the button looks
pressed in while it is open, a glass tap plays on open and close, and opening either popup
closes the other.

## Theme

The icon in the top-right corner opens a popup with **Dark**, **Light** and **Auto**. The
choice and the current palette variant are stored in `localStorage` (`theme-prefs-v1`).
A small script in `index.html` applies the stored theme before the first paint.

**Auto** decides in this order:

1. **Ambient light sensor**, if the browser really has one. This is the Generic Sensor
   API's `AmbientLightSensor`: Chromium only (mainly Android Chrome), a secure context, and
   currently behind the `#enable-generic-sensor-extra-classes` flag, so most devices do not
   have it. Firefox and Safari do not implement it. At or below 20 lux the theme is dark, at
   or above 80 lux light, in between it stays as it is, and a change must hold for 2 s.
   The sensor only runs in Auto mode while the page is visible.
2. **Local time**: light from 07:00 to 19:00 in the device's time zone, dark otherwise. Used
   whenever the sensor is unsupported, denied, failing or silent, and it needs no permission.

All thresholds and hours are in `DEFAULT_AUTO_CONFIG` (`src/theme.ts`); the pre-paint script in
`index.html` repeats the hours, and `tests/theme.test.ts` fails if the two disagree. The theme
is re-evaluated on sensor readings, when the page becomes visible again, and at 07:00 / 19:00.
There is no location or sunrise/sunset data in the app, so none is used.

Each theme has four palette variants (`data-variant` blocks in `tokens.css`) that only change
the background glows, glass tint, accent and primary gradient. A new variant is chosen when the
effective theme changes, never the same one twice in a row for a theme, and is remembered per
theme. `tests/theme-palette.test.ts` checks WCAG AA contrast for every theme and variant.

Theme changes use a View Transition (a circle growing from the icon; a crossfade for automatic
changes) where supported, otherwise a CSS color fade; with reduced motion they are instant.
The popup and the tap sounds (short synthesized fingernail-on-glass taps: six voices that differ
in pitch, decay and click, picked at random and never the same one twice in a row) are created
on first use after a user gesture. The icon looks pressed in while the popup is open. There
is no sound setting.

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
8. Theme: Dark and Light override the clock; Auto follows the clock (change the device time to
   check); the choice survives a reload; Escape and tapping outside close the popup; with
   reduced motion enabled the theme changes instantly.
9. Upgrade while offline: with a build that saved `fx-rates-v1` loaded once, deploy this
   version, go offline and reload → status shows **Cached** with the old rates. Back online,
   **Refresh rates** saves `fx-rates-v2` with every currency the ECB publishes.
10. From/To: a first visit shows EUR, PLN and TRY with EUR → PLN; picking a different currency
    in From or To plays a glass tap (re-picking the current one doesn't); reload → the From/To
    pair is kept.
11. Manage currencies: go offline, open the coins popup, add a currency → it appears in From
    and To straight away and converts from the saved rates; From/To don't change; the select
    goes back to **Add currency…**.
12. Remove currencies until 2 remain → both × buttons are disabled and do nothing.
13. Remove the currency shown in From (and, separately, in To) → that side switches to the
    first remaining currency, by code, that isn't on the other side.
14. Reload → My currencies and the From/To pair are kept.
15. With one popup open, press the other popup's button → the first closes and the second
    opens; Escape and tapping outside close the currencies popup; Tab and the keyboard reach
    every × and the add select.
16. Device language: switch the browser/device language (e.g. to Polish) and reload → the
    currency names in From/To and the currencies popup follow it (e.g. "CHF – frank szwajcarski"),
    still sorted by code; all other text stays in English.
