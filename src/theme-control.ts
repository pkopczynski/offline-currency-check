// Theme control: popup UI, applying the theme to the page, and the Auto-mode inputs
// (ambient light sensor, clock, foreground changes). Pure decisions live in theme.ts.
import { createGlassAudio } from './glass-audio.ts';
import type { GlassAudio } from './glass-audio.ts';
import { startAmbientLight } from './ambient-light.ts';
import type { AmbientLightHandle } from './ambient-light.ts';
import type { KeyValueStorage } from './rates.ts';
import {
  DEFAULT_AUTO_CONFIG, THEME_MODES, cssTimeToMs, isThemeMode, loadPrefs, nextClockChange, pickVariant, resolveAuto, savePrefs,
} from './theme.ts';
import type { Theme, ThemeMode, ThemeSource } from './theme.ts';

const AUTO = DEFAULT_AUTO_CONFIG;
// Chrome colors for the browser UI / status bar (manifest.webmanifest stays dark navy).
const THEME_COLOR: Record<Theme, string> = { dark: '#0b1030', light: '#eef0fb' };
const MODE_LABEL: Record<ThemeMode, string> = { dark: 'Dark', light: 'Light', auto: 'Auto' };
// After returning to the foreground, a reading older than the hidden period is only trusted
// until this long; if the sensor stays silent we fall back to the clock.
const STALE_READING_MS = 3000;
// Share of its final radius at which the reveal circle has covered the whole viewport.
const REVEAL_COVERAGE = 0.88;

interface Point { x: number; y: number }

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const pad = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export function initTheme(storage: KeyValueStorage, audio: GlassAudio = createGlassAudio()) {
  const root = document.documentElement;
  const menu = byId('theme-menu', HTMLElement);
  const toggle = byId('theme-toggle', HTMLButtonElement);
  const popup = byId('theme-popup', HTMLElement);
  const modes = popup.querySelector<HTMLElement>('.theme-modes');
  const radios = [...popup.querySelectorAll<HTMLInputElement>('input[name="theme-mode"]')];
  if (!modes || radios.length !== THEME_MODES.length) throw new Error('Theme popup markup is incomplete');

  const prefs = loadPrefs(storage);
  // The inline script in index.html already applied a theme before first paint.
  let theme: Theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  let source: ThemeSource = 'manual';
  let lux: number | null = null;
  let open = false;

  let sensor: AmbientLightHandle | null = null;
  let sensorBlocked = false; // unsupported or denied: do not try again this session
  let settleTimer: number | undefined;
  let settleTarget: Theme | null = null;
  let staleTimer: number | undefined;
  let clockTimer: number | undefined;

  // --- Applying a theme -----------------------------------------------------------------

  const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
  const cssMs = (name: string) => cssTimeToMs(cssVar(name));

  function applyToDom() {
    root.dataset.theme = theme;
    root.dataset.variant = String(prefs.variants[theme]);
    document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute('content', theme);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  }

  let transitionToken = 0;
  let transitioning = false; // a View Transition is running (see the pointerdown handler)
  // The reveal animation lives on the root's pseudo-element, so it outlives a skipped transition
  // and would keep clipping the next one's snapshot. Only one may exist at a time.
  let reveal: Animation | null = null;

  // Changes the page to the current `theme`. With View Transitions: a circle grows from the
  // theme button for manual changes, a crossfade for automatic ones. Otherwise (and never
  // under reduced motion, where --duration-slow is 0) the colors fade through CSS transitions.
  function paint(origin?: Point) {
    const duration = cssMs('--duration-slow');
    if (duration <= 0 || document.visibilityState !== 'visible') return applyToDom();

    if (typeof document.startViewTransition === 'function') {
      const token = ++transitionToken;
      transitioning = true;
      root.classList.toggle('theme-reveal', !!origin);
      reveal?.cancel();
      reveal = null;
      // applyToDom reads the latest state, so a transition skipped by a newer one is harmless.
      const transition = document.startViewTransition(applyToDom);
      if (origin) {
        // The circle ends past the farthest corner, so it is still moving when it covers the last
        // of the old theme; ending exactly on the corner left a sliver there that crawled to a
        // standstill. The margin also covers a snapshot slightly larger than innerWidth/Height
        // (mobile browser bars), which would otherwise leave a strip that snaps away at the end.
        const corner = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
        const radius = Math.ceil(corner / REVEAL_COVERAGE);
        transition.ready.then(() => {
          if (token !== transitionToken) return;
          const circle = (r: number) => `circle(${r}px at ${origin.x}px ${origin.y}px)`;
          reveal = root.animate(
            { clipPath: [circle(0), circle(radius)] },
            { duration, easing: cssVar('--ease-reveal') || 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
          );
        }).catch(() => { /* skipped by a newer transition */ });
      }
      transition.finished.catch(() => {}).then(() => {
        if (token !== transitionToken) return;
        transitioning = false;
        root.classList.remove('theme-reveal');
        reveal = null;
      });
      return;
    }

    // Fallback: keep .theme-fade until the color transitions it started have actually ended.
    // Removing it earlier (the old fixed timer) drops --color-bg from html's transition list,
    // which cancels that transition and snaps the background to its final color.
    const token = ++transitionToken;
    root.classList.add('theme-fade');
    applyToDom();
    // Without getAnimations (very old browsers) the class goes at once and the change is instant.
    const fades = (document.getAnimations?.() ?? []).filter((a) => a instanceof CSSTransition).map((a) => a.finished);
    Promise.allSettled(fades).then(() => {
      if (token === transitionToken) root.classList.remove('theme-fade');
    });
  }

  // Everything that reflects mode / source / theme but is not part of the page's colors.
  function renderControls() {
    const index = THEME_MODES.indexOf(prefs.mode);
    radios.forEach((radio) => { radio.checked = radio.value === prefs.mode; });
    modes!.style.setProperty('--theme-index', String(index));
    root.dataset.themeMode = prefs.mode;
    toggle.setAttribute('aria-label',
      `Theme: ${MODE_LABEL[prefs.mode]}${prefs.mode === 'auto' ? `, currently ${theme}` : ''}`);
  }

  // The effective theme changed: pick a fresh palette variant (never the previous one for
  // this theme) and show it. Called only on real changes, never on a re-evaluation.
  function activate(next: Theme, origin?: Point) {
    theme = next;
    prefs.variants[next] = pickVariant(prefs.variants[next]);
    savePrefs(storage, prefs);
    renderControls();
    paint(origin);
  }

  // --- Deciding the theme ---------------------------------------------------------------

  function resolve(): { theme: Theme; source: ThemeSource } {
    if (prefs.mode !== 'auto') return { theme: prefs.mode, source: 'manual' };
    return resolveAuto({ lux, previous: theme, now: new Date() }, AUTO);
  }

  function cancelSettle() {
    clearTimeout(settleTimer);
    settleTimer = undefined;
    settleTarget = null;
  }

  // `immediate` is false only for sensor readings: those must hold for AUTO.settleMs first.
  function evaluate(immediate: boolean, origin?: Point) {
    const next = resolve();
    const sourceChanged = next.source !== source;
    source = next.source;
    if (next.theme === theme) {
      cancelSettle();
      if (sourceChanged) renderControls();
      return;
    }
    if (!immediate && next.source === 'sensor') {
      if (settleTarget !== next.theme) {
        cancelSettle();
        settleTarget = next.theme;
        settleTimer = window.setTimeout(() => { cancelSettle(); evaluate(true); }, AUTO.settleMs);
      }
      return;
    }
    cancelSettle();
    activate(next.theme, origin);
  }

  // --- Auto mode inputs -----------------------------------------------------------------

  function scheduleClock() {
    clearTimeout(clockTimer);
    clockTimer = undefined;
    if (prefs.mode !== 'auto' || document.visibilityState !== 'visible') return;
    const now = new Date();
    // +250 ms so the hour has certainly been crossed when the timer fires.
    const delay = Math.max(1000, nextClockChange(now, AUTO).getTime() - now.getTime() + 250);
    clockTimer = window.setTimeout(() => { evaluate(true); scheduleClock(); }, delay);
  }

  function stopSensor() {
    sensor?.stop();
    sensor = null;
    clearTimeout(staleTimer);
    staleTimer = undefined;
  }

  // The sensor runs only in Auto mode, only while the page is visible, and never after a
  // permanent failure. It is the only continuous input; the clock needs a single timeout.
  function syncSensor() {
    const wanted = prefs.mode === 'auto' && document.visibilityState === 'visible' && !sensorBlocked;
    if (!wanted) return stopSensor();
    if (sensor) return;
    sensor = startAmbientLight({
      onReading(value) {
        clearTimeout(staleTimer);
        lux = value;
        evaluate(false);
      },
      onUnavailable(_reason, permanent) {
        stopSensor();
        if (permanent) sensorBlocked = true;
        lux = null;
        evaluate(true); // sensor lost: use the clock
        renderControls();
      },
    });
    // An old reading (from before the page was hidden) may be shown until the first fresh one.
    if (lux !== null) {
      staleTimer = window.setTimeout(() => { lux = null; evaluate(true); }, STALE_READING_MS);
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      syncSensor();
      evaluate(true);
      scheduleClock();
    } else {
      stopSensor();
      cancelSettle();
      clearTimeout(clockTimer);
      clockTimer = undefined;
    }
  }

  // --- Mode selection and popup ---------------------------------------------------------

  function toggleOrigin(): Point {
    const rect = toggle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function setMode(mode: ThemeMode) {
    if (mode === prefs.mode) return;
    prefs.mode = mode;
    savePrefs(storage, prefs);
    if (mode !== 'auto') lux = null; // a stale reading must not survive into the next Auto session
    renderControls();
    syncSensor();
    scheduleClock();
    evaluate(true, toggleOrigin());
  }

  function setOpen(next: boolean, restoreFocus = false) {
    if (open === next) return;
    open = next;
    popup.dataset.open = String(next);
    toggle.setAttribute('aria-expanded', String(next));
    if (next) radios.find((r) => r.checked)?.focus({ preventScroll: true });
    else if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', () => {
    audio.tap();
    setOpen(!open);
  });

  modes.addEventListener('change', (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (!isThemeMode(value) || value === prefs.mode) return;
    audio.tap();
    setMode(value);
  });

  document.addEventListener('pointerdown', (event) => {
    // During a View Transition the browser may target taps at <html> (its overlay) even where
    // the popup is; main.css lets them through, and this keeps such a tap from closing it.
    if (transitioning && event.target === root) return;
    if (open && event.target instanceof Node && !menu.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') setOpen(false, true);
  });
  menu.addEventListener('focusout', (event) => {
    // Tabbing out of the popup closes it. (Focus moving to nowhere is covered by pointerdown.)
    if (open && event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) setOpen(false);
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', (event) => { if (event.persisted) onVisibilityChange(); });

  // --- Startup --------------------------------------------------------------------------

  const initial = resolve();
  source = initial.source;
  if (initial.theme !== theme) activate(initial.theme); // the inline script could not decide correctly
  else renderControls();
  syncSensor();
  scheduleClock();
}
