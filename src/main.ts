import './styles/main.css';
import {
  loadCache, refreshRates, convert, parseAmount, formatAge,
} from './rates.ts';
import type { CacheEntry, FailureReason, KeyValueStorage, RefreshResult } from './rates.ts';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing #${id}`);
  return el;
}

const form = byId('converter', HTMLFormElement);
const amountInput = byId('amount', HTMLInputElement);
const amountError = byId('amount-error', HTMLElement);
const fromSelect = byId('from', HTMLSelectElement);
const toSelect = byId('to', HTMLSelectElement);
const resultEl = byId('result', HTMLOutputElement);
const rateEl = byId('rate', HTMLElement);
const statusEl = byId('status', HTMLElement);
const statusTitle = byId('status-title', HTMLElement);
const statusDetail = byId('status-detail', HTMLElement);
const refreshButton = byId('refresh', HTMLButtonElement);

type State = RefreshResult | { status: 'loading'; entry: null } | { status: 'cached'; entry: CacheEntry; reason?: undefined };

let state: State = { status: 'loading', entry: null };
let refreshing = false;

const storage: KeyValueStorage = (() => {
  try { return window.localStorage; } catch { return null; }
})() || { getItem: () => null, setItem: () => { throw new Error('no storage'); } };

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);

const formatRate = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

const formatRateDate = (yyyyMmDd: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${yyyyMmDd}T00:00:00Z`));

function failureText(reason: FailureReason | undefined): string {
  if (!navigator.onLine) return 'You are offline.';
  switch (reason) {
    case 'timeout': return 'The rate server took too long to respond.';
    case 'http': return 'The rate server returned an error.';
    case 'invalid': return 'The rate server sent unexpected data.';
    default: return 'Could not reach the rate server.';
  }
}

function renderResult() {
  const amount = parseAmount(amountInput.value);
  const invalid = amount === null && amountInput.value.trim() !== '';
  amountInput.setAttribute('aria-invalid', String(invalid));
  amountError.hidden = !invalid;

  const from = fromSelect.value;
  const to = toSelect.value;
  const rates = state.entry?.rates;

  if (!rates) {
    resultEl.textContent = '—';
    rateEl.textContent = state.status === 'loading' ? '' : 'No exchange rates available yet.';
    return;
  }

  rateEl.textContent = `1 ${from} = ${formatRate(convert(1, from, to, rates))} ${to}`;
  const value = amount === null ? null : convert(amount, from, to, rates);
  resultEl.textContent = value === null ? '—' : formatMoney(value, to);
}

function renderStatus() {
  const { status, entry } = state;
  statusEl.dataset.state = status;
  refreshButton.disabled = refreshing;
  refreshButton.textContent = refreshing ? 'Refreshing…' : 'Refresh rates';

  const updated = entry
    ? `Last updated ${formatDateTime(entry.fetchedAt)} (${formatAge(entry.fetchedAt, Date.now())}). ` +
      `ECB reference rate of ${formatRateDate(entry.rateDate)}.`
    : '';

  switch (state.status) {
    case 'current':
      statusTitle.textContent = 'Current rates';
      statusDetail.textContent = updated;
      break;
    case 'cached':
      statusTitle.textContent = refreshing ? 'Cached rates – checking for updates…' : 'Cached rates';
      statusDetail.textContent = (state.reason ? `${failureText(state.reason)} ` : '') + updated;
      break;
    case 'unavailable':
      statusTitle.textContent = 'Rates unavailable';
      statusDetail.textContent =
        `${failureText(state.reason)} Connect to the internet once and press “Refresh rates”.`;
      break;
    default:
      statusTitle.textContent = 'Loading rates…';
      statusDetail.textContent = '';
  }
}

function render() {
  renderResult();
  renderStatus();
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  renderStatus();
  const result = await refreshRates({
    storage, fetchFn: window.fetch.bind(window), now: Date.now, fallback: state.entry,
  });
  refreshing = false;
  state = result;
  render();
}

form.addEventListener('submit', (e) => e.preventDefault());
amountInput.addEventListener('input', renderResult);
fromSelect.addEventListener('change', renderResult);
toSelect.addEventListener('change', renderResult);
refreshButton.addEventListener('click', refresh);
// Keep the "x min ago" label accurate.
setInterval(renderStatus, 60_000);

// Show cached rates immediately, then try to fetch fresh ones.
const cached = loadCache(storage);
if (cached) state = { status: 'cached', entry: cached };
render();
refresh();

// The service worker only exists in production builds; in dev it would fight Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
