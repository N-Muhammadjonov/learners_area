import {h} from '../../js/native.js';
import {viewData} from '../../js/adapters/frontend.js';
import {grammarArea, grammarDTO} from '../../js/adapters/entry-routes-v35.js';
import {Card, ProgressBar} from '../../js/generated/ui.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {MASTERY_SESSIONS_DISPLAY} from './mastery.js';
import {mountSkillBookCatalog} from './book-skill.js';
import {grammarPracticeHref} from './practice-route.js';

/**
 * Grammar topics `/app/grammar?tab=writing|speaking` (the original GrammarPage + GrammarTopics).
 * `/app/grammar` with no tab redirects to the Lessons section, as in the original.
 * Writing and Speaking differ only by the skill-area filter and the section label.
 */
export function mount(context) {
  const {root, url, signal, dict, navigate} = context;
  const area = grammarArea(url);
  if (!area) {
    void navigate('/app/grammar/lessons', {replace: true});
    return;
  }
  const t = dict.grammar;
  const host = h('div', {'data-grammar-topics-host': area});
  root.append(host);
  const requestedBook = url.searchParams.get('book');
  if (requestedBook) {
    const destination=grammarPracticeHref(url.pathname+url.search);
    if(destination!==url.pathname+url.search) void navigate(destination,{replace:true});
    else host.replaceChildren(h('p',{role:'alert'},
      context.locale==='en'?'Grammar lesson not found.':'Grammar darsi topilmadi.'));
    return;
  }
  const bookHost = h('div', {'data-grammar-skill-book-host': area});
  const legacyContent = h('div', {'data-grammar-skill-legacy-content': area});
  const legacySection = h('section', {class: 'grammar-skill-legacy'},
    h('h2', {}, context.locale === 'en' ? 'Other grammar exercises' : 'Boshqa grammar mashqlari'),
    legacyContent);
  host.append(bookHost, legacySection);
  mountSkillBookCatalog(context, bookHost, area);
  let generation = 0;

  function skeleton() {
    return h('div', {'aria-hidden': 'true', class: 'flex flex-col gap-3', 'data-async-loading': 'grammar-topics'},
      [0, 1, 2].map(index => h('div', {key: index, class: 'h-24 animate-pulse rounded-xl bg-ink-50'})));
  }

  function row({topic, totalExercises, mastery}) {
    // Same DOM as the original <Link>: a bare anchor with no class (display:block here shifted nothing but was not in main).
    return h('a', {href: `/app/grammar/${topic.id}`, 'data-topic-link': topic.id},
      h(Card, {className: 'hover:border-signal-400', 'data-topic-row': topic.id},
        h('div', {class: 'mb-2 flex items-center justify-between'},
          h('p', {class: 'text-sm font-medium text-ink-900'}, topic.title),
          h('span', {class: 'flex items-center gap-2 text-xs text-ink-300'},
            mastery?.mastered
              ? h('span', {class: 'badge bg-band-good/10 text-band-good', 'data-topic-mastered': topic.id}, t.masteryMastered)
              : null,
            mastery
              // Separate text nodes, in the order React emits them for the original JSX; one merged string
              // shapes differently at subpixel level and fails the pixel-parity gate.
              ? h('span', {'data-topic-score': topic.id},
                t.masteryScore, ': ', String(mastery.scorePercent), '% · ',
                String(mastery.sessions), '/', String(MASTERY_SESSIONS_DISPLAY), ' ', t.masterySessions.toLowerCase())
              : h('span', {'data-topic-mastery-unavailable': topic.id}, '—'))),
        mastery ? h(ProgressBar, {value: mastery.scorePercent}) : null,
        h('p', {class: 'mt-1 text-xs text-ink-300'}, `${t.masteryActivities}: ${totalExercises} ${t.exercises}`)));
  }

  function render(rows) {
    const selected = rows.filter(r => r.topic.skillArea === area);
    const masteryUnavailable = selected.some(r => r.masteryUnavailable);
    return h('div', {class: 'mx-auto flex max-w-3xl flex-col gap-4', 'data-route-usable': 'grammar'},
      masteryUnavailable
        ? RegionFailureNotice({region: 'grammar-mastery', message: dict.errors.unknown, retryLabel: dict.errorPage.retry, refresh: load})
        : null,
      h('div', {class: 'flex flex-col gap-3', 'data-grammar-topics': '', 'data-async-content': 'grammar-topics'},
        h('section', {class: 'space-y-3', 'data-grammar-skill': area}, selected.map(row))));
  }

  async function load() {
    const current = ++generation;
    legacyContent.replaceChildren(skeleton());
    try {
      const raw = await viewData(url.pathname + url.search, signal);
      if (signal.aborted || current !== generation) return;
      legacyContent.replaceChildren(render(grammarDTO(raw)));
    } catch {
      if (signal.aborted || current !== generation) return;
      legacyContent.replaceChildren(RegionFailureNotice({region: 'grammar-topics', message: dict.common.error, retryLabel: dict.errorPage.retry, refresh: load}));
    }
  }

  signal.addEventListener('abort', () => { generation++; host.replaceChildren(); }, {once: true});
  void load();
}
