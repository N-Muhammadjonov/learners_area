# TED / Podcast and local recording parity — 2026-10-25

The TED library now uses Main’s visible section headings and introduction. The pinned header identifies TED / PODCAST; the existing Main/Back shell and absence of the sidebar are preserved.

Standalone lessons expose every authored stage in Main’s order: before watching, transcript, notes, comprehension, gap fill, vocabulary, opinion and summary. Empty authored stages are omitted. Opinion and summary are saved together through the existing response endpoint. Server progress, grading and authorization remain authoritative.

The ten title-matched TED study packs now have native A–I practice: glossary, gist, detailed comprehension, matching selects, collocation inputs, transcript noticing, discussion, summary recording and lexical activation. Their authored content is retained from Main; the interface is implemented in browser JavaScript. Drafts survive stage changes. The answer guide is instructional, with no invented grading. Responses retain the existing `ted-study-pack-v1` envelope and 4,000-character limit.

Video authoring was compared against Main’s existing form, including its URL, transcript, source, vocabulary, questions, optional roadmap association and publication controls. Submission and validation remain on the existing `/api/admin/video-lessons` API. This is Main’s link-based authoring flow; it does not introduce a raw upload endpoint.

Speaking practice, AI Speaking review and TED summary recordings share a local preview. It decodes the completed recording before enabling Play, calls AudioContext.resume directly inside the first Play gesture and starts the decoded buffer only when output is running. It supports pause, seeking and replay, pauses when hidden, and closes its context on discard/route exit. Unsupported formats retain the unmuted native player. The original Blob, MIME, AI upload and object URL lifecycle are preserved. Local-only practice clips stay local.

## Validation

- Main/native comparison: 182 control states across ten TED packs, A–I stages and video authoring in English and Uzbek, zero differences. This checks rendered controls, not pixel screenshots.
- Frontend: 1,035 passed, 11 existing skips, zero failures. Eight new regressions cover first-click sequencing, seek, cancellation, native fallback, study answers, save envelopes and grouping.
- Backend: 2,578 passed.
- FastAPI/embedded PostgreSQL integration: 333 HTTP checks, 148 decoder checks, 120 native DOM checks, all passed.
- Existing Media and Dictionary Worker handlers against real FastAPI ASGI: 97 checks passed; 12 pinned reference source/configuration hashes verified. Authority and R2 objects in this harness are synthetic. This is not a live Cloudflare edge/bucket verification.
- Day/night contrast audit: 420 cases, 21,704 text checks, zero failures or unresolved colors.
- Python-only build/startup: 465 frontend assets, 119 routes; no Node runtime.
- No physical microphone/speaker device or browser screenshot proof is claimed. The first-click regression uses a controlled AudioContext and nonzero test samples. Actual audibility still depends on the target device/browser and output settings.

## Compatibility and publication

Existing Worker configuration, buckets, secrets, signing protocols, FastAPI API contracts and database schema are unchanged. The pending MCQ/diagnostics/Worker-test commit is included in the authorized branch publication. Diagnostics remain gated; later SPA optimization stages are still subject to their measured-browser baseline gate. The user explicitly authorized this branch push and deploy on 2026-10-25. Main is not merged or updated.

Audio implementation references: [complete-file decoding](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData), [AudioContext resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume), [optional AudioSession routing](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type).
