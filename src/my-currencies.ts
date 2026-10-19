// My currencies: the currencies the user converts between, plus the From/To pair.
// No DOM access, so it is unit tested in Node. Storage is passed in, like the theme module.
import type { KeyValueStorage } from './rates.ts';
import type { SupportedCurrency } from './supported-currencies.ts';

export const MY_CURRENCIES_KEY = 'my-currencies-v1';

export interface MyCurrenciesState {
  // Sorted by code, no duplicates, never fewer than two.
  currencies: SupportedCurrency[];
  from: SupportedCurrency;
  to: SupportedCurrency;
}

const defaultState = (): MyCurrenciesState => ({ currencies: ['EUR', 'PLN', 'TRY'], from: 'EUR', to: 'PLN' });

export function load(storage: KeyValueStorage): MyCurrenciesState {
  try {
    const raw: unknown = JSON.parse(storage.getItem(MY_CURRENCIES_KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { currencies?: unknown }).currencies)) {
      return raw as MyCurrenciesState;
    }
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
