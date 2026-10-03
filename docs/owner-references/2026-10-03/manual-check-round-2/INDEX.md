# Owner manual QA round 2 — staging ledger (2026-10-03)

Status: requirements captured; implementation is intentionally deferred to GPT Work mode after the owner requests the final continuation prompt.

## Exact owner-supplied assets (current conversation)

These are the authoritative assets for the next implementation pass. They must be uploaded to the repo by Work mode without visual alteration unless the owner explicitly requests an edit.

1. `Learners_Area_2K_Clean_Background_v16_FINAL.mp4`
   - 2560x1440
   - ~10 seconds
   - Desktop/laptop pre-login home experience only.
   - Replace the current desktop landing experience.
   - Remove the current “Let’s get started” requirement.
   - At video end:
     - authenticated existing session -> Dashboard
     - otherwise -> Login
   - Mobile/tablet keeps the current non-video welcome flow.

2. `Learners_Area_V11_Exact_Cutout_Logo.png`
   - exact owner-approved logo
   - replace ALL Learners Area logos used in Night Mode, including:
     - main app top-left logo
     - pre-login/welcome logo visible on mobile/tablet
   - do not recolor/recreate/substitute it.

3. `Screenshot 2026-10-03 at 12.32.30.png`
   - authoritative visual reference for Speaking -> Practice on your own
   - Part 1 Interview
   - Part 2 Cue card
   - Part 3 Discussion
   - must be preserved as owner visual evidence.

## Current owner-observed defects / requirements

### Upload architecture / Control mode

- Learning/Study mode must NOT expose material-upload controls.
- Material upload belongs only to Management / Control.
- This applies to Reading, Listening, Writing and Speaking.
- Reading currently still asks for JSON-only in the observed UI. That is not the target.
- Legitimate learning-material upload architecture must support the relevant validated formats, including where appropriate:
  - ZIP
  - HTML
  - PDF
  - DOCX
  - TXT
  - MP3/audio
  - MP4/video
  - plus existing structured formats where genuinely required.
- ZIP ingestion must not depend on one screenshot-specific or filename-specific package shape.
- Reading / Writing / Listening / Speaking ZIP packages may contain different legitimate content, but package validation must be architecture-based and safe.
- Uploaded HTML must never be blindly executed.
- Binary/media/document formats must be validated by stored bytes, MIME/signature and feature-specific policy.

### Listening

Owner still observes:
- upload control in learning/study-side UI;
- uploaded ZIP not being accepted.

Next pass must reproduce the actual Preview failure and trace:
browser -> intent -> storage -> finalize -> parser -> canonical data -> QA/publication.

### Writing

Owner currently sees on all or almost all Writing tools except Grade My Work:

> This Writing tool is not available on this server yet. Ask staff to apply the latest database update.

This is a critical manual-acceptance blocker.

Known pending migrations must be handled honestly and safely; do not fake availability.
Work mode must determine whether the owner should apply the pending Preview migrations or whether any route has an avoidable migration/readiness defect.

### TED / Podcast

Owner reports the expected Booster-style learning exercises are still absent.

Use Booster only as a reference for information architecture/interactions, not branding or copied course content.

Public Booster 8 product page currently describes TED Lessons as:
- 20 TED talks
- questions
- vocabulary

and the platform also uses learning activities such as transcript/notes/opinion/summary in the current Learners Area requirements.

Before implementation, Work mode must inspect the available Booster reference code/materials and create a dedicated visual-reference PDF:
- one screenshot/reference image per page
- truthful provenance
- stored under `docs/owner-references/`
- no Booster branding presented as Learners Area-owned content.

### Grammar

Owner reports Grammar is effectively empty.

Before rebuilding it, Work mode must re-inspect the available Booster reference code/materials relevant to the requested Grammar/Reading-style learning architecture and create a dedicated visual-reference PDF for implementation guidance.

Do not claim visual reference completion without actual rendered images.

### Site freeze / hanging

Owner observes that the site sometimes becomes stuck inside a module.

This must be treated as a real runtime defect:
- reproduce if possible;
- inspect navigation transitions, suspense/loading boundaries, pending requests, client state, route cache, failed fetches and interaction locks;
- no permanent spinner;
- no button left disabled after rejected requests;
- no navigation state trapped after a failed API call.

## Reference-only external research anchor

The public IELTS Booster 8 page at:
https://ieltsbooster.uz/info8/

describes these relevant platform structures:
- Listening: Essential Recordings, Academic Listening, General Listening, Question Types, MCQ Mastery, TED Lessons
- Reading: Essential Videos, Academic Lab, General Reading, Question Types, Vocabulary Drill
- Writing: Lessons, Real Exam, evaluation, Translation, Typing, Topic Vocabulary, Activation Lab, Language Stealing
- Speaking: IELTS Speaking Part 1/2/3, AI examiner, Top 15 structures, General Speaking/Shadowing, vocabulary activation

This public page is reference evidence only. Do not copy proprietary course content or branding.

## Next execution rule

Arena is no longer the execution environment for this remaining work.

After the owner finishes collecting defects and explicitly asks for the final master prompt:
- prepare ONE consolidated continuation prompt;
- execution will be performed in GPT Work mode;
- continue from the current integration branch;
- do not restart the application;
- preserve accepted architecture and tests;
- manual owner observations outrank earlier “PASS” claims.

## Pending reference-artifact work for Work mode

The following must be completed before implementation proceeds:
- upload the exact MP4 asset above to the repo or approved app asset storage;
- upload the exact PNG logo above;
- upload the exact Speaking screenshot above;
- create the TED/Podcast visual-reference PDF from actual reference visuals;
- create the Grammar visual-reference PDF from actual reference visuals;
- commit/push those references to the integration branch;
- only then use them as implementation requirements.


## Integrity hashes for the three owner-supplied assets

Work mode MUST verify these exact hashes before using or committing the assets:

- Learners_Area_2K_Clean_Background_v16_FINAL.mp4
  - SHA-256: `40c29b7c3396aac7315cba03f5b1bf9f9160fb12d3b1493fb26cd47c636d5afd`
  - H.264, 2560x1440, 30 fps, AAC audio, exactly ~10.0 s, 15,156,358 bytes.

- Learners_Area_V11_Exact_Cutout_Logo.png
  - SHA-256: `64a4308f15e36acd30e4dc96e8065e80f93678c3824539d6d6ec872f5c769a28`
  - 746x560 RGBA PNG, 523,282 bytes.

- Screenshot 2026-10-03 at 12.32.30.png
  - SHA-256: `cd9cda33ff2157045a25b3485b731f54dd604cbffc31c06c473d596d80c085e1`
  - 2048x471 RGBA PNG, 1,285,884 bytes.

The original binaries are user uploads in the current ChatGPT conversation. Do not substitute derivatives when the exact source file is required.

## Public Booster visual-reference anchors already verified

The following public Booster 8 platform screenshots are suitable as truthful implementation-reference anchors. Work mode should capture/download these exact public images and place each screenshot on its own PDF page with provenance.

### TED / Podcast reference
- Public module page: https://ieltsbooster.uz/info8/
- TED Lessons screenshot: https://ieltsbooster.uz/info8/assets/images/platform/ted.jpg
- Public description states TED Lessons contains 20 TED talks with questions and vocabulary.

Do not invent additional Booster TED screens that are not actually available. If deeper exercise screens cannot be found in the public site or owner-supplied reference archive, mark them as unavailable rather than fabricating them.

### Reading / Grammar-oriented reference
- Reading Academic Lab: https://ieltsbooster.uz/info8/assets/images/platform/reading-ac.jpg
- General Reading missions: https://ieltsbooster.uz/info8/assets/images/platform/reading-gen.jpg
- Reading Question Types: https://ieltsbooster.uz/info8/assets/images/platform/reading-qt.jpg
- Essential Videos/Reading lesson UI: https://ieltsbooster.uz/info8/assets/images/platform/reading-rec.jpg
- Speaking Top 15 Structures (grammar-card interaction reference): https://ieltsbooster.uz/info8/assets/images/platform/speaking-struct.jpg

The public Booster page confirms that separate Grammar - Writing and Grammar - Speaking modules exist, but it does not expose a dedicated public Grammar screenshot. Therefore the future Grammar reference PDF must distinguish:
1. real public screenshots;
2. code-derived structural observations;
3. any missing visual evidence.

Never label inferred or reconstructed UI as a real Booster screenshot.

## Required dedicated PDFs before implementation

Work mode must create and commit, at minimum:

1. `docs/owner-references/2026-10-03/manual-check-round-2/BOOSTER_TED_PODCAST_REFERENCE.pdf`
   - one real screenshot per page where available;
   - source URL/provenance on every page;
   - TED library screenshot mandatory;
   - exercise architecture notes may be included separately, but must not be represented as screenshots unless actual screenshots exist.

2. `docs/owner-references/2026-10-03/manual-check-round-2/BOOSTER_GRAMMAR_READING_REFERENCE.pdf`
   - Reading Academic Lab;
   - General Reading missions;
   - Reading Question Types;
   - Essential Videos;
   - Top 15 Structures as grammar-interaction reference;
   - explicit note that a dedicated public Grammar screenshot was not found if that remains true.

3. `docs/owner-references/2026-10-03/manual-check-round-2/SPEAKING_PRACTICE_ON_YOUR_OWN_REFERENCE.pdf`
   - exact owner-uploaded 2048x471 screenshot;
   - no crop that changes the visible three-card layout;
   - Part 1 Interview / Part 2 Cue card / Part 3 Discussion clearly preserved.

These are reference artifacts only. They do not authorize copying Booster branding or copyrighted course content into the Learners Area product.
