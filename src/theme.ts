// Theme selection logic. No DOM access, so it is unit tested in Node.
// "Mode" is what the user chose (dark / light / auto); "theme" is what is shown.
import type { KeyValueStorage } from './storage.ts';

export type ThemeMode = 'dark' | 'light' | 'auto';
export type Theme = 'dark' | 'light';
// What decided the current theme: the user, the ambient light sensor, or the clock.
export type ThemeSource = 'manual' | 'sensor' | 'clock';

export const THEME_KEY = 'theme-prefs-v1';
export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light', 'auto'];
// Number of curated palette variants per theme (see tokens.css).
export const VARIANT_COUNT = 4;

export interface AutoConfig {
  // Light from dayStartHour (inclusive) to dayEndHour (exclusive), in the device's local time.
  dayStartHour: number;
  dayEndHour: number;
  // Hysteresis band: at or below darkBelowLux -> dark, at or above lightAboveLux -> light,
  // in between the current theme is kept. Typical dim room: 10-50 lux; lit room: 100-500 lux.
  darkBelowLux: number;
  lightAboveLux: number;
  // A sensor-driven change must hold this long before it is applied (prevents flicker).
  settleMs: number;
}

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  dayStartHour: 7,
  dayEndHour: 19,
  darkBelowLux: 20,
  lightAboveLux: 80,
  settleMs: 2000,
};

export interface ThemePrefs {
  mode: ThemeMode;
  variants: Record<Theme, number>;
}

export const isThemeMode = (v: unknown): v is ThemeMode => THEME_MODES.includes(v as ThemeMode);

const validVariant = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < VARIANT_COUNT;

export function loadPrefs(storage: KeyValueStorage): ThemePrefs {
  const prefs: ThemePrefs = { mode: 'auto', variants: { dark: 0, light: 0 } };
  try {
    const raw: unknown = JSON.parse(storage.getItem(THEME_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return prefs;
    const { mode, variants } = raw as { mode?: unknown; variants?: { dark?: unknown; light?: unknown } };
    if (isThemeMode(mode)) prefs.mode = mode;
    if (validVariant(variants?.dark)) prefs.variants.dark = variants.dark;
    if (validVariant(variants?.light)) prefs.variants.light = variants.light;
  } catch {
    // Unreadable or missing: defaults.
  }
  return prefs;
}

export function savePrefs(storage: KeyValueStorage, prefs: ThemePrefs): boolean {
  try {
    storage.setItem(THEME_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export function themeFromClock(now: Date, cfg: AutoConfig = DEFAULT_AUTO_CONFIG): Theme {
  const hour = now.getHours();
  return hour >= cfg.dayStartHour && hour < cfg.dayEndHour ? 'light' : 'dark';
}

// The next local time at which themeFromClock changes, strictly after `now`.
export function nextClockChange(now: Date, cfg: AutoConfig = DEFAULT_AUTO_CONFIG): Date {
  let next: Date | null = null;
  for (const hour of [cfg.dayStartHour, cfg.dayEndHour]) {
    const candidate = new Date(now);
    candidate.setHours(hour, 0, 0, 0);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    if (!next || candidate < next) next = candidate;
  }
  return next!;
}

// Light-sensor decision with hysteresis. Returns null inside the dead band when there
// is no previous theme to keep.
export function themeFromLux(lux: number, previous: Theme | null, cfg: AutoConfig = DEFAULT_AUTO_CONFIG): Theme | null {
  if (lux <= cfg.darkBelowLux) return 'dark';
  if (lux >= cfg.lightAboveLux) return 'light';
  return previous;
}

export function resolveAuto(
  input: { lux: number | null; previous: Theme | null; now: Date },
  cfg: AutoConfig = DEFAULT_AUTO_CONFIG,
): { theme: Theme; source: ThemeSource } {
  const { lux, previous, now } = input;
  if (typeof lux === 'number' && Number.isFinite(lux) && lux >= 0) {
    const theme = themeFromLux(lux, previous, cfg);
    if (theme) return { theme, source: 'sensor' };
    // Dead band on the very first reading: let the clock break the tie.
    return { theme: themeFromClock(now, cfg), source: 'sensor' };
  }
  return { theme: themeFromClock(now, cfg), source: 'clock' };
}

// A random variant that differs from `previous` (when previous is a valid variant).
export function pickVariant(previous: number, random: () => number = Math.random): number {
  if (!validVariant(previous)) return Math.floor(random() * VARIANT_COUNT) % VARIANT_COUNT;
  const n = Math.floor(random() * (VARIANT_COUNT - 1)) % (VARIANT_COUNT - 1);
  return n >= previous ? n + 1 : n;
}

// A CSS <time> value in milliseconds. Unregistered custom properties keep the text as written,
// and the build's CSS minifier rewrites "600ms" as ".6s", so both units must be understood.
export function cssTimeToMs(value: string): number {
  const n = parseFloat(value) || 0;
  return /[^m]s$/i.test(value.trim()) ? n * 1000 : n;
}
