# A6 — Probe triage: five probes that were failing, and what each failure actually was

Every probe named in A6 was run against the rebuilt environment (build `ehHMNFBGFy6JkXKHfJ-MQ`,
PostgreSQL with 53/53 migrations, seeded baseline). Each failure was diagnosed to a root cause
before anything was changed, and **no protected visual design was modified to satisfy an
assertion**. Where the probe encoded a fact that had legitimately changed, the probe now derives the
expectation from the file that defines it, so it cannot go stale the same way again.

| probe | before | after | classification |
| --- | --- | --- | --- |
| `verify-brand` | 29 pass / 4 fail | **33 / 0** | 4 stale assertions — fixed by deriving |
| `verify-theme` | 25 pass / 7 fail | **28 / 4** | 3 stale or imprecise — fixed; 4 remain, classified below |
| `verify-migration-tooling` | 19 / 24, exit 1 | **24 / 24**, exit 0 | stale constants — fixed by deriving |
| `verify-production-schema` | rejected a correct database | migration parity **passes** | stale constant — fixed by deriving |
| `verify-listening-revision-migration` | refused by the fixture guard | **10 / 10**, exit 0 | guard interaction — fixed narrowly |
| `verify-listening-mcq-probe-clean` | `relation "qa0052_probe" does not exist` | not run | ordering precondition — neither broken code nor an unapplied migration |

## Fixed: stale constants replaced with derived expectations

### `verify-production-schema.mjs` — the important one

This is the script that verifies a **production** schema, and it carried
`const EXPECTED_MIGRATIONS = 19` with a comment explaining that production was at 17 when the
Reading library landed. The chain has since grown to 53, so the verifier **rejected a correctly
migrated database**. That is the dangerous direction: the tempting repairs are both worse than the
bug, because bumping the number by hand leaves the next migration to break it again, while relaxing
the check would let a *partially* migrated production database pass as complete.

Both expectations are now derived from the repository's own two sources of truth — the migration
files on disk and `drizzle/meta/_journal.json` — and guarded against deriving nothing, since two
empty sources would agree and make an unmigrated database look complete. Measured against the real
QA database:

```
PASS  the chain on disk is complete and ordered   — 53 files, 53 journal entries
PASS  all 53 migrations are recorded as applied   — recorded 53 of 53 declared
PASS  an active OWNER account exists              — owners: 2, users: 9
FAIL  no demo/test fixtures in users              — demo-like rows: 7
```

That last FAIL is **correct behaviour and not a defect**: this is the production verifier and it was
pointed at the QA seed database, which intentionally contains seven demo-like accounts. The check
exists to prove a production database carries no seeded fixtures. The migration-parity half — the
part A6 asked about — passes.

### `verify-migration-tooling.mjs`

Two stale literals, both now derived:

- `afterApply.tables === 62`, with a comment calling 62 "the size of the release, not a magic
  constant". It *was* a constant, and 53 migrations now declare **119** tables. The expectation is
  computed by counting distinct `CREATE TABLE` names across `drizzle/*.sql` minus any `DROP TABLE` —
  the same files `migrate-production.mjs` applies — so a migration that declares a table the fresh
  apply does not produce is a real failure rather than a number to bump. The derivation refuses to
  return 0, which would otherwise make any empty database look correct.
- `resume 3/19 migrations are recorded` — the denominator is now `journal.entries.length`.

Result: **24/24, exit 0**, and the probe still deletes the three scratch databases it creates
(`learners_migtest_*`), verified by listing `pg_database` afterwards.

### `verify-listening-revision-migration.mjs` — narrow maintenance authorization

The probe connects to the `postgres` **maintenance** database to `CREATE`/`DROP` one scratch
database, and the global fixture guard refused it — correctly, since `postgres` is not a disposable
QA name and widening `ALLOWED_NAMES` would let every fixture-writing probe in the repository target
the maintenance database.

So the guard was left exactly as it is and the authorization was made narrow and explicit instead:
the maintenance connection must be local, must be the `postgres` database, and the scratch database
this probe actually mutates must satisfy the ordinary disposability rule. The scratch name was
changed from `learners_qa2_up0051` to `learners_qa0051` so it satisfies the **existing** pattern;
the migration number moved into a comment, because a new pattern for one probe's convenience would
have been a widening of the global guard. Result: **10/10, exit 0**, scratch database dropped
afterwards (`pg_database` lists only `learners_qa2`).

One incidental bug surfaced and was fixed: the module binds `const URL = ...` at top level, which
shadowed the global `URL` constructor, so `new URL(ADMIN)` threw `URL is not a constructor`.

### `verify-brand.mjs` — four stale assertions, no design change

Established first, by measurement, that the design is intact:

- All fifteen `public/brand/derived/` assets exist and **serve HTTP 200**, including the two the
  probe named. (An early `ls | head` had truncated the listing and made it look as though the
  asserted files were missing — the files were never the problem.)
- The approved marks in `src/lib/config/brand.ts` are `BRAND_MARK.day = mark-night-cutout-96.png`
  and `.night = owner-v11-night-96.png`. The probe asserted an older pair, `mark-light-96` /
  `mark-dark-96`. The artwork was revised; the probe was asserting the previous revision.
- `/app/dashboard` **is not a route in this repository**. The authenticated landing CTA really is
  `/app`, measured at `data-landing-cta-destination="/app"` with HTTP 200.
- The "second brand label above the headline" check scanned everything before `<h1>`, which
  necessarily includes the site **header's** approved `BrandBlock` — a block whose own documentation
  requires the product name to be real text rather than pixels. Measured: the brand block sits at
  byte 3422, `<main>` at 3543, `<h1>` at 6126, and the `<main>..<h1>` hero window contains neither
  a brand label nor an image. The duplicate the check was written to catch would be in the hero, so
  that is the window it now inspects.

The mark expectations are now read from `src/lib/config/brand.ts`, and the destination check asserts
both the value and that it resolves, so it is about reaching the app rather than about a literal path
that will go stale the next time the shell is reorganised. **33/33, exit 0.**

### `verify-theme.mjs` — three of seven fixed

**Fixed (stale value).** "night mode keeps the warm text and gold accent" compared the served CSS
against numbers typed into the probe. The approved night accent is no longer gold `230 185 79` but
indigo `99 102 241`, exactly as `src/app/globals.css` declares in its `[data-theme="night"]` block
(`--ink-900: 243 238 229` at line 60, `--accent: 99 102 241` at line 70). The expectation is now
parsed out of `globals.css`, which makes the check stronger as well as unstaleable: it proves the
stylesheet the **browser receives** carries the same night tokens the **source declares**, where a
hardcoded number could only ever prove that two copies of the same guess agreed.

**Fixed (predicate could not see the theming).** Two checks grepped each flagged file for a Tailwind
token utility — the right question for a file that renders its own surface, the wrong one for a file
that does not:

- `app/(shell)/loading.tsx` and `RouteEntryLoading.tsx` are **delegates**. They contain no markup and
  no `className` at all; they render `SectionEntryFrame`, which is themed with `bg-paper-raised`,
  `text-ink-300`, `text-ink-500` and `border-ink-100`. The predicate now follows delegation.
- `InteractionPrimitives.tsx` themes its `<dialog>` through `.interaction-confirm-dialog`, defined at
  `globals.css:1057` as `background: rgb(var(--paper-raised)); color: rgb(var(--ink-900))`. A
  utility-class grep cannot see a token consumed through a stylesheet rule, so the predicate now
  resolves the dialog's class names against `globals.css`.

Both stayed strict rather than becoming exemption lists: a delegate must carry no styling of its own
and must resolve to a component that really is token-themed, and a dialog class must resolve to a
rule whose background comes from a `--paper` token. Neither file was changed.

## Remaining four `verify-theme` failures — classified, not fixed

These are recorded rather than repaired, because repairing them means either changing protected
visual design or making a product decision that is not mine to make.

**1 and 2 — `the report control ships with the shell` / `the dashboard keeps its navigation on small
screens`: `OWNER_DECISION_REQUIRED`.** Both assert `data-report-toggle`. That attribute, and any
`ReportToggle` symbol, now appears **nowhere** in `src/components/shell/` or the dashboard page —
grep returns zero matches. A neighbouring check, "the report control is reachable from both
navigation surfaces", still passes, so something answering that description exists under a different
name or mechanism. Whether the control was deliberately removed, renamed, or lost is a product
question; guessing a new attribute name would make the check pass without establishing that the
learner-facing control is still there.

**3 — `no component hard-codes a colour`: probe precision, both offenders defensible.**

- `src/components/listening/AuthoredListeningFrame.tsx:14` builds a floating notes panel by injecting
  raw DOM into a document the theme does not control, setting `style.cssText` with `#4f46e5`,
  `#171a30` and `#0f1120`. Tailwind token utilities do not apply to a foreign document.
- `src/components/ui/StudyRichEditor.tsx:24` passes `#fff1a8` to `execCommand("hiliteColor")`. That
  colour is stored inside the learner's own authored content, not applied to a UI surface, so it must
  be a fixed value — a token would resolve at authoring time and then be wrong in the other theme.

The rule does not distinguish UI-surface colours, which must follow the theme, from content and
injected colours, which cannot. Narrowing it correctly needs an exemption that is itself evidenced
per site, and a blanket exemption pattern would let a genuinely unthemed surface through.

**4 — `nothing reaches for Tailwind's fixed default palette`: a real finding, deliberately not
changed.** `src/app/app/(shell)/writing/exam/[id]/page.tsx` uses `border-amber-300`, `bg-amber-50`
and `bg-amber-950`; `src/app/app/(shell)/writing/grade/[id]/page.tsx` uses `bg-amber-100` and
`bg-amber-900`. The presence of `amber-950`/`amber-900` variants shows Night Mode was handled by
hand rather than through tokens, so the surfaces probably do switch — but they sit outside the design
system, which means a theme revision will not reach them. Converting them to tokens **is a visual
design change**, and A6 forbids modifying the protected design to satisfy an assertion, so this is
reported to the owner as a design-system inconsistency with the exact sites named.

## `verify-listening-mcq-probe-clean.mjs` — ordering precondition

Reported `relation "qa0052_probe" does not exist`. That is **neither an unapplied migration nor
broken code**. All 53 migrations are applied, and the table is not part of the schema: it is a
scratch table that `scripts/qa2-listening-mcq-0052-upgrade.mjs` creates in `storeSnapshot()` (line
205) and drops in its `clean` mode (line 295). This probe reads it at module scope on line 21,
before doing anything, and its own header states the precondition: *"First run the 0052 probe's
fresh/apply/verify."*

It was not run here because satisfying the precondition is destructive to the shared environment:
`fresh` mode executes `drop database if exists learners_qa2` and `create database learners_qa2`
(lines 97–98), which would destroy the seeded baseline every other package in this session measures
against. It belongs in a dedicated window followed by a re-seed, and running it mid-session to clear
one line of a triage list would have cost more than it proved.
