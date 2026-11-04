import fr from './locales/fr.js';

/**
 * Minimal i18n: English source strings are the keys, other languages map them to translations.
 * Missing translations fall back to English.
 */
const DICTS = { fr };
export const LANGUAGES = [['en', 'EN'], ['fr', 'FR']];

let lang = 'en';
try {
  const saved = localStorage.getItem('lang');
  if (saved === 'en' || DICTS[saved]) lang = saved;
} catch {
  // storage unavailable: keep the default language
}

export function getLang() {
  return lang;
}

/** Persists the language and reloads the page (panels are built once at startup). */
export function setLang(next) {
  try {
    localStorage.setItem('lang', next);
  } catch {
    // ignore
  }
  location.reload();
}

export function t(text, params) {
  let s = (lang !== 'en' && DICTS[lang]?.[text]) || text;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  return s;
}

/** Locale used for number formatting. */
export function numberLocale() {
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}
