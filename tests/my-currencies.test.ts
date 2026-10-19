import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MY_CURRENCIES_KEY, load, save, add, remove, options } from '../src/my-currencies.ts';
import type { KeyValueStorage } from '../src/storage.ts';

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

describe('remove', () => {
  type Codes = Parameters<typeof remove>[0]['currencies'];
  const state = (currencies: Codes, from: Codes[number], to: Codes[number]) => ({ currencies, from, to });

  test('removes a currency that is on neither side', () => {
    assert.deepEqual(
      remove(state(['EUR', 'PLN', 'TRY'], 'EUR', 'PLN'), 'TRY'),
      state(['EUR', 'PLN'], 'EUR', 'PLN'),
    );
  });

  test('never goes below 2 currencies', () => {
    assert.deepEqual(remove(state(['EUR', 'PLN'], 'EUR', 'PLN'), 'PLN'), state(['EUR', 'PLN'], 'EUR', 'PLN'));
  });

  test('does nothing for a code not in the list', () => {
    assert.deepEqual(
      remove(state(['EUR', 'PLN', 'TRY'], 'EUR', 'PLN'), 'USD'),
      state(['EUR', 'PLN', 'TRY'], 'EUR', 'PLN'),
    );
  });

  test('switches From to the first remaining currency, alphabetically, not on the To side', () => {
    assert.deepEqual(
      remove(state(['EUR', 'GBP', 'PLN', 'USD'], 'PLN', 'EUR'), 'PLN'),
      state(['EUR', 'GBP', 'USD'], 'GBP', 'EUR'),
    );
  });

  test('switches To the same way', () => {
    assert.deepEqual(
      remove(state(['EUR', 'GBP', 'PLN', 'USD'], 'EUR', 'USD'), 'USD'),
      state(['EUR', 'GBP', 'PLN'], 'EUR', 'GBP'),
    );
  });

  test('when both sides showed the removed currency, they switch to two different ones', () => {
    assert.deepEqual(
      remove(state(['EUR', 'GBP', 'PLN'], 'EUR', 'EUR'), 'EUR'),
      state(['GBP', 'PLN'], 'GBP', 'PLN'),
    );
  });
});

// A fake Intl.DisplayNames factory: names come from `names`, keyed by locale then code.
const fakeDisplayNames = (names: Record<string, Record<string, string | undefined>>) =>
  (locale: string) => ({ of: (code: string) => names[locale]?.[code] });
const noDisplayNames = () => { throw new TypeError('Intl.DisplayNames is not a constructor'); };

describe('options', () => {
  test('names currencies in the given locale', () => {
    const displayNames = fakeDisplayNames({ pl: { CHF: 'frank szwajcarski', EUR: 'euro' } });
    const { mine, addable } = options({ currencies: ['EUR', 'PLN'], from: 'EUR', to: 'PLN' }, 'pl', displayNames);
    assert.deepEqual(mine[0], { code: 'EUR', name: 'euro', label: 'EUR – euro' });
    assert.deepEqual(addable.find((o) => o.code === 'CHF'),
      { code: 'CHF', name: 'frank szwajcarski', label: 'CHF – frank szwajcarski' });
  });

  test('sorts by code whatever the language', () => {
    // In Polish, "dolar amerykański" < "euro" < "frank szwajcarski": not code order.
    const displayNames = fakeDisplayNames({ pl: { USD: 'dolar amerykański', EUR: 'euro', CHF: 'frank szwajcarski' } });
    const { mine } = options({ currencies: ['USD', 'EUR', 'CHF'], from: 'EUR', to: 'USD' }, 'pl', displayNames);
    assert.deepEqual(mine.map((o) => o.code), ['CHF', 'EUR', 'USD']);
  });

  describe('falls back to the English name when Intl.DisplayNames', () => {
    const state = { currencies: ['EUR', 'CHF'], from: 'EUR', to: 'CHF' } as const;
    const chfName = (displayNames: Parameters<typeof options>[2]) =>
      options({ ...state, currencies: [...state.currencies] }, 'pl', displayNames).mine[0]!.name;

    test('is missing', () => {
      assert.equal(chfName(noDisplayNames), 'Swiss franc');
    });

    test('throws when looking up a name', () => {
      assert.equal(chfName(() => ({ of: () => { throw new RangeError('bad code'); } })), 'Swiss franc');
    });

    test('returns nothing', () => {
      assert.equal(chfName(fakeDisplayNames({})), 'Swiss franc');
      assert.equal(chfName(fakeDisplayNames({ pl: { CHF: '' } })), 'Swiss franc');
    });

    test('returns just the code', () => {
      assert.equal(chfName(fakeDisplayNames({ pl: { CHF: 'CHF' } })), 'Swiss franc');
    });
  });

  test('lists My currencies as "CODE – name" in English, sorted by code', () => {
    const { mine } = options({ currencies: ['USD', 'EUR', 'PLN'], from: 'EUR', to: 'PLN' }, 'en', noDisplayNames);
    assert.deepEqual(mine, [
      { code: 'EUR', name: 'Euro', label: 'EUR – Euro' },
      { code: 'PLN', name: 'Polish złoty', label: 'PLN – Polish złoty' },
      { code: 'USD', name: 'US dollar', label: 'USD – US dollar' },
    ]);
  });

  test('lists the Supported currencies not yet added, sorted by code', () => {
    const { addable } = options({ currencies: ['EUR', 'PLN', 'TRY'], from: 'EUR', to: 'PLN' }, 'en', noDisplayNames);
    const codes = addable.map((o) => o.code);
    assert.equal(codes.length, 27);
    assert.deepEqual(codes.slice(0, 7), ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK']);
    assert.deepEqual(codes.slice(-3), ['THB', 'USD', 'ZAR']);
    for (const code of ['EUR', 'PLN', 'TRY']) assert.ok(!codes.includes(code as never), code);
    assert.deepEqual(addable.find((o) => o.code === 'GBP'), { code: 'GBP', name: 'British pound', label: 'GBP – British pound' });
  });
});
