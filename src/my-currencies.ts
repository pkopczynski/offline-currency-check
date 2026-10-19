// My currencies: the currencies the user converts between, plus the From/To pair.
// No DOM access, so it is unit tested in Node. Storage is passed in, like the theme module.
import type { KeyValueStorage } from './rates.ts';
import { isSupportedCurrency } from './supported-currencies.ts';
import type { SupportedCurrency } from './supported-currencies.ts';

export const MY_CURRENCIES_KEY = 'my-currencies-v1';

export interface MyCurrenciesState {
  // Sorted by code, no duplicates, never fewer than two.
  currencies: SupportedCurrency[];
  from: SupportedCurrency;
  to: SupportedCurrency;
}

const DEFAULT_CURRENCIES: readonly SupportedCurrency[] = ['EUR', 'PLN', 'TRY'];
const DEFAULT_FROM: SupportedCurrency = 'EUR';
const DEFAULT_TO: SupportedCurrency = 'PLN';
const MIN_CURRENCIES = 2;

const defaultState = (): MyCurrenciesState =>
  ({ currencies: [...DEFAULT_CURRENCIES], from: DEFAULT_FROM, to: DEFAULT_TO });

// The first currency in the (sorted) list that isn't `avoid`. Lists always hold at least two.
const firstOther = (currencies: readonly SupportedCurrency[], avoid: SupportedCurrency | null) =>
  currencies.find((code) => code !== avoid) ?? currencies[0]!;

// A side that isn't in the list goes to its default, or else the first currency not on the other side.
function pickSide(
  currencies: readonly SupportedCurrency[], value: unknown, fallback: SupportedCurrency, other: SupportedCurrency | null,
): SupportedCurrency {
  const valid = (code: unknown): code is SupportedCurrency => currencies.includes(code as SupportedCurrency);
  if (valid(value)) return value;
  if (valid(fallback) && fallback !== other) return fallback;
  return firstOther(currencies, other);
}

function clean(raw: { currencies?: unknown; from?: unknown; to?: unknown }): MyCurrenciesState {
  const listed = Array.isArray(raw.currencies) ? raw.currencies.filter(isSupportedCurrency) : [];
  let currencies = [...new Set(listed)].sort();
  if (currencies.length < MIN_CURRENCIES) currencies = [...DEFAULT_CURRENCIES];
  const savedTo = currencies.includes(raw.to as SupportedCurrency) ? (raw.to as SupportedCurrency) : null;
  const from = pickSide(currencies, raw.from, DEFAULT_FROM, savedTo);
  const to = pickSide(currencies, raw.to, DEFAULT_TO, from);
  return { currencies, from, to };
}

export function load(storage: KeyValueStorage): MyCurrenciesState {
  try {
    const raw: unknown = JSON.parse(storage.getItem(MY_CURRENCIES_KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return clean(raw);
  } catch {
    // Unreadable or missing: defaults.
  }
  return defaultState();
}

export function save(storage: KeyValueStorage, state: MyCurrenciesState): boolean {
  try {
    storage.setItem(MY_CURRENCIES_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
