// Reads src/styles/tokens.css and checks WCAG contrast for every theme x palette variant,
// against the page background at its most extreme (plain, or at the center of either glow,
// where that glow is at full strength) and the glass surfaces on top of it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VARIANT_COUNT } from '../src/theme.ts';

interface Rgba { r: number; g: number; b: number; a: number }

const css = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Remove @media / @supports / @property blocks (their rules are accessibility overrides, not the palette).
function stripAtRules(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '@') {
      const open = text.indexOf('{', i);
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth > 0; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      i = j;
    } else {
      out += text[i++];
    }
  }
  return out;
}

const rules = new Map<string, Map<string, string>>();
for (const [, selector, body] of stripAtRules(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const decls = rules.get(selector!.trim().replace(/\s+/g, ' ')) ?? new Map<string, string>();
  for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*((?:[^;()]|\([^)]*(?:\([^)]*\)[^)]*)*\))*);/g)) {
    decls.set(name!, value!.trim());
  }
  rules.set(selector!.trim().replace(/\s+/g, ' '), decls);
}

function tokensFor(theme: 'dark' | 'light', variant: number): Map<string, string> {
  const selectors = [
    ':root',
    ...(theme === 'light' ? [':root[data-theme="light"]'] : []),
    ...(variant > 0 ? [`:root[data-theme="${theme}"][data-variant="${variant}"]`] : []),
  ];
  const merged = new Map<string, string>();
  for (const selector of selectors) {
    for (const [k, v] of rules.get(selector) ?? []) merged.set(k, v);
  }
  return merged;
}

function parseColor(value: string, tokens: Map<string, string>): Rgba {
  const v = value.trim();
  let m = v.match(/^var\((--[\w-]+)\)$/);
  if (m) {
    const ref = tokens.get(m[1]!);
    assert.ok(ref !== undefined, `undefined token ${m[1]}`);
    return parseColor(ref, tokens);
  }
  m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] };
  m = v.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/);
  if (m) {
    const c = parseColor(m[1]!, tokens);
    return { ...c, a: c.a * (+m[2]! / 100) };
  }
  throw new Error(`Cannot evaluate color: ${value}`);
}

// Source-over: `top` painted on opaque `bottom`.
const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

const luminance = ({ r, g, b }: Rgba) => {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('palette contrast (WCAG AA)', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (let variant = 0; variant < VARIANT_COUNT; variant++) {
      test(`${theme} variant ${variant}`, () => {
        const t = tokensFor(theme, variant);
        const color = (name: string) => parseColor(`var(${name})`, t);
        const check = (label: string, fg: Rgba, bg: Rgba, min: number) => {
          const ratio = contrast(over(fg, bg), bg);
          assert.ok(ratio >= min, `${theme}/${variant}: ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
        };

        // The glows sit in opposite corners and fade out, so they only reach full strength
        // one at a time.
        const base = color('--color-bg');
        const glow1 = over(color('--color-bg-glow-1'), base);
        const glow2 = over(color('--color-bg-glow-2'), base);

        for (const [bgName, bg] of Object.entries({ base, glow1, glow2 })) {
          const surface = over(color('--color-surface'), bg);
          const field = over(color('--color-field'), surface);
          const popup = over(color('--color-popup-surface'), bg);

          for (const text of ['--color-text', '--color-text-muted']) {
            check(`${text} on page (${bgName})`, color(text), bg, 4.5);
            check(`${text} on glass (${bgName})`, color(text), surface, 4.5);
            check(`${text} on field/result (${bgName})`, color(text), field, 4.5);
            check(`${text} on popup (${bgName})`, color(text), popup, 4.5);
          }
          check(`accent link text on page (${bgName})`, color('--color-accent'), bg, 4.5);
          check(`accent on glass (${bgName})`, color('--color-accent'), surface, 4.5);
          check(`accent on popup (${bgName})`, color('--color-accent'), popup, 4.5); // sun/moon icon, hover
          check(`focus ring on page (${bgName})`, color('--color-focus'), bg, 3);
          check(`focus ring on popup (${bgName})`, color('--color-focus'), popup, 3);

          for (const status of ['ok', 'warn', 'error']) {
            const statusSurface = over(color(`--color-${status}-surface`), surface);
            check(`${status} text on its surface (${bgName})`, color(`--color-${status}`), statusSurface, 4.5);
            if (status === 'error') check(`error text on glass (${bgName})`, color('--color-error'), surface, 4.5);
          }
          const loading = over(color('--color-surface'), bg);
          check(`status detail on ok surface (${bgName})`, color('--color-text-muted'),
            over(color('--color-ok-surface'), loading), 4.5);
        }

        // Selected option and primary button: white text on both gradient stops.
        for (const stop of ['--color-primary-start', '--color-primary-end']) {
          check(`on-primary text on ${stop}`, color('--color-on-primary'), over(color(stop), base), 4.5);
        }
      });
    }
  }

  test('the palette stays within a restrained range per theme (variants are not wildly different)', () => {
    // Text colors and status colors must be identical across variants: only --v-* tokens vary.
    for (const theme of ['dark', 'light'] as const) {
      const first = tokensFor(theme, 0);
      for (let variant = 1; variant < VARIANT_COUNT; variant++) {
        const other = tokensFor(theme, variant);
        for (const name of ['--color-text', '--color-text-muted', '--color-ok', '--color-warn', '--color-error', '--color-bg']) {
          assert.equal(other.get(name), first.get(name), `${theme}: ${name} must not vary`);
        }
      }
    }
  });

  test('every variant of both themes is defined in tokens.css', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (let variant = 1; variant < VARIANT_COUNT; variant++) {
        assert.ok(rules.has(`:root[data-theme="${theme}"][data-variant="${variant}"]`), `${theme} variant ${variant}`);
      }
    }
  });
});
