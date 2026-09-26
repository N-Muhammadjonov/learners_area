# Live reference audit — ieltsbooster.uz

What could be observed, what could not, and what was deliberately not copied.

**Access status, stated plainly.** The live site was reached with a fetching
client, read-only, and it answered with its **login gate only**: a language
toggle (UZ/EN), a night-mode icon, the logo file, a module strip
(🎧 Listening · 📖 Reading · ✍️ Writing · 🎙 Speaking · 🔤 Grammar · 🧠 Vocabulary),
"Talaba kirishi" with a "Xush kelibsiz" heading, a note that sign-in is via
Telegram, the device-account concept, "📨 Kirish uchun so'rov yuborish", a
four-step how-to, a YouTube walkthrough link and a `t.me/booster8_bot` link.
Everything behind that gate was **not** accessed: the reference is read-only and
authentication was not bypassed, so deep live navigation study is **EXTERNALLY
UNVERIFIED** and is not claimed anywhere in this project.

The deeper reference therefore remains an earlier static extract of the same
product kept outside the repository (read-only, `/tmp/ref`): a dashboard, the
`p-*` module screens, a long label list and a paid-course gate script. Findings
from it are recorded below as observations.

## Observed facts (no source copied)

| Observation | Where it appeared | What Learners Area does with it |
| --- | --- | --- |
| Module strip = Listening / Reading / Writing / Speaking / Grammar / Vocabulary | login gate, and the module screens | the same module set is our MODULES group — this is a shared vocabulary of IELTS products, not a copied design |
| Retention is its own mode inside Reading ("one text takes 4 minutes", CTA "Try Retention →") | dashboard card + reading screen | adopted as an *idea*: our retention drill is a Reading mode of its own (`/reading/retention`, linked from the hub's Retention tab), implemented with our own text, scoring-shape and UI |
| Dashboard cards: "Continue where you left off", "My tasks", "What's open now", "Need help?" | dashboard | adopted as information architecture; our cards read real server state |
| Counters (recorded lessons, writing lessons watched, course day, modules open) | dashboard | not copied; our dashboard shows what the database can actually prove |
| "Real exam mode" | reading/listening screens | our timed attempt with autosave and a raw score, built on our own schema |
| Screen inventory `p-dashboard, p-reading, p-listening, p-writing, p-speaking, p-vocab, p-grams, p-gramw, p-live, p-ted` | static extract | confirms the module set above; no layout, markup or CSS was taken |
| XP / streak / mastery kept in `localStorage` | static extract | **rejected**: in Learners Area every score, streak and mastery value is server-authoritative; `localStorage` is never the source of truth for a learning result |
| A paid-course gate script guarding screens | static extract | **irrelevant by design**: our access control is server-side (role + account status + publication state), never a client gate |
| "AI examiner · British English", "Speaking with Maya" | labels in the extract | **not reproduced**: no acoustic or AI examiner claim exists in our product; speaking practice says plainly that there is no transcript |

## Rules this audit was held to

- Read-only. No request that could change state, and no attempt to authenticate.
- Nothing copied: no code, CSS, HTML, JavaScript, content, questions, answers,
  recordings, logos, trademarks, wording, endpoints or authentication model.
- Only observable facts are recorded, and access limits are stated rather than
  papered over.
- Learners Area keeps its own identity throughout: navy / gold / cream, its own
  copy in UZ and EN, its own geometry tokens and its own artwork.

## What "clean room" means for the deliverables here

Nothing in `docs/`, `src/` or the database derives from the reference site's
content. The two visible influences are (a) the module vocabulary that any IELTS
product shares and (b) the decision to treat retention as a first-class reading
mode — a product decision recorded in this repository and implemented
independently. Where the reference keeps learner state on the device, this
project keeps it in PostgreSQL; where the reference gates screens on the client,
this project gates them on the server.
