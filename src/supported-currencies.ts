// The Supported currencies: every currency Frankfurter publishes an ECB reference rate for.
// The English names are the fallback when the device can't name a currency in its own language.

export const CURRENCY_NAMES = {
  AUD: 'Australian dollar',
  BRL: 'Brazilian real',
  CAD: 'Canadian dollar',
  CHF: 'Swiss franc',
  CNY: 'Chinese yuan',
  CZK: 'Czech koruna',
  DKK: 'Danish krone',
  EUR: 'Euro',
  GBP: 'British pound',
  HKD: 'Hong Kong dollar',
  HUF: 'Hungarian forint',
  IDR: 'Indonesian rupiah',
  ILS: 'Israeli new shekel',
  INR: 'Indian rupee',
  ISK: 'Icelandic króna',
  JPY: 'Japanese yen',
  KRW: 'South Korean won',
  MXN: 'Mexican peso',
  MYR: 'Malaysian ringgit',
  NOK: 'Norwegian krone',
  NZD: 'New Zealand dollar',
  PHP: 'Philippine peso',
  PLN: 'Polish złoty',
  RON: 'Romanian leu',
  SEK: 'Swedish krona',
  SGD: 'Singapore dollar',
  THB: 'Thai baht',
  TRY: 'Turkish lira',
  USD: 'US dollar',
  ZAR: 'South African rand',
} as const;

export type SupportedCurrency = keyof typeof CURRENCY_NAMES;

// Sorted by code.
export const SUPPORTED_CURRENCIES = (Object.keys(CURRENCY_NAMES) as SupportedCurrency[]).sort();

export const isSupportedCurrency = (code: unknown): code is SupportedCurrency =>
  typeof code === 'string' && Object.hasOwn(CURRENCY_NAMES, code);
