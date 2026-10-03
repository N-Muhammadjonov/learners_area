# Reference PDF visual audit — 60/60 (2026-10-03)

Method: every page was rendered to PNG with PyMuPDF (a scratch tool outside the repo, not a dependency) and viewed as an image. Text-layer extraction was not used as evidence.

Files: `docs/owner-references/booster-ui-reference/` — Listening 19, Reading 22, Writing 19.

Common to every page:
- Layout: left module sidebar, top search/language bar, page title with a section-tab strip, a card grid, and a right-hand context column on wider pages.
- RIWI keeps the same interaction hierarchy (hub → workspace → step → result) with its own brand (Geist Sans/Sora).
- Not reproduced, by rule: the reference brand, the demo learner name, demo statistics and 'Coming soon' tiles.
- Pixel parity is NOT claimed: browser screenshots are BLOCKED (the sandbox cannot download a browser).

| Page | Reference intent | RIWI mapping | Status | Note / discrepancy |
|---|---|---|---|---|
| L01 | Listening hub: 5 workspaces as cards | /listening hub sections | PASS | Same 5-area IA; RIWI brand; no demo counters |
| L02 | Essential Recordings: list + player + notes + practice | /listening recordings + video/notes | PASS | Player is the authorized media player; notes saved server-side |
| L03 | Academic library 30-test grid | /listening academic list | PASS (divergence) | Only published tests listed; 'Coming soon' tiles not reproduced (forbidden) |
| L04 | Test hub: 5-step bundle | attempt -> review -> keyword -> speed -> vocab | PASS | Steps are real routes; progress from server |
| L05 | Exam mode: no seek, answer sheet | ListeningExam exam mode | PASS | No-seek enforced; result after audio end |
| L06 | Revision: per-question evidence + speeds | /listening/attempts/[id]/revision | PASS | Speed controls are real playbackRate |
| L07 | Keyword table | keyword step | PASS | Learner matches checked server-side |
| L08 | Speed ladder 1x..2x | SpeedTrainer | PASS | Unlock rule server-checked |
| L09 | 15-word vocabulary drill | vocab step -> shared vocabulary | PASS | Uses shared lexeme IDs (no fork) |
| L10 | General Listening 30-day grid | general listening list | PASS (divergence) | No 'Coming soon'; only real days |
| L11 | Day hub: 4 missions | day missions | PASS | Mission progress from server |
| L12 | Mission 1 full test | part-based test | PASS | Parts tab + check |
| L13 | ScriptGame dictation | dictation mission | PASS | Word-diff grading server-side |
| L14 | True/False sprint | sprint mission | PASS | Verdict shown after answer |
| L15 | Today's ten words | vocab mission | PASS | Shared vocabulary |
| L16 | MCQ Mastery library | MCQ mastery list | PASS (divergence) | No 'Coming soon' |
| L17 | MCQ set hub: commit first | MCQ set | PASS | Own answer required before options |
| L18 | Evidence-first MCQ flow | MCQ active flow | PASS | Proofs stored per question |
| L19 | Question-type lessons + drills | question types | PASS | Content-dependent counts |
| R01 | Reading hub: 5 workspaces | /reading hub | PASS | Same IA |
| R02 | Essential videos + notes | video lessons | PASS | Notes persisted |
| R03 | Academic Lab passage library | /reading academic | PASS | Real passages only |
| R04 | Passage hub: 4 steps | passage steps | PASS | Ordered steps |
| R05 | Real exam split screen + highlight | ReadingExam | PASS | Timer server-authoritative |
| R06 | Analysis with evidence | attempt analysis | PASS | Evidence highlights |
| R07 | 20-word vocab drill | vocab drill | PASS | Shared vocab |
| R08 | Teacher vocabulary chat | vocab session | EXTERNALLY UNVERIFIED | AI-dependent; no fake chat without provider |
| R09 | General Reading 30 challenges | general reading list | PASS (divergence) | No 'Coming soon' |
| R10 | Challenge hub: 5 missions | challenge missions | PASS | Real routes |
| R11 | Article reading + tappable words | ClickableText | PASS | Word popover with lexeme IDs |
| R12 | IELTS test of same text | challenge test | PASS | Check answers |
| R13 | Key word table | paraphrase table | PASS | Content-dependent |
| R14 | 25 target words | word list + flashcards | PASS | Shared vocab |
| R15 | Meaning checker | meaning check | EXTERNALLY UNVERIFIED | AI-dependent scoring |
| R16 | Question type library (14) | question types | PASS | Mastery from server |
| R17 | Question type lesson | lesson view | PASS | Real lesson content |
| R18 | Question type drill | drill | PASS | Immediate explanation |
| R19 | Retention level selection | /reading/retention | PASS | Bank cap fixed (cfa28b9) |
| R20 | Timed one-pass reading | RetentionSession read | PASS | Server timer |
| R21 | Recall writing | RetentionSession recall | PASS | Server evaluator |
| R22 | Memory result | retention result | PASS | Deterministic evaluator; no fake stats |
| W01 | Writing hub: 8 workspaces | /writing (8 tabs) | PASS | Owner requires all 8 (reference trims to 4) |
| W02 | Task 1 lessons workspace | Lessons T1 | PASS | Video + materials + notes |
| W03 | Task 2 lessons workspace | Lessons T2 | PASS |  |
| W04 | Real exam home T1/T2/Full | exam home | PASS | Timer starts after confirm |
| W05 | Task 1 in progress | exam T1 | PASS | Server timer |
| W06 | Task 2 in progress | exam T2 | PASS |  |
| W07 | Full paper | full paper | PASS | Overall from criteria server-side |
| W08 | Translation setup | translation setup | PASS |  |
| W09 | Sentence-by-sentence translation | translation exercise | EXTERNALLY UNVERIFIED | Checking needs external AI |
| W10 | Translation assessment | translation result | EXTERNALLY UNVERIFIED | AI-dependent |
| W11 | Typing trainer | TypingTrainer | PASS (needs 0034) | Duration presets wait for migration 0034 |
| W12 | Typing result | typing result | PASS | Server-authoritative timing |
| W13 | Topic vocabulary 60 topics | topic vocabulary | OWNER ACTION REQUIRED | Content-dependent (topics must be authored); architecture complete, 2/60 packs exist; contract: docs/TOPIC-VOCABULARY-CONTENT-CONTRACT.md |
| W14 | Grade my work submission | Grade tab | PASS | Saves essay without AI; no band |
| W15 | Examiner comment: 4 criteria + overall | grade result | EXTERNALLY UNVERIFIED | Strict external provider; server-derived overall |
| W16 | Sentence corrections | grade corrections | EXTERNALLY UNVERIFIED | AI-dependent |
| W17 | My essays history | grade history | PASS |  |
| W18 | Activation Lab | activation | PASS (needs 0032) | Persistence waits for 0032; AI feedback EXTERNALLY UNVERIFIED |
| W19 | Language Stealing 7 steps | stealing | PASS (needs 0033) | Waits for migration 0033 |

Totals: EXTERNALLY UNVERIFIED 6, OWNER ACTION REQUIRED 1, PASS 53 (out of 60).
'PASS' here means the IA, controls and flow are implemented in code; it is not a visual browser PASS.
