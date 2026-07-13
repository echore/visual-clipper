// Thin wrapper over chrome.i18n. Falls back to the key itself when the API is
// unavailable (Node tests) or the key is missing — a visible key in the UI is
// a loud, debuggable failure.
export function t(key, subs) {
  const msg = globalThis.chrome?.i18n?.getMessage?.(key, subs);
  return msg || key;
}

// Fills every element carrying a data-i18n* attribute. -html variants exist for
// the few strings with inline <strong>/<code> markup; all strings are bundled
// with the extension, never remote.
export function localizeDocument() {
  document.documentElement.lang = globalThis.chrome?.i18n?.getUILanguage?.() || 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-href]')) el.setAttribute('href', t(el.dataset.i18nHref));
}
