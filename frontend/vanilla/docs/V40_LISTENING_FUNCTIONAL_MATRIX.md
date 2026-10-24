# V40 Listening functional matrix (Hub and Activity)

Columns: source applicability (original `src/` behavior), native implementation, browser evidence (V39 = `tests/browser-listening-v39.mjs`, 78/0; V40 = `tests/browser-listening-v40.mjs`, 47/0), status.

Status vocabulary: PASS (browser evidence), PASS-PARITY (source and native identical, no browser case needed), NOT RUN (applicable, no evidence), N/A (not applicable to this route).

## Route feature applicability

| Feature | Hub | Activity | Native code | Evidence | Status |
|---|---|---|---|---|---|
| Hub render, cards, badges, draft notice | Yes | N/A | yes | V39 | PASS |
| Hub locked / 404 / 500 / network / 429 / 403 / 401 | Yes | Partly | yes | V39 | PASS |
| Hub authored frame (`allow-scripts` only) | Yes | Redirect only | yes | V39 sandbox case | PASS (sandbox); media NOT RUN |
| Hub authored-frame media lifecycle | Yes | N/A | yes | none | NOT RUN |
| Activity segment validation (0, 6, malformed, `02`) | N/A | Yes | yes | V39 | PASS |
| Activity 1 Exam Start, Start once, failure, retry | N/A | Yes | yes | V39 + V40 (403) | PASS |
| Activity 2 question buttons, Mark reviewed (local) | N/A | Yes | yes | V40 | PASS |
| Activity 2 speed control (allowed rates) | N/A | Yes | yes | V40 | PASS |
| Activity 2 typed answers, Check (`complete:true`) | N/A | Yes | yes | V40 | PASS (after repair) |
| Activity 2 Complete (server score, no client grade) | N/A | Yes | yes | V39 + V40 (409) + V39 (429) | PASS |
| Activity 2 typed answers on first attempt | N/A | Yes (`ListeningSpeedPractice`) | identical to source | V40 | PASS-PARITY + PASS |
| Activity 3 gap typed answer, Save progress | N/A | Yes | yes | V39 + V40 (403) | PASS |
| Activity 3 lexical (word popover) | N/A | Yes, `lexical` gated | yes | V40 (lexical off/on) | PASS |
| Activity 4 Commit and reveal, Save | N/A | Yes | yes | V39 + V40 (404) | PASS |
| Activity 5 vocabulary save and folders | N/A | Yes | yes | V39 | PASS |
| Activity 5 quiz Check all (graded Complete) | N/A | Yes | yes | V39 | PASS |
| Activity 5 Say it (speech, cancel then speak, en-GB) | N/A | Yes | yes | V40 | PASS (JS mock) |
| Lexical: spelling-only (no occurrence, no request) | N/A | Yes | yes | V40 | PASS |
| Lexical: occurrence lookup (`occurrenceId`) | N/A | Yes | yes | V40 | PASS |
| Lexical: refusal 403 | N/A | Yes | yes | V40 | PASS |
| Lexical: keyboard (Tab, End, Enter, Escape, focus return) | N/A | Yes | yes | V40 | PASS |
| Lexical: touch 390 | N/A | Yes | yes | V40 | PASS |
| Lexical: disposal and stale response after navigation | N/A | Yes | yes | V40 | PASS |
| Lexical: pronounce (en-GB) | N/A | Yes | yes | V40 | PASS |
| Lexical policy (lexical off, plain text) | N/A | Yes | yes | V40 | PASS |
| Practice Matching (Check, verdict, key) | N/A | Practice route | yes | V39 | PASS |
| Practice Finish gate, Previous/Next prediction reset | N/A | Practice route | yes | V39 | PASS |
| Practice completion (text answer), retry, map | N/A | Practice route | yes | V39 | PASS (desktop) |
| Practice at 768 and 390 | N/A | Practice route | yes | none | NOT RUN |
| Media clip play, end boundary, rate | N/A | Yes (2-4) | yes | V40 | PASS |
| Media route exit pause and detach | N/A | Yes | yes | V40 | PASS |
| Media recording error, retry load (native addition) | N/A | Yes | yes | V40 (discriminated) | PASS |
| Viewports 1440x900 / 768x1024 / 390x844 for branches 1-5 | Partly | Layout only | yes | V40 responsive 20/20 | PASS (layout); interaction NOT RUN at 768 / 390 |
| EN and UZ | Yes | Yes | yes | V39 + V40 | PASS (partial, see branches) |
| Day and Night | Yes | Yes | yes | V39 + V40 | PASS (partial) |
| Direct entry, reload | Yes | Yes | yes | V39 | PASS |
| Back and Forward | Yes | Hub to activity only | yes | V39 | PASS (partial) |
| Keyboard Enter/Space on primary controls | Yes | Yes | yes | V39 (Activity 4) + V40 (Say it) | PASS (partial) |
| Attempt identity or source replacement mid-write | N/A | Yes | yes | V39 (source switch) | PARTIAL |
| Other-user attempt data never shown | N/A | Yes | yes | none | NOT RUN |

## Source-by-feature applicability: notes

- Original Activity 2 mounts `ListeningSpeedPractice` when `data.questions` exists (`FullListeningActivity.tsx` line 369). Its rate control is a `<select>` with options outside `allowed` disabled. Its Check posts `{activity:2, speedRate, answers, complete:true}`.
- Original Activity 3/4 keyword blocks carry typed inputs (lines 393-455). Original Activity 2 first attempt has the typed inputs above, not in the keyword blocks.
- Original Say it is `speechSynthesis.cancel()` then `speak()` with `lang en-GB` (around lines 508-520). Native matches.
- Original clip: `currentTime` set then `play()`, `timeupdate >= end` pauses, play rejection shows `momentUnavailable`, `onError` shows `recordingUnavailable`. Native matches, plus a native addition (`load()` before retry when `audio.error` is set), now tested.
- Original `← Test hub` inner link is untranslated in every locale. Preserved.

## Test counts

- V40 suite: 47 cases, 47 PASS, 0 FAIL. Final log `docs/evidence/v40/logs/run-07-FINAL-v40-47of47.txt`.
- V39 suite (re-run in V40): 78 PASS, 0 FAIL. `docs/evidence/v40/logs/regress-v39-78of78.txt`.
- Unit `npm test`: 605 PASS, 0 FAIL.
- `browser-v8`: 79 PASS, 0 FAIL (equal to baseline).
