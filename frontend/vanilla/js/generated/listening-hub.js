import {h,fragment,Link} from '../native.js';
export function render(scope) {
    const { dict, test, meta, cards, id } = scope;
    const detail = { test }, t = dict.fullListeningHub, r = t.research;
    const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
    return h("div", { className: "listening-workspace listening-hub w-full space-y-6" },
        h("p", { className: "listening-eyebrow" }, r.badge),
        h("h1", { className: "font-display text-4xl" }, detail.test.title),
        h("p", null, r.intro),
        h("p", null, fill(t.testMeta, { parts: meta.parts, questions: meta.questions, min: meta.min })),
        detail.test.publicationState === "draft" && h("p", { role: "status", className: "card" }, t.qaDraft),
        h("p", null, fill(t.completedCount, { done: cards.filter(a => a.complete).length, total: cards.length })),
        h("div", { className: "listening-purpose-grid" }, cards.map(a => h("article", { key: a.path, className: `card flex flex-col gap-4 ${a.activity === 1 ? "listening-exam-purpose" : ""}` },
            h("p", { className: "listening-eyebrow" }, a.tag),
            h("h2", { className: "font-display text-2xl font-bold" }, a.name),
            h("p", null, a.complete ? t.completed : a.latest ? t.inProgress : t.notStarted),
            a.latest?.score != null && h("p", null,
                a.latest.score,
                " / ",
                a.latest.total),
            a.activity === 1 && h(Link, { className: "btn-secondary", href: `/app/listening/tests/${id}/study` }, t.studyLink),
            h(Link, { className: "btn-primary mt-auto self-start", href: `/app/listening/tests/${id}/${a.path}` },
                a.activity === 1 ? t.exam : a.complete ? t.review : t.start,
                " \u2192")))));
}
