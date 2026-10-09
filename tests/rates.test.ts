import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_KEY, SCHEMA, API_URL,
  validateRates, loadCache, saveCache, fetchRates, refreshRates,
  convert, parseAmount, formatAge,
} from '../src/rates.ts';
import type { CacheEntry, FetchFn, KeyValueStorage } from '../src/rates.ts';

const RATES = { EUR: 1, PLN: 4.3825, TRY: 54.9822 };
const API_PAYLOAD = { amount: 1.0, base: 'EUR', date: '2026-10-07', rates: { PLN: 4.3825, TRY: 54.9822 } };
const NOW = Date.parse('2026-10-07T20:41:12.000Z');

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
  } satisfies KeyValueStorage & { data: Record<string, string> };
}

const okFetch = (payload: unknown = API_PAYLOAD): FetchFn => async () => ({ ok: true, status: 200, json: async () => payload });
// Overrides may deliberately break the entry (wrong schema, missing rates, ...), hence the cast.
const validEntry = (overrides: Record<string, unknown> = {}) => ({
  schema: SCHEMA, provider: 'frankfurter', base: 'EUR', rates: { ...RATES },
  rateDate: '2026-10-06', fetchedAt: '2026-10-06T18:00:00.000Z', ...overrides,
}) as CacheEntry;

describe('convert', () => {
  const close = (actual: number | null, expected: number) =>
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

  test('all six currency pairs', () => {
    close(convert(10, 'EUR', 'PLN', RATES), 43.825);
    close(convert(10, 'EUR', 'TRY', RATES), 549.822);
    close(convert(43.825, 'PLN', 'EUR', RATES), 10);
    close(convert(549.822, 'TRY', 'EUR', RATES), 10);
    close(convert(4.3825, 'PLN', 'TRY', RATES), 54.9822);
    close(convert(54.9822, 'TRY', 'PLN', RATES), 4.3825);
  });

  test('same currency returns the amount unchanged', () => {
    for (const c of ['EUR', 'PLN', 'TRY']) assert.equal(convert(12.34, c, c, RATES), 12.34);
  });

  test('zero and decimals', () => {
    assert.equal(convert(0, 'EUR', 'PLN', RATES), 0);
    close(convert(0.5, 'EUR', 'PLN', RATES), 2.19125);
  });

  test('invalid input returns null', () => {
    assert.equal(convert(-1, 'EUR', 'PLN', RATES), null);
    assert.equal(convert(NaN, 'EUR', 'PLN', RATES), null);
    assert.equal(convert(null, 'EUR', 'PLN', RATES), null);
    assert.equal(convert(1, 'EUR', 'USD', RATES), null);
    assert.equal(convert(1, 'EUR', 'PLN', null), null);
  });
});

describe('parseAmount', () => {
  test('accepts dot and comma decimals', () => {
    assert.equal(parseAmount('12.5'), 12.5);
    assert.equal(parseAmount('12,5'), 12.5);
    assert.equal(parseAmount(' 1 000 '), 1000);
    assert.equal(parseAmount('0'), 0);
    assert.equal(parseAmount('.5'), 0.5);
  });

  test('rejects empty, negative and non-numeric input', () => {
    for (const bad of ['', '   ', '.', '-1', 'abc', '1.2.3', '1e5', '1,2,3']) {
      assert.equal(parseAmount(bad), null, `"${bad}"`);
    }
  });

  test('a single comma is always a decimal separator, so "1,000" is 1 (not 1000)', () => {
    // Documents current behavior; thousands separators are not supported.
    assert.equal(parseAmount('1,000'), 1);
  });
});

describe('validateRates', () => {
  test('accepts the real Frankfurter response format', () => {
    assert.deepEqual(validateRates(API_PAYLOAD), { rates: RATES, rateDate: '2026-10-07' });
  });

  test('rejects malformed payloads', () => {
    const cases = [
      null, 'x', {},
      { ...API_PAYLOAD, base: 'USD' },
      { ...API_PAYLOAD, date: 'yesterday' },
      { ...API_PAYLOAD, rates: null },
      { ...API_PAYLOAD, rates: { PLN: 4.38 } },
      { ...API_PAYLOAD, rates: { PLN: '4.38', TRY: 54.98 } },
      { ...API_PAYLOAD, rates: { PLN: 0, TRY: 54.98 } },
      { ...API_PAYLOAD, rates: { PLN: -4.38, TRY: 54.98 } },
      { ...API_PAYLOAD, rates: { PLN: Infinity, TRY: 54.98 } },
    ];
    for (const c of cases) assert.equal(validateRates(c), null, JSON.stringify(c));
  });
});

describe('cache', () => {
  test('save and load round-trip', () => {
    const storage = memoryStorage();
    assert.equal(saveCache(storage, validEntry()), true);
    assert.deepEqual(loadCache(storage), validEntry());
  });

  test('missing, corrupt or wrong-schema data gives null', () => {
    assert.equal(loadCache(memoryStorage()), null);
    assert.equal(loadCache(memoryStorage({ [CACHE_KEY]: '{not json' })), null);
    assert.equal(loadCache(memoryStorage({ [CACHE_KEY]: JSON.stringify(validEntry({ schema: 99 })) })), null);
    assert.equal(loadCache(memoryStorage({ [CACHE_KEY]: JSON.stringify(validEntry({ rates: { EUR: 1 } })) })), null);
    assert.equal(loadCache(memoryStorage({ [CACHE_KEY]: JSON.stringify(validEntry({ fetchedAt: 'nope' })) })), null);
  });

  test('storage errors do not throw', () => {
    const broken: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    assert.equal(loadCache(broken), null);
    assert.equal(saveCache(broken, validEntry()), false);
  });
});

describe('fetchRates', () => {
  test('requests the Frankfurter URL and builds a cache entry', async () => {
    let calledUrl: string | undefined;
    const fetchFn: FetchFn = async (url, init) => { calledUrl = url; return okFetch()(url, init); };
    const entry = await fetchRates({ fetchFn, now: () => NOW });
    assert.equal(calledUrl, API_URL);
    assert.equal(API_URL, 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=PLN,TRY');
    assert.deepEqual(entry, {
      schema: SCHEMA, provider: 'frankfurter', base: 'EUR', rates: RATES,
      rateDate: '2026-10-07', fetchedAt: '2026-10-07T20:41:12.000Z',
    });
  });

  test('times out', async () => {
    const hang: FetchFn = (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    await assert.rejects(fetchRates({ fetchFn: hang, now: () => NOW, timeoutMs: 10 }), { reason: 'timeout' });
  });

  test('times out while reading the response body', async () => {
    // Headers arrive, then the body stalls; like real fetch, json() rejects on abort.
    const stallBody: FetchFn = async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    });
    await assert.rejects(fetchRates({ fetchFn: stallBody, now: () => NOW, timeoutMs: 10 }), { reason: 'timeout' });
  });
});

describe('refreshRates', () => {
  test('success saves rates and reports current', async () => {
    const storage = memoryStorage();
    const result = await refreshRates({ storage, fetchFn: okFetch(), now: () => NOW });
    assert.equal(result.status, 'current');
    assert.equal(result.entry.rateDate, '2026-10-07');
    assert.deepEqual(loadCache(storage), result.entry);
  });

  const failures: Record<'network' | 'http' | 'invalid', FetchFn> = {
    network: async () => { throw new TypeError('Failed to fetch'); },
    http: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    invalid: okFetch({ base: 'EUR', date: '2026-10-07', rates: { PLN: 4.38 } }),
  };

  for (const [reason, fetchFn] of Object.entries(failures)) {
    test(`${reason} failure falls back to cache and leaves it unchanged`, async () => {
      const before = JSON.stringify(validEntry());
      const storage = memoryStorage({ [CACHE_KEY]: before });
      const result = await refreshRates({ storage, fetchFn, now: () => NOW });
      assert.equal(result.status, 'cached');
      assert.equal(result.reason, reason);
      assert.deepEqual(result.entry, validEntry());
      assert.equal(storage.data[CACHE_KEY], before);
    });
  }

  test('unparseable JSON counts as invalid', async () => {
    const storage = memoryStorage({ [CACHE_KEY]: JSON.stringify(validEntry()) });
    const fetchFn: FetchFn = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
    const result = await refreshRates({ storage, fetchFn, now: () => NOW });
    assert.equal(result.status, 'cached');
    assert.equal(result.reason, 'invalid');
  });

  test('failure with no cache reports unavailable', async () => {
    const result = await refreshRates({ storage: memoryStorage(), fetchFn: failures.network, now: () => NOW });
    assert.deepEqual(result, { status: 'unavailable', entry: null, reason: 'network' });
  });

  test('if saving failed, a later failure falls back to the in-memory rates', async () => {
    const noSave: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    const first = await refreshRates({ storage: noSave, fetchFn: okFetch(), now: () => NOW });
    assert.equal(first.status, 'current');

    const second = await refreshRates({ storage: noSave, fetchFn: failures.network, now: () => NOW, fallback: first.entry });
    assert.deepEqual(second, { status: 'cached', entry: first.entry, reason: 'network' });
  });

  test('fallback prefers whichever of memory and storage is newer', async () => {
    const older = validEntry({ fetchedAt: '2026-10-05T10:00:00.000Z' });
    const newer = validEntry({ fetchedAt: '2026-10-07T10:00:00.000Z' });
    const run = (stored: CacheEntry, fallback: CacheEntry) => refreshRates({
      storage: memoryStorage({ [CACHE_KEY]: JSON.stringify(stored) }),
      fetchFn: failures.network, now: () => NOW, fallback,
    });
    assert.deepEqual((await run(older, newer)).entry, newer);
    assert.deepEqual((await run(newer, older)).entry, newer);
    assert.deepEqual((await run(newer, { bogus: true } as unknown as CacheEntry)).entry, newer);
  });
});

describe('formatAge', () => {
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  test('labels', () => {
    assert.equal(formatAge(at(10_000), NOW), 'just now');
    assert.equal(formatAge(at(5 * 60_000), NOW), '5 min ago');
    assert.equal(formatAge(at(3 * 3_600_000), NOW), '3 h ago');
    assert.equal(formatAge(at(26 * 3_600_000), NOW), '1 day ago');
    assert.equal(formatAge(at(3 * 86_400_000), NOW), '3 days ago');
    assert.equal(formatAge(new Date(NOW + 60_000).toISOString(), NOW), 'just now');
  });
});
