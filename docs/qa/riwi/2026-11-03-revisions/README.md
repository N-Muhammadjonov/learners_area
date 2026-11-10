# RIWI requested revisions — 2026-11-03

This acceptance supersedes the older expansion UI descriptions. Work remained
on `arena/learners-area-next`; PR #114 remains draft. No main merge, production
deployment/write, or new schema migration was performed.

## Result

- Publisher/source/PDF headings and source controls removed from learner replies;
  internal rights, hashes and citations retained.
- Upward UZ/ENG settings affect future replies only. No chat turn, retranslation,
  or `/language` command. Clear/new chat discard reply context.
- Published material is resolved automatically under existing role, ownership,
  enrollment, exact-version and active-exam guards. No manual material picker.
- Visible Thinking/O‘ylayapman; finite grammar parsing, approved example
  translations and dictionary/glossary support. Unsupported language remains
  unsupported rather than being presented as a fluent guessed translation.
- All 1,640 supplied synthetic questions retained; 287 authored bilingual answer
  profiles and governed lesson links cover repeated needs and permission cases.
  Mixed Uzbek/English, supported suffixes, typos and Cyrillic are normalised.
- Unknown questions can enter private review signals; no automatic global
  adoption of learner statements. Explicit clarification aliases remain local
  to an owned conversation and disappear from use after clear/new chat.
- 290 new grammar cards, three bilingual examples each, plus 12 support units.
  All three packs activated through authenticated Safari Owner candidate →
  approve → promote; no conflicts. Read-only QA SQL verified 302 new/665 total
  active units. Original source binary unchanged and not committed.
- RIWI breadcrumb, exact requested Uzbek welcome, no suggestion buttons, and
  permanent accuracy notice below the composer. Only the transcript scrolls.
- Unknown-question fallback matches the Owner's exact requested Uzbek text:
  “Savolingizni to'liqroq yozib bera olasizmi? Qaysi mavzuga tushunmadingiz?
  Bilmagan ma'lumotimdan tahminni fakt deb bermayman!” Greetings contain no
  unsolicited topic examples.

## Checks

Tested application: `1fddbd3ccf979caab1eec35928e5d06fdd5d490c`.

| Check | Result |
| --- | --- |
| Full RIWI backend | 2,623 passed |
| Full frontend | 1,277 passed, 0 failed, 11 existing fixture skips |
| Main core contracts/SEO/build/assets | 37 passed |
| Native build | 513 files, 125 routes |
| New grammar reference subset | 587 passed |
| Final affected chat/shell subset | 22 passed |

## Evidence boundaries

`tested-files.json` pins source/test hashes at the final application commit.
`progress.json` records the sequential requirement commits and affected tests.
`activation-receipt.json` contains the three normal Owner activation receipts.
`live-acceptance.json` contains runtime identity, safe synthetic chat samples,
layout summaries and hashes of local raw receipts. Raw logs remain in the Owner's
RIWI workspace under `evidence/20261103/revisions`.

Safari used the existing authenticated Owner session on the stable branch
Preview. Live cases covered neutral grammar explanations and three examples,
exercise prompts, exact translation, correction, irregular verb lookup, mixed
language, future-only reply language, context reset, and exact unknown wording.
Day/night responsive screenshots were inspected at configured 390×844 and
1440×900. Raw resize events include transitional sizes and a docked Inspector
with only 91px page height; these are not accepted layout samples. Settled
normal/responsive samples show no horizontal overflow and visible composer and
notice. This is Safari emulation, not physical iPhone/keyboard acceptance.

Meaning-focused checks used fresh learner wording and explicit negative controls.
They are not a second human review or a claim that a bounded rule engine can
understand every new sentence. DOCX extraction read all numbered lessons and
tables; 4 of 58 rendered pages were sampled visually, not full layout acceptance.
External AI remained disabled in the live Owner diagnostic.

The 11 full-frontend skips are existing legacy Listening importer fixtures
requiring `LEGACY_LISTENING_FIXTURE`, not failed RIWI checks. Student guards have
automated/SQL evidence; a separate authenticated student Safari session and
microphone/media playback are not claimed.

## Release hold

Latest read-only main comparison was conflict-free; main's newer file was
`prototype_redesign.html`, outside RIWI paths. Main moved independently during
the work. No checkout merge or cherry-pick was used. No production activation
is implied by QA receipts. Earlier branch migrations 0075–0077 and production
knowledge activation remain separate release steps requiring approval.
