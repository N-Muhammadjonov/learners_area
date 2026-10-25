import overlay from './overlay-v59.js';

/**
 * Returns the generated dictionary with the Arena overlays merged over it. Plain objects merge recursively; any other
 * value from the overlay replaces the base value. The base object is never mutated, and the result is cached per base
 * object so repeated navigation does not rebuild it.
 */
const cache = new WeakMap();
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function merge(base, extra) {
  const out = {...base};
  for (const [key, value] of Object.entries(extra)) {
    out[key] = plain(value) && plain(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

export function withOverlays(base, locale) {
  const lang = locale === 'en' ? 'en' : 'uz';
  let byLang = cache.get(base);
  if (!byLang) { byLang = {}; cache.set(base, byLang); }
  if (!byLang[lang]) byLang[lang] = merge(base, overlay[lang]);
  return byLang[lang];
}
