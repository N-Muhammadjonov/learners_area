/** Route existing Grammar book lessons into a standalone focus view.
 * The original ShadowRoot book HTML and scoring engine remain unchanged.
 */
const ROOT = '/app/grammar/practice';
const BOOK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const TRACKS = new Set(['speaking', 'writing']);

export function grammarPracticeHref(href, {fromPlan = false} = {}) {
  if (typeof href !== 'string' || !href.startsWith('/app/grammar')) return href;
  const url = new URL(href, 'https://learners-area.invalid');
  const isLegacy = url.pathname === '/app/grammar/lessons';
  const track = url.pathname === '/app/grammar' ? url.searchParams.get('tab') : null;
  const isSkill = TRACKS.has(track);
  const book = url.searchParams.get('book');
  if ((!isLegacy && !isSkill) || !BOOK_ID.test(book ?? '')) return href;
  const target = new URL(ROOT, 'https://learners-area.invalid');
  target.searchParams.set('book', book);
  if (isSkill) target.searchParams.set('track', track);
  if (fromPlan) target.searchParams.set('from', 'plan');
  return target.pathname + target.search;
}

export function isValidPracticeBook(book) {
  return typeof book === 'string' && BOOK_ID.test(book);
}

export function isValidPracticeTrack(track) {
  return track === null || TRACKS.has(track);
}
