import {
  loadCache, refreshRates, convert, parseAmount, formatAge,
} from './rates.js';

const $ = (id) => document.getElementById(id);
const form = $('converter');
const amountInput = $('amount');
const amountError = $('amount-error');
const fromSelect = $('from');
const toSelect = $('to');
const resultEl = $('result');
const rateEl = $('rate');
const statusEl = $('status');
const statusTitle = $('status-title');
const statusDetail = $('status-detail');
const refreshButton = $('refresh');

// { status: 'loading' | 'current' | 'cached' | 'unavailable', entry, reason? }
let state = { status: 'loading', entry: null };
let refreshing = false;

const storage = (() => {
  try { return window.localStorage; } catch { return null; }
})() || { getItem: () => null, setItem: () => { throw new Error('no storage'); } };

const formatMoney = (value, currency) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);

const formatRate = (value) =>
  new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);

const formatDateTime = (iso) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

const formatRateDate = (yyyyMmDd) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${yyyyMmDd}T00:00:00Z`));

function failureText(reason) {
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
  const { status, entry, reason } = state;
  statusEl.dataset.state = status;
  refreshButton.disabled = refreshing;
  refreshButton.textContent = refreshing ? 'Refreshing…' : 'Refresh rates';

  const updated = entry
    ? `Last updated ${formatDateTime(entry.fetchedAt)} (${formatAge(entry.fetchedAt, Date.now())}). ` +
      `ECB reference rate of ${formatRateDate(entry.rateDate)}.`
    : '';

  switch (status) {
    case 'current':
      statusTitle.textContent = 'Current rates';
      statusDetail.textContent = updated;
      break;
    case 'cached':
      statusTitle.textContent = refreshing ? 'Cached rates – checking for updates…' : 'Cached rates';
      statusDetail.textContent = (reason ? `${failureText(reason)} ` : '') + updated;
      break;
    case 'unavailable':
      statusTitle.textContent = 'Rates unavailable';
      statusDetail.textContent =
        `${failureText(reason)} Connect to the internet once and press “Refresh rates”.`;
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
