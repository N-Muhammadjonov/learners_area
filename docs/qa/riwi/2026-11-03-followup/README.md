# RIWI follow-up acceptance — 2026-11-03

Tested application: `d3ef66d6144d4a287c844dedd079d22ef550dae9` on
`arena/learners-area-next`. This supersedes the older notice/composer placement
descriptions. PR #114 remains draft. Main and production were not changed.

## Completed in sequence

1. Restored the exact unknown-answer introduction and requested clarification.
2. Removed the Enter/Shift+Enter hint. The permanent accuracy line now sits at
   the bottom of the conversation area, outside both scrolling messages and
   composer. Final QA caught and fixed its disappearance while reading history.
3. Removed blanket decorative green borders across the site and unnecessary
   frames around chat/settings/input. Focus and semantic state styling remains.
4. Site search uses Mac Cmd+F / Windows Ctrl+F; Ctrl+K labels/handler removed.
   Win+F opens Windows Feedback Hub, so it is not the Windows search shortcut.
   References: [Apple Safari](https://support.apple.com/en-lamr/guide/safari/cpsh003/mac)
   and [Microsoft Windows](https://support.microsoft.com/en-gb/accessibility/windows/keyboard-shortcuts-in-windows).
5. Added bounded file reading, OCR, document export and exact text replacement.
   The original supplied file is never overwritten; edits download a copy.
6. Added a bilingual role-scoped site guide, all 125 code-derived route patterns,
   observed control location/colour/link and Owner-only registered-handler help.
7. Completed integrated checks and authenticated Safari Owner Preview QA.

## Verification

| Check | Result |
| --- | --- |
| RIWI backend | 2,647 passed |
| Core contracts/SEO/Python build/assets | 37 passed |
| Frontend | 1,292 passed, 0 failed, 11 existing fixture skips |
| Native Python-only build | 724 files, 125 routes |
| Local/remote application head | equal at tested application commit |
| Main comparison | conflict-free computational merge tree; no branch merge |

The 11 skips are existing legacy Listening fixture skips. No new tests were
silently skipped. Source hashes and raw-log hashes are in `acceptance.json`.

Safari used the existing Owner session on the stable Preview host. `/api/version`
matched each tested commit; Owner diagnostics confirmed external AI was off.
Live file cases covered image OCR, scanned/text PDF, DOCX exact replacement,
inert HTML, and new PDF/DOCX/TXT. Actual browser downloads were re-opened and
their text/table content checked. An initial PDF 500 exposed a deployment-only
missing root dependency; both requirement lists now pin PDFium identically and
the live PDF replacement download was rechecked successfully.

Fresh site questions covered Main's actual colour/location/link, architecture,
the New Chat handler and a previously visited Reading link. The guide uses
authenticated roles, not browser claims. Other-role boundaries have automated
actor/contract tests; no separate teacher/admin/student Safari sign-in is claimed.

Unknown wording was exact. The grammar answer contained all three examples and
Uzbek explanations without source-brand controls. Reply-language selection sent
no chat turn, retained old Uzbek answers and made the next response English.
The final English guide reply also verifies removal of an unsolicited visual
clarification. These are finite rule-library checks, not human examiner scoring
or proof of general semantic understanding.

Final footer QA used long history with `scrollTop=0`. In Safari's configured
390×844 / 1440×900 responsive view, measured settled samples were 389×843
(day/night) and 1439×900 (night), reflecting scaled-emulation rounding. They show
no horizontal overflow, visible composer/input, zero chat/input borders, and a
visible accuracy line above the composer and outside the scroller. Temporary
sticky-CSS experiments in the older `ada2f5f3` receipt are explicitly not final
acceptance; the final `d3ef66d6` receipt comes from the shipped footer structure.
The Owner session was left in ordinary Safari, night mode, UZ, with a new chat.

## Limits and release hold

- Images use text OCR; general photo-scene reasoning is not implemented.
- Exact PDF edits support bounded horizontal text objects and available fonts;
  unsupported layouts offer a separate new text copy. DOCX preserves original
  structure for supported exact replacements. Arbitrary full-document rewriting
  or fluent unrestricted translation is not claimed.
- Mounted drag/drop and the actual native file picker were tested. A physical
  native drag gesture was not performed. Safari responsive proof does not cover
  a physical iPhone keyboard, microphone or media playback.
- A finite site guide clarifies unknown/future controls rather than inventing
  their behaviour. Browser observations are session-only untrusted data and
  do not grant authority. File text is not automatically published as knowledge.
- No new schema migration was introduced in this follow-up. Existing branch
  schema/production knowledge activation steps remain separate release work.
  No production migration, knowledge activation, deploy or main merge occurred.
- A 30-minute error/fatal runtime-log query for `/api/riwi` on the final app
  deployment returned no matching logs; that is not an application-wide certificate.

Raw receipts contain synthetic QA content and no credentials, cookies, source
binaries or private learner IDs. Large logs and rendered document fixtures remain
in the Owner workspace at `evidence/20261103/followup`. Functional scope and
catalogue refresh instructions are in `docs/riwi-files-and-site-help.md`.

Main merge still requires the Owner's explicit permission.
