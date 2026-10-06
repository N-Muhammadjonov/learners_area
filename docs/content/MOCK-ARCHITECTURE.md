# Mock Architecture

Status: **implemented**. Executable source of truth:
[`src/lib/content/mocks.ts`](../../src/lib/content/mocks.ts) (composition,
validation, navigation, timing, result assembly),
[`src/lib/content/score-policy.ts`](../../src/lib/content/score-policy.ts) (score
policies and their versions), `mock_tests` / `mock_sections` / `mock_attempts` in
[`src/db/schema.ts`](../../src/db/schema.ts).

---

## 1. A mock is an orchestration object, not a folder of content

A mock owns **no content**. It is a first-class row that references canonical
content by identity and, for anything assessment-grade, by pinned revision. Deleting
a mock never deletes a passage; editing a passage never changes a mock that pinned
its revision.

```
mock_tests            identity, kind, track, timing policy, navigation, score policies, publication
   └─ mock_sections   one row per section: module + content type + source ref + pinned version
mock_attempts         one learner's run: snapshot, version, bindings, per-section results
```

A run is scored from its own frozen snapshot and bindings, so a mock that is later
edited does not change a score that was already given.

## 2. Kinds and tracks

| kind | meaning | navigation default |
| --- | --- | --- |
| `full` | a complete formal mock (Listening + Reading + Writing; Speaking recorded separately) | formal |
| `sectional` | one skill, exam conditions | practice |
| `diagnostic` | a full mock used to place a learner | formal |
| `custom` | staff-composed practice of any shape | practice |

Tracks are `academic` and `general_training` (plus `unspecified` for material that
belongs to neither). A General Training mock and an Academic mock can therefore be
composed from the same machinery without either polluting the other, and an Academic
mock can never contain General Training material (§3: IELTS rules live in the
composition rules, not in shared infrastructure).

## 3. Composition rules (§63)

`validateMockComposition` refuses, with a named issue for each:

1. a section whose content type is unknown for its module;
2. a section whose `skill` and `module` disagree;
3. a formal composition that does not pin an exact content version;
4. a full mock that is not Listening + Reading + Writing in that order, or that
   includes a skill twice;
5. mixed tracks (Academic material in a General Training mock, or the reverse);
6. a full mock whose Listening and Reading sections do not add up to the formal
   question count (40 and 40);
7. an unknown timing policy, or a section the policy cannot assign a duration to.

The composer and the API call the same function, so a mock that could not be
published cannot be created through a route that forgot one of the rules.

## 4. Navigation policy

Navigation is **data on the mock**, never a behaviour that falls out of which
component rendered it:

```
canReturnToPreviousSection, canPause, canResume, autoSubmitOnExpiry,
breakAllowed, reviewBeforeSubmit, sectionLocks
```

`FORMAL_NAVIGATION` is the exam default (no going back once a section closes, no
pausing, auto-submit on expiry). `PRACTICE_NAVIGATION` relaxes them. A formal mock
that allows pausing, or that does not auto-submit, is refused
(`formal_cannot_pause`, `formal_requires_autosubmit`), as is a policy that both
locks finished sections and allows returning to them
(`contradictory_navigation`).

## 5. Timing is server-authoritative (§13/§14)

`composeTimingPlan` turns the mock's timing policy plus its sections into an ordered
plan: which section is open, when it opens, when it closes. `sectionStateAt(plan,
elapsedSeconds)` answers "which section is the learner in, and how long is left"
from the server's own clock and the attempt's `started_at`. The browser's timer is a
display of that answer, never the source of it: a learner who closes the tab, edits
the clock or reloads gets the same remaining time, and the section closes when the
server says so. Durations come from `MOCK_TIMING_POLICIES` (`mock_timing_policy`
columns on the mock carry the policy id *and* its version, so changing a policy
never silently retimes an existing mock).

## 6. Version binding and the publication gate

* `freezeBindings(sections)` records the exact revision of every section at
  composition time; `versionIdentityProblems` refuses a mock whose section does not
  pin a revision while its kind requires one.
* `mockPublicationGate(mockId)` answers whether a mock may be published, with the
  reasons it may not — an unpublished revision, an unresolvable binding, a section
  that no longer exists.
* `loadMockComposition` reads a mock back as its sections and versions, which is how
  the exam runner, the staff preview and the result view all see the same object.
* `saveMockComposition` writes the mock and its sections in one transaction, so a
  half-composed mock is never visible.

## 7. Scoring (§15/§16)

* `scorePolicyRefFor(skill, track)` resolves the policy **and its version**
  (`SCORE_POLICY_VERSIONS`); the attempt stores `score_policy_version`, so a result is
  reproducible with the policy that produced it.
* Reading uses different policies for Academic and General Training — the same raw
  score legitimately maps to different bands, and the policy id says which was used.
* Per-section scores are stored individually (`section_results`) and never collapsed
  to a single number: the learner sees the Listening raw score and band, the Reading
  raw score and band, and Writing/Speaking bands as their own judgments.
  `assembleMockResult` adds the overall band from those parts
  (`overallMockBand`, half-band rounded) without hiding them.
* No fabricated bands: a section with no evidence (an unattempted Speaking part, an
  ungraded Writing task) contributes `null`, and the overall band is `null` until
  every required part exists.

## 8. Compatibility with the legacy mock runtime

The pre-CP7 mock tables and screens remain readable (`COMPATIBILITY ONLY` in
[`LEGACY-MIGRATION.md`](LEGACY-MIGRATION.md)) — historical attempts and stored
snapshots must keep rendering. New mocks are composed through this architecture; a
legacy mock is *not* re-created as a new mock by an automated job, because its
bindings cannot be invented (§95).
