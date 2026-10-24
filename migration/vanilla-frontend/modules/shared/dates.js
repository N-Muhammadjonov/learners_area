/**
 * Date presentation for server timestamps in the centre's timezone. Invalid or missing input renders as an em dash,
 * never a guess. `null`, `undefined`, booleans and '' are refused explicitly, because `new Date(null)` is the epoch.
 */
export function fmtDate(value, locale = 'en') {
  const accepted = value instanceof Date || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim() !== '');
  if (!accepted) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'uz' ? 'uz-UZ' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tashkent',
  }).format(d);
}
