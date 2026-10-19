// The device's language. Only currency names use it for now; it's the starting point for a
// future translation system. No DOM access: the navigator is passed in.

export const FALLBACK_LOCALE = 'en';

export interface LanguagePreferences {
  languages?: readonly string[];
  language?: string;
}

// The device's preferred language, or English when it gives none.
export function preferredLocale(prefs: LanguagePreferences | undefined): string {
  return prefs?.languages?.[0] || prefs?.language || FALLBACK_LOCALE;
}
