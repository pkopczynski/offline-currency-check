import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MY_CURRENCIES_KEY, load, save, add } from '../src/my-currencies.ts';
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

  const saved = (record: unknown) => memoryStorage({ [MY_CURRENCIES_KEY]: JSON.stringify(record) });

  test('drops unknown codes and duplicates, and keeps the list sorted by code', () => {
    assert.deepEqual(
      load(saved({ currencies: ['USD', 'XXX', 'GBP', 'USD', 42, 'eur', 'RUB'], from: 'USD', to: 'GBP' })),
      { currencies: ['GBP', 'USD'], from: 'USD', to: 'GBP' },
    );
  });

  test('falls back to EUR, PLN and TRY when fewer than 2 currencies remain', () => {
    assert.deepEqual(load(saved({ currencies: ['USD', 'XXX'], from: 'USD', to: 'USD' })), DEFAULT);
    assert.deepEqual(load(saved({ currencies: [], from: 'EUR', to: 'PLN' })), DEFAULT);
  });

  test('resets an invalid From/To pair to EUR → PLN when both are in the list', () => {
    assert.deepEqual(
      load(saved({ currencies: ['EUR', 'PLN', 'USD'], from: 'XXX' })),
      { currencies: ['EUR', 'PLN', 'USD'], from: 'EUR', to: 'PLN' },
    );
  });

  test('resets only the invalid side, avoiding the other side when it can', () => {
    assert.deepEqual(
      load(saved({ currencies: ['EUR', 'PLN', 'USD'], from: 'USD', to: 'GBP' })),
      { currencies: ['EUR', 'PLN', 'USD'], from: 'USD', to: 'PLN' },
    );
    assert.deepEqual(
      load(saved({ currencies: ['EUR', 'PLN', 'USD'], from: 'GBP', to: 'EUR' })),
      { currencies: ['EUR', 'PLN', 'USD'], from: 'PLN', to: 'EUR' },
    );
  });

  test('without EUR or PLN, resets to the first valid choices', () => {
    assert.deepEqual(
      load(saved({ currencies: ['USD', 'GBP', 'JPY'], from: 'EUR', to: 'PLN' })),
      { currencies: ['GBP', 'JPY', 'USD'], from: 'GBP', to: 'JPY' },
    );
  });

  test('keeps a From/To pair that names the same currency twice', () => {
    assert.deepEqual(
      load(saved({ currencies: ['EUR', 'PLN'], from: 'PLN', to: 'PLN' })),
      { currencies: ['EUR', 'PLN'], from: 'PLN', to: 'PLN' },
    );
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

describe('add', () => {
  const state = { currencies: ['EUR', 'PLN', 'TRY'], from: 'TRY', to: 'EUR' } as const;
  const start = () => ({ ...state, currencies: [...state.currencies] });

  test('adds a Supported currency in code order and leaves From/To alone', () => {
    assert.deepEqual(add(start(), 'GBP'), { currencies: ['EUR', 'GBP', 'PLN', 'TRY'], from: 'TRY', to: 'EUR' });
  });

  test('does nothing for a currency already in the list', () => {
    assert.deepEqual(add(start(), 'PLN'), state);
  });

  test('does nothing for an unsupported code', () => {
    assert.deepEqual(add(start(), 'RUB'), state);
    assert.deepEqual(add(start(), ''), state);
  });

  test('does not change the state it was given', () => {
    const before = start();
    add(before, 'GBP');
    assert.deepEqual(before, state);
  });
});
