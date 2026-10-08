// Exchange-rate logic with no DOM access, so it runs in the browser and in Node tests.
// Storage, fetch and clock are passed in as parameters.

export const CURRENCIES = ['EUR', 'PLN', 'TRY'];
export const BASE = 'EUR';
export const CACHE_KEY = 'fx-rates-v1';
export const SCHEMA = 1;
export const API_URL =
  'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=' +
  CURRENCIES.filter((c) => c !== BASE).join(',');
export const FETCH_TIMEOUT_MS = 8000;

const isPositiveNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// Turns a Frankfurter response into our rate map, or returns null if anything is wrong.
export function validateRates(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.base !== BASE) return null;
  if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return null;
  if (!payload.rates || typeof payload.rates !== 'object') return null;

  const rates = { [BASE]: 1 };
  for (const code of CURRENCIES) {
    if (code === BASE) continue;
    if (!isPositiveNumber(payload.rates[code])) return null;
    rates[code] = payload.rates[code];
  }
  return { rates, rateDate: payload.date };
}

function isValidEntry(entry) {
  return (
    entry &&
    entry.schema === SCHEMA &&
    entry.base === BASE &&
    typeof entry.rateDate === 'string' &&
    typeof entry.fetchedAt === 'string' &&
    !Number.isNaN(Date.parse(entry.fetchedAt)) &&
    entry.rates &&
    CURRENCIES.every((c) => isPositiveNumber(entry.rates[c]))
  );
}

export function loadCache(storage) {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return isValidEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

export function saveCache(storage, entry) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false; // e.g. storage full or disabled; the rates are still usable this session
  }
}

// Fetches and validates rates. Throws an Error with a `reason` of
// 'network' | 'timeout' | 'http' | 'invalid' on failure.
// The timeout covers both the request and reading the response body.
export async function fetchRates({ fetchFn, now, timeoutMs = FETCH_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let payload;
  try {
    let response;
    try {
      response = await fetchFn(API_URL, { signal: controller.signal, cache: 'no-store' });
    } catch (err) {
      throw failure(controller.signal.aborted ? 'timeout' : 'network', err);
    }
    if (!response.ok) throw failure('http', new Error(`HTTP ${response.status}`));

    try {
      payload = await response.json();
    } catch (err) {
      throw failure(controller.signal.aborted ? 'timeout' : 'invalid', err);
    }
  } finally {
    clearTimeout(timer);
  }
  const parsed = validateRates(payload);
  if (!parsed) throw failure('invalid', new Error('Unexpected response format'));

  return {
    schema: SCHEMA,
    provider: 'frankfurter',
    base: BASE,
    rates: parsed.rates,
    rateDate: parsed.rateDate,
    fetchedAt: new Date(now()).toISOString(),
  };
}

function failure(reason, cause) {
  const err = new Error(`Rate fetch failed: ${reason}`);
  err.reason = reason;
  err.cause = cause;
  return err;
}

// Tries the network; falls back to the newer of the stored cache and `fallback`
// (rates already in memory, which may not have been saved if storage failed).
// Returns { status: 'current' | 'cached' | 'unavailable', entry, reason? }.
export async function refreshRates({ storage, fetchFn, now, timeoutMs, fallback = null }) {
  try {
    const entry = await fetchRates({ fetchFn, now, timeoutMs });
    saveCache(storage, entry);
    return { status: 'current', entry };
  } catch (err) {
    const cached = newest(loadCache(storage), isValidEntry(fallback) ? fallback : null);
    const reason = err.reason || 'network';
    return cached
      ? { status: 'cached', entry: cached, reason }
      : { status: 'unavailable', entry: null, reason };
  }
}

function newest(a, b) {
  if (!a || !b) return a || b;
  return Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a;
}

// Returns the converted amount, or null if the input can't be converted.
export function convert(amount, from, to, rates) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (!rates || !isPositiveNumber(rates[from]) || !isPositiveNumber(rates[to])) return null;
  if (from === to) return amount;
  return (amount * rates[to]) / rates[from];
}

// Parses user input; accepts a comma or dot as the decimal separator.
export function parseAmount(text) {
  const cleaned = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  return Number(cleaned);
}

// Human-readable age, e.g. "just now", "5 min ago", "3 h ago", "2 days ago".
export function formatAge(fetchedAt, nowMs) {
  const diff = Math.max(0, nowMs - Date.parse(fetchedAt));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
