import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MY_CURRENCIES_KEY, load, save } from '../src/my-currencies.ts';
import type { KeyValueStorage } from '../src/rates.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
  } satisfies KeyValueStorage & { data: Record<string, string> };
}

const DEFAULT = { currencies: ['EUR', 'PLN', 'TRY'], from: 'EUR', to: 'PLN' };

describe('load', () => {
  test('gives EUR, PLN and TRY with EUR → PLN when nothing is saved', () => {
    assert.deepEqual(load(memoryStorage()), DEFAULT);
  });

  test('gives the default state for broken or unusable data', () => {
    for (const saved of ['{not json', 'null', '42', '"EUR"', '[]', '{}', '{"currencies":"EUR"}']) {
      assert.deepEqual(load(memoryStorage({ [MY_CURRENCIES_KEY]: saved })), DEFAULT, saved);
    }
  });

  test('gives the default state when storage throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    };
    assert.deepEqual(load(broken), DEFAULT);
  });
});

describe('save', () => {
  test('round-trips through storage', () => {
    const storage = memoryStorage();
    const state = { currencies: ['GBP', 'JPY', 'USD'], from: 'USD', to: 'JPY' } as const;
    assert.equal(save(storage, { ...state, currencies: [...state.currencies] }), true);
    assert.deepEqual(load(storage), state);
  });

  test('returns false without throwing when storage fails', () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    assert.equal(save(broken, { currencies: ['EUR', 'PLN'], from: 'EUR', to: 'PLN' }), false);
  });
});
