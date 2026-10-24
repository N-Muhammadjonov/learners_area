# V9 contracts — source-owned General sections and classified media

This extends ADAPTER_CONTRACTS_V8 and V7; it replaces no deployed backend. `/api/frontend/{public,session,view}` remain **proposed**, disconnected preview returns503. No browser SQL/credentials/identity/grade or new production endpoints. All GET projections must enforce original HttpOnly session, active status, current permissions, publication/sequence and ownership on EVERY load; no client-provided user/role is authority. No staff adapter modifications.

## General catalogue

`GET /api/frontend/view?route=<exact pathname+query>`: `{version:1,route,data:{cards,total,hasMore}}`. Source: GeneralCatalogueRegion, generalListeningCards in `src/lib/data/listening-general.ts` (source classification/publication/own facts, not an alternate SQL expression). Card: UUID testId, title, questionCount>=0, sectionNo1–4|null, durationSec>=0|null, started/completed booleans, lastScore/lastTotal nonnegative integers|null. No answers, audio or transcript in catalogue; no eager media requests. Client preserves bounded original `page`, query/hash, next/previous links, shell and scroll. Published section membership and visibility are server decisions, never inferred from title or client role.

## One section loader, two entry addresses

Both `/app/listening/general/:sectionId` and `/app/listening/attempts/:attemptId` must call the original **loadSectionExercise** (`src/lib/listening/section-exercise.ts`), including its original product classification, section membership, own-attempt and publication gates. Section GET creates/resumes an own attempt idempotently as the original does, **not by a browser extra create POST**. Do not route every attempt into General: retain existing exam/legacy/review discriminants for non-section sources.

Envelope data `{kind:'section',section:<view>}`. Client validates URL testId or attemptId exactly, then discriminates:
- `kind:'exercise'`, UUID attemptId/testId, title, explicit boolean lexicalAssistance, same original examDTO question/control/map/image/duration/initial/audioPosition/audioStartedAt fields. Audio/image only authorized `/api/resources/...`. Never project correctAnswer/key/evidence/alternatives before release; unknown answer question identities are rejected. Lexical permission comes from original lexicalAssistanceAllowed/product mode, not a browser flag. The graded exam imports NO dictionary controller; section wrapper composes it only when server permits.
- `kind:'result'`, same identities/title, nullable server score/total, original authorized analysis questions/answers. Only the learner's own submitted result. Null grading and unanswered are different verdicts; no fabricated zero. No Academic revision link/transcript. Correct answer/explanation release must obey original server gating.

Notes/draft/highlights use original `la-listening-{draft,notes,highlights}:<attemptId>` keys, not session storage/identity authority. Question/text-key/range membership is validated; malformed/foreign highlights ignored. None of notes/highlights is submitted to the server. Existing draft PUT sends `{answers,audioPosition,startAudio}`; existing submit POST sends `{answers:[{questionId,answer}]}`. Server owns UUID membership, answer length, no late/foreign writes, grading and transitions. On success only own local keys clear and client navigates canonical section URL;409 reprojects. Abort/stale responses cannot mutate next route.

`POST /api/listening/attempts` `{testId}` is the EXISTING StartTestButton/SectionRetakeButton API. No user/attempt/status/grade fields. Server calls getStartableTest + listeningSequenceAccess + startListeningAttempt; returns `{id:<own UUID>}`. Retake refreshes same section route only after a valid ACK; start navigates own returned attempt. No mutation retry, double-create or invented client attempt id. 401 session handler,403 forbidden/sequence_locked,404 not found,429 rate-limited,5xx/network visible error and deliberate retry.

## Media classification (legacy / revision)

Existing private audioUrl `/api/resources/...` remains backward compatible. External stored public links require **explicit** `audioClassification:'external'` (revision under test.audioClassification); private may omit discriminator or use `'private'`. Source: original MaterialPlayer/resolveEmbedSource, but provider matching is exact host matching (not source substring matching), HTTPS direct formats, signed/credential/token/R2-host URLs rejected. No signed private URL may be reclassified as external. Server must resolve private uploads through current authorized resource endpoint and recheck every range/access/revocation.

Native audio/video nodes use controls/preload=none; retained across legacy edits; error/retry reloads SAME authorized URL and owned position; route abort pauses/removes src/load. Empty/link/public direct/YouTube branches explicit. YouTube normalized only to youtube-nocookie embed; sandbox EXACT `allow-scripts`, no same-origin. Public provider has external noreferrer/noopener fallback. **Preview CSP is unchanged**: default/media self, external YouTube/direct fetches may be blocked, so provider playback remains NOT ACCEPTED. No wildcard/media/CSP relaxation/proxy/backend invented to make fixtures appear live. iframe load is NOT evidence of playback. Universal private range/expiry/revocation/provider long-lived lifecycle is still a remaining gate.

Revision native speed respects original audio/file/video type support AND playable native source; provider iframe cannot falsely advertise native rate. Transcript vocabulary identity corrected to canonical testId, not attemptId. Populated mistake/keyword/vocabulary data remain released server projections; no client grade or answer inference.

## Academic detail (partial increment, not catalogue/hub completion)

`data:{kind:'academic',test:{testId,title,parts,questions,minutes,transcriptAvailable,draft,activities,progress}}`, URL identity exact. Activities are ordered server registry projections with exact original id/path pairs including keyword1→3/keyword2→4 and nullable latest score/total. No client-generated missing activities or progress. Original runtime projection `{kind:'original',testId}` redirects canonical test hub; source first, no full audio prefetch. `{kind:'locked'}` shows existing source lock; `{kind:'not_found'}`/404 original not-found. Full Academic catalogue/hub/history validation and workflow gate NOT finished.

## Failure/acceptance boundary

401 handled by existing global authority teardown, no fixture identity fallback.403 not bypassed;404 explicit not-found;500/network/malformed projections retry in place with current URL and persistent shell, cancellations/stale completions ignored. Restriction/answer redaction must also be enforced at server APIs; fixtures cannot prove deployed policy. No actual backend, provider, original-rendered, Safari, hardware or production acceptance claimed.
