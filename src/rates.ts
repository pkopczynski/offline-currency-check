// Exchange-rate logic with no DOM access, so it runs in the browser and in Node tests.
// Storage, fetch and clock are passed in as parameters.

export const CURRENCIES = ['EUR', 'PLN', 'TRY'] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Rates = Record<Currency, number>;

export const BASE = 'EUR' satisfies Currency;
export const CACHE_KEY = 'fx-rates-v1';
export const SCHEMA = 1;
export const API_URL =
  'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=' +
  CURRENCIES.filter((c) => c !== BASE).join(',');
export const FETCH_TIMEOUT_MS = 8000;

export interface CacheEntry {
  schema: typeof SCHEMA;
  provider: 'frankfurter';
  base: typeof BASE;
  rates: Rates;
  rateDate: string; // YYYY-MM-DD, the ECB publication date
  fetchedAt: string; // ISO timestamp of the successful fetch
}

export type FailureReason = 'network' | 'timeout' | 'http' | 'invalid';

export type RefreshResult =
  | { status: 'current'; entry: CacheEntry }
  | { status: 'cached'; entry: CacheEntry; reason: FailureReason }
  | { status: 'unavailable'; entry: null; reason: FailureReason };

// The subset of Web Storage we use; localStorage and in-memory fakes both fit.
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The subset of fetch we use; window.fetch fits.
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchFn = (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<FetchResponse>;

export class RateFetchError extends Error {
  readonly reason: FailureReason;

  constructor(reason: FailureReason, cause: unknown) {
    super(`Rate fetch failed: ${reason}`, { cause });
    this.reason = reason;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isPositiveNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

// Turns a Frankfurter response into our rate map, or returns null if anything is wrong.
export function validateRates(payload: unknown): { rates: Rates; rateDate: string } | null {
  if (!isRecord(payload)) return null;
  if (payload.base !== BASE) return null;
  if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return null;
  const source = payload.rates;
  if (!isRecord(source)) return null;

  const rates: Partial<Rates> = { [BASE]: 1 };
  for (const code of CURRENCIES) {
    if (code === BASE) continue;
    const rate = source[code];
    if (!isPositiveNumber(rate)) return null;
    rates[code] = rate;
  }
  return { rates: rates as Rates, rateDate: payload.date };
}

function isValidEntry(entry: unknown): entry is CacheEntry {
  if (!isRecord(entry)) return false;
  const { rates } = entry;
  return (
    entry.schema === SCHEMA &&
    entry.base === BASE &&
    typeof entry.rateDate === 'string' &&
    typeof entry.fetchedAt === 'string' &&
    !Number.isNaN(Date.parse(entry.fetchedAt)) &&
    isRecord(rates) &&
    CURRENCIES.every((c) => isPositiveNumber(rates[c]))
  );
}

export function loadCache(storage: KeyValueStorage): CacheEntry | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: unknown = JSON.parse(raw);
    return isValidEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

export function saveCache(storage: KeyValueStorage, entry: CacheEntry): boolean {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false; // e.g. storage full or disabled; the rates are still usable this session
  }
}

interface FetchOptions {
  fetchFn: FetchFn;
  now: () => number;
  timeoutMs?: number | undefined;
}

// Fetches and validates rates. Throws a RateFetchError on failure.
// The timeout covers both the request and reading the response body.
export async function fetchRates({ fetchFn, now, timeoutMs = FETCH_TIMEOUT_MS }: FetchOptions): Promise<CacheEntry> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let payload: unknown;
  try {
    let response: FetchResponse;
    try {
      response = await fetchFn(API_URL, { signal: controller.signal, cache: 'no-store' });
    } catch (err) {
      throw new RateFetchError(controller.signal.aborted ? 'timeout' : 'network', err);
    }
    if (!response.ok) throw new RateFetchError('http', new Error(`HTTP ${response.status}`));

    try {
      payload = await response.json();
    } catch (err) {
      throw new RateFetchError(controller.signal.aborted ? 'timeout' : 'invalid', err);
    }
  } finally {
    clearTimeout(timer);
  }
  const parsed = validateRates(payload);
  if (!parsed) throw new RateFetchError('invalid', new Error('Unexpected response format'));

  return {
    schema: SCHEMA,
    provider: 'frankfurter',
    base: BASE,
    rates: parsed.rates,
    rateDate: parsed.rateDate,
    fetchedAt: new Date(now()).toISOString(),
  };
}

interface RefreshOptions extends FetchOptions {
  storage: KeyValueStorage;
  fallback?: CacheEntry | null;
}

// Tries the network; falls back to the newer of the stored cache and `fallback`
// (rates already in memory, which may not have been saved if storage failed).
export async function refreshRates({ storage, fetchFn, now, timeoutMs, fallback = null }: RefreshOptions): Promise<RefreshResult> {
  try {
    const entry = await fetchRates({ fetchFn, now, timeoutMs });
    saveCache(storage, entry);
    return { status: 'current', entry };
  } catch (err) {
    const cached = newest(loadCache(storage), isValidEntry(fallback) ? fallback : null);
    const reason = err instanceof RateFetchError ? err.reason : 'network';
    return cached
      ? { status: 'cached', entry: cached, reason }
      : { status: 'unavailable', entry: null, reason };
  }
}

function newest(a: CacheEntry | null, b: CacheEntry | null): CacheEntry | null {
  if (!a || !b) return a || b;
  return Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a;
}

// Returns the converted amount, or null if the input can't be converted.
// `from`/`to` are plain strings because they come from the DOM; unknown codes give null.
export function convert(
  amount: number | null,
  from: string,
  to: string,
  rates: Partial<Record<string, number>> | null,
): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (!rates) return null;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!isPositiveNumber(fromRate) || !isPositiveNumber(toRate)) return null;
  if (from === to) return amount;
  return (amount * toRate) / fromRate;
}

// Parses user input; accepts a comma or dot as the decimal separator.
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  return Number(cleaned);
}

// Human-readable age, e.g. "just now", "5 min ago", "3 h ago", "2 days ago".
export function formatAge(fetchedAt: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(fetchedAt));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
