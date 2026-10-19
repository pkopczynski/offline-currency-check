// My currencies: the currencies the user converts between, plus the From/To pair.
// No DOM access, so it is unit tested in Node. Storage is passed in, like the theme module.
import type { KeyValueStorage } from './rates.ts';
import { CURRENCY_NAMES, SUPPORTED_CURRENCIES, isSupportedCurrency } from './supported-currencies.ts';
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
export const MIN_CURRENCIES = 2;

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

// Adds a Supported currency not yet in the list. Returns the same state when there's nothing to add.
export function add(state: MyCurrenciesState, code: string): MyCurrenciesState {
  if (!isSupportedCurrency(code) || state.currencies.includes(code)) return state;
  return { ...state, currencies: [...state.currencies, code].sort() };
}

// Removes a currency, never going below two. A side that showed it switches to the first
// remaining currency, alphabetically, that isn't on the other side.
export function remove(state: MyCurrenciesState, code: string): MyCurrenciesState {
  if (state.currencies.length <= MIN_CURRENCIES || !state.currencies.includes(code as SupportedCurrency)) return state;
  const currencies = state.currencies.filter((c) => c !== code);
  const from = state.from === code ? firstOther(currencies, state.to === code ? null : state.to) : state.from;
  const to = state.to === code ? firstOther(currencies, from) : state.to;
  return { currencies, from, to };
}

export interface CurrencyOption {
  code: SupportedCurrency;
  name: string;
  // "CODE – name", as shown in the dropdowns.
  label: string;
}

export interface CurrencyOptions {
  // My currencies, for the From and To dropdowns.
  mine: CurrencyOption[];
  // Supported currencies not yet in My currencies, for the add select.
  addable: CurrencyOption[];
}

type NameOf = (code: SupportedCurrency) => string;

const englishName: NameOf = (code) => CURRENCY_NAMES[code];

// Both lists are sorted by code, so the order is the same in every language.
export function options(state: MyCurrenciesState): CurrencyOptions {
  const nameOf = englishName;
  const option = (code: SupportedCurrency): CurrencyOption => {
    const name = nameOf(code);
    return { code, name, label: `${code} – ${name}` };
  };
  return {
    mine: [...state.currencies].sort().map(option),
    addable: SUPPORTED_CURRENCIES.filter((code) => !state.currencies.includes(code)).map(option),
  };
}
