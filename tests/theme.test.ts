import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  THEME_KEY, VARIANT_COUNT, DEFAULT_AUTO_CONFIG as CFG,
  loadPrefs, savePrefs, themeFromClock, nextClockChange, themeFromLux, resolveAuto, pickVariant, cssTimeToMs,
} from '../src/theme.ts';
import type { KeyValueStorage } from '../src/storage.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
  } satisfies KeyValueStorage & { data: Record<string, string> };
}

// Local-time constructor: the tests do not depend on the machine's time zone.
const at = (hour: number, minute = 0, day = 16) => new Date(2026, 9, day, hour, minute, 0, 0);

describe('prefs', () => {
  test('defaults to auto with variant 0', () => {
    assert.deepEqual(loadPrefs(memoryStorage()), { mode: 'auto', variants: { dark: 0, light: 0 } });
  });

  test('round-trips through storage', () => {
    const storage = memoryStorage();
    const prefs = { mode: 'light' as const, variants: { dark: 2, light: 3 } };
    assert.ok(savePrefs(storage, prefs));
    assert.deepEqual(loadPrefs(storage), prefs);
  });

  test('ignores corrupt or invalid stored data field by field', () => {
    assert.deepEqual(loadPrefs(memoryStorage({ [THEME_KEY]: '{not json' })).mode, 'auto');
    assert.deepEqual(loadPrefs(memoryStorage({ [THEME_KEY]: 'null' })).mode, 'auto');
    const prefs = loadPrefs(memoryStorage({
      [THEME_KEY]: JSON.stringify({ mode: 'neon', variants: { dark: 99, light: 1.5 } }),
    }));
    assert.deepEqual(prefs, { mode: 'auto', variants: { dark: 0, light: 0 } });
    const partial = loadPrefs(memoryStorage({ [THEME_KEY]: JSON.stringify({ mode: 'dark', variants: { light: 2 } }) }));
    assert.deepEqual(partial, { mode: 'dark', variants: { dark: 0, light: 2 } });
  });

  test('savePrefs reports a failing storage instead of throwing', () => {
    const broken: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    assert.equal(savePrefs(broken, { mode: 'dark', variants: { dark: 0, light: 0 } }), false);
    assert.equal(loadPrefs(broken).mode, 'auto');
  });
});

describe('clock fallback', () => {
  test('light during the day, dark at night, boundaries inclusive/exclusive', () => {
    assert.equal(themeFromClock(at(0)), 'dark');
    assert.equal(themeFromClock(at(6, 59)), 'dark');
    assert.equal(themeFromClock(at(7, 0)), 'light');
    assert.equal(themeFromClock(at(12)), 'light');
    assert.equal(themeFromClock(at(18, 59)), 'light');
    assert.equal(themeFromClock(at(19, 0)), 'dark');
    assert.equal(themeFromClock(at(23, 59)), 'dark');
  });

  test('the schedule is configurable', () => {
    const cfg = { ...CFG, dayStartHour: 9, dayEndHour: 17 };
    assert.equal(themeFromClock(at(8), cfg), 'dark');
    assert.equal(themeFromClock(at(9), cfg), 'light');
    assert.equal(themeFromClock(at(17), cfg), 'dark');
  });

  test('nextClockChange is the next boundary, strictly after now', () => {
    assert.deepEqual(nextClockChange(at(3)), at(7));
    assert.deepEqual(nextClockChange(at(7)), at(19));
    assert.deepEqual(nextClockChange(at(12)), at(19));
    assert.deepEqual(nextClockChange(at(19)), at(7, 0, 17));
    assert.deepEqual(nextClockChange(at(23, 30)), at(7, 0, 17));
  });

  test('theme flips exactly at nextClockChange', () => {
    for (const hour of [0, 5, 7, 11, 18, 19, 22]) {
      const now = at(hour, 30);
      const change = nextClockChange(now);
      assert.notEqual(themeFromClock(new Date(change.getTime() - 1)), themeFromClock(change));
      assert.equal(themeFromClock(now), themeFromClock(new Date(change.getTime() - 1)));
    }
  });
});

describe('ambient light', () => {
  test('dark at or below the low threshold, light at or above the high one', () => {
    assert.equal(themeFromLux(0, null), 'dark');
    assert.equal(themeFromLux(CFG.darkBelowLux, 'light'), 'dark');
    assert.equal(themeFromLux(CFG.lightAboveLux, 'dark'), 'light');
    assert.equal(themeFromLux(10_000, 'dark'), 'light');
  });

  test('hysteresis: inside the band the current theme is kept', () => {
    const mid = (CFG.darkBelowLux + CFG.lightAboveLux) / 2;
    assert.equal(themeFromLux(mid, 'dark'), 'dark');
    assert.equal(themeFromLux(mid, 'light'), 'light');
    assert.equal(themeFromLux(mid, null), null);
  });

  test('a reading wobbling inside the band never flips the theme', () => {
    let theme: 'dark' | 'light' = 'dark';
    for (const lux of [25, 70, 30, 79, 21, 60]) {
      theme = resolveAuto({ lux, previous: theme, now: at(12) }).theme;
    }
    assert.equal(theme, 'dark');
  });

  test('sensor wins over the clock (dark room at noon, bright room at midnight)', () => {
    assert.deepEqual(resolveAuto({ lux: 3, previous: 'light', now: at(12) }), { theme: 'dark', source: 'sensor' });
    assert.deepEqual(resolveAuto({ lux: 500, previous: 'dark', now: at(0) }), { theme: 'light', source: 'sensor' });
  });

  test('first reading inside the band is decided by the clock', () => {
    assert.deepEqual(resolveAuto({ lux: 50, previous: null, now: at(12) }), { theme: 'light', source: 'sensor' });
    assert.deepEqual(resolveAuto({ lux: 50, previous: null, now: at(23) }), { theme: 'dark', source: 'sensor' });
  });

  test('no usable reading falls back to the clock', () => {
    for (const lux of [null, NaN, Infinity, -1]) {
      assert.deepEqual(resolveAuto({ lux, previous: 'dark', now: at(12) }), { theme: 'light', source: 'clock' });
      assert.deepEqual(resolveAuto({ lux, previous: 'light', now: at(22) }), { theme: 'dark', source: 'clock' });
    }
  });
});

describe('pickVariant', () => {
  test('never repeats the previous variant and covers all others', () => {
    for (let previous = 0; previous < VARIANT_COUNT; previous++) {
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const next = pickVariant(previous);
        assert.ok(Number.isInteger(next) && next >= 0 && next < VARIANT_COUNT);
        assert.notEqual(next, previous);
        seen.add(next);
      }
      assert.equal(seen.size, VARIANT_COUNT - 1);
    }
  });

  test('extreme random values stay in range and differ from previous', () => {
    for (let previous = 0; previous < VARIANT_COUNT; previous++) {
      for (const r of [0, 0.999999999]) {
        const next = pickVariant(previous, () => r);
        assert.ok(next >= 0 && next < VARIANT_COUNT);
        assert.notEqual(next, previous);
      }
    }
  });

  test('an invalid previous value still yields a valid variant', () => {
    for (const previous of [-1, 7, 1.5, NaN]) {
      const next = pickVariant(previous, () => 0.999999);
      assert.ok(next >= 0 && next < VARIANT_COUNT);
    }
  });
});

// The inline script in index.html decides the theme before first paint, so it duplicates the
// schedule and storage format. This runs the real script and compares it with src/theme.ts.
describe('inline pre-paint script in index.html', () => {
  const html = readFileSync('index.html', 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0]?.[1];

  function run(stored: unknown, hour: number) {
    const metas: Record<string, { content: string }> = {
      'meta[name="color-scheme"]': { content: 'dark light' },
      'meta[name="theme-color"]': { content: '#0b1030' },
    };
    const root = { dataset: {} as Record<string, string> };
    class FakeDate extends Date {
      constructor() { super(2026, 9, 16, hour, 30); }
    }
    vm.runInNewContext(script!, {
      document: { documentElement: root, querySelector: (sel: string) => metas[sel] ?? null },
      localStorage: { getItem: () => (stored === undefined ? null : typeof stored === 'string' ? stored : JSON.stringify(stored)) },
      Date: FakeDate,
    });
    return { dataset: root.dataset, scheme: metas['meta[name="color-scheme"]']!.content, color: metas['meta[name="theme-color"]']!.content };
  }

  test('the script exists', () => assert.ok(script));

  test('manual modes and variants', () => {
    const dark = run({ mode: 'dark', variants: { dark: 3, light: 1 } }, 12);
    assert.deepEqual(dark.dataset, { theme: 'dark', themeMode: 'dark', variant: 3 });
    assert.equal(dark.scheme, 'dark');
    const light = run({ mode: 'light', variants: { dark: 3, light: 1 } }, 2);
    assert.deepEqual(light.dataset, { theme: 'light', themeMode: 'light', variant: 1 });
    assert.equal(light.scheme, 'light');
    assert.equal(light.color, '#eef0fb');
  });

  test('auto matches themeFromClock for every hour', () => {
    for (let hour = 0; hour < 24; hour++) {
      assert.equal(run(undefined, hour).dataset.theme, themeFromClock(at(hour, 30)), `hour ${hour}`);
    }
  });

  test('defaults and bad data: auto, variant 0, never throws', () => {
    assert.deepEqual(run(undefined, 12).dataset, { theme: 'light', themeMode: 'auto', variant: 0 });
    assert.deepEqual(run({ mode: 'x', variants: { light: 9 } }, 12).dataset, { theme: 'light', themeMode: 'auto', variant: 0 });
    assert.equal(run('{broken', 12).dataset.theme, 'dark');
  });

  test('agrees with loadPrefs on stored data', () => {
    const stored = { mode: 'light', variants: { dark: 2, light: 2 } };
    const prefs = loadPrefs(memoryStorage({ [THEME_KEY]: JSON.stringify(stored) }));
    const result = run(stored, 12).dataset;
    assert.equal(result.theme, prefs.mode);
    assert.equal(result.variant, prefs.variants.light);
  });
});

describe('cssTimeToMs', () => {
  test('milliseconds and seconds, as in the dev server and the minified build', () => {
    assert.equal(cssTimeToMs('600ms'), 600);
    assert.equal(cssTimeToMs('.6s'), 600);
    assert.equal(cssTimeToMs('0.26s'), 260);
    assert.equal(cssTimeToMs(' 150ms '), 150);
  });

  test('reduced motion and missing values are 0', () => {
    assert.equal(cssTimeToMs('0s'), 0);
    assert.equal(cssTimeToMs('0ms'), 0);
    assert.equal(cssTimeToMs(''), 0);
  });
});
