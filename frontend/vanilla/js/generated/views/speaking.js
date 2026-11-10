// Source: src/app/app/(shell)/speaking/page.tsx :: SpeakingPage
// Native DOM presentation; server data via documented adapter, never bundled.
import {h,fragment,Link,InstantLink} from '../../native.js';
import {Card,StatCard,EmptyState,ProgressBar} from '../ui.js';
import {BackLink,Button,RegionFailureNotice as FailureNotice} from '../../../modules/shared/presentation.js';
import {microphoneTest} from '../../../modules/speaking/microphone.js';
import {notificationRead} from '../../../modules/shared/notification-read.js';
import {} from '../icons.js';
export function render(scope) {
    const { context, dict, user, locale, library, page = 1, cards, total, hasMore, days, rows, sets, counts, inventory, writingOther } = scope;
    const isStaff = role => ['teacher', 'admin', 'owner'].includes(role), isAdministrator = role => ['admin', 'owner'].includes(role);
    const MicrophoneTest = p => microphoneTest({ ...context, ...p }), NotificationRead = p => notificationRead({ ...context, ...p }), RegionFailureNotice = p => FailureNotice({ ...p, refresh: context.refresh });
    const kindLabel = (dict, type) => dict.admin[({ lesson: 'materialsKindLesson', reading: 'materialsKindReading', listening: 'materialsKindListening', writing: 'materialsKindWriting', speaking: 'materialsKindSpeaking', grammar: 'materialsKindGrammar', assignment: 'materialsKindAssignment', live_class: 'materialsKindLiveClass' })[type]];
    const t = dict.speakingHub;
    const SPEAKING_HUB_CARDS = [{ key: 'lessons', href: '/app/speaking/lessons' }, { key: 'partner', href: '/app/speaking/live-partner' }, { key: 'practice', href: '/app/speaking/practice' }, { key: 'fluency', href: '/app/speaking/speak-or-die' }];
    return (h("div", { className: "mx-auto flex max-w-5xl flex-col gap-6", "data-route-usable": "speaking" },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" }, dict.speakingPractice.title),
            h("p", { className: "mt-1 text-base text-ink-500" }, t.intro)),
        h("ul", { className: "motion-enter-stagger grid grid-cols-1 gap-4 md:grid-cols-2", "data-speaking-hub-cards": true }, SPEAKING_HUB_CARDS.map(({ key, href }) => (h("li", { key: key },
            h("article", { className: "card motion-lift group flex min-h-56 flex-col gap-3 p-6 motion-reduce:transition-none"+(key==='fluency'?' fluency-hub-card':'') },
                h("span", { className: "text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400" }, t.cards[key].eyebrow),
                h("h2", { className: "font-display text-xl text-ink-900" }, t.cards[key].title),
                h("p", { className: "text-base text-ink-500" }, t.cards[key].body),
                h("div", { className: "mt-auto flex flex-wrap items-start gap-3" },
                    key === "partner" && h(MicrophoneTest, { dict: dict }),
                    h(InstantLink, { href: href, intentPrefetch: true, "data-speaking-card": key, className: "btn-primary self-start" },
                        t.cards[key].cta,
                        " ",
                        h("span", { "aria-hidden": true }, "\u2192"))))))))));
}
