import {h,fragment,Link} from '../native.js';
export function ListeningSequenceLocked({ dict, mcq = false }) {
    const t = dict.listening.academic;
    return h("section", { className: "card space-y-3 p-6", "data-listening-sequence-locked": true },
        h("h1", { className: "text-xl font-semibold" },
            "\uD83D\uDD12 ",
            t.locked),
        h("p", null, mcq ? dict.listening.mcqProgram.lockedHint : t.lockedHint),
        h(Link, { className: "btn-secondary", href: mcq ? '/app/listening/mcq' : '/app/listening/academic' }, mcq ? dict.listening.mcqProgram.title : t.title));
}
