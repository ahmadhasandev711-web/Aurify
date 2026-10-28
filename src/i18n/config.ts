// D-09: Arabic is the default (most users are Egyptian); English is fully supported.
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const dirOf = (l: Locale): 'rtl' | 'ltr' => (l === 'ar' ? 'rtl' : 'ltr');
