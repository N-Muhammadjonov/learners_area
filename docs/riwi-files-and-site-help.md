# RIWI file assistance and site guide

The tutor remains an internal rule-based system. These features do not enable an
external provider, unrestricted translation, photo-scene reasoning, or automatic
shared learning from uploaded files.

## Files

The composer accepts picker, drag/drop and pasted files. PNG/JPEG/WebP OCR uses
vendored English/Uzbek Latin/Cyrillic models. PDF text extraction falls back to
page OCR for scans. DOCX, UTF text, inert HTML, Markdown, CSV and JSON are read
locally; ZIP input is rejected. Scripts, embedded images and remote resources in
HTML are not executed. Extraction limits are explicit, not silent truncation:
4 files, 20 MB each, 60 PDF pages, 60,000 extracted characters per file and
120,000 total. OCR is fallible and its text should be checked in the editor.

Only extracted text accompanies the chat question. File text is untrusted data,
does not override policy and is not added to shared knowledge. Student active
assessment restrictions and normal chat permissions remain in force.

An explicit command can create TXT/DOCX/PDF with supplied content, export a
supported lesson answer, or replace exact quoted text in a supplied document.
The local editor also exports a new text document. DOCX same-format replacement
preserves OOXML structure, tables, runs and embedded assets. PDF same-format
replacement changes supported horizontal text objects rather than painting over
old text; unsupported fonts, geometry or signed/scripted PDFs fail explicitly.
The UI then offers a separate text copy, not a claim of exact layout preservation.
Original-layout edit source/output is capped at 3 MB. Binary source is sent only
for an explicit edit. The original upload is never overwritten. New Chat and
/clear discard attachment context, editor state and generated download URLs.

## Site help

`app/riwi_site.py` provides read-only bilingual workflows. The generated catalogue
contains all 125 current routes, their effective loaders/layouts and role filters.
The authenticated server actor decides access; UI observations cannot grant a
role, authorize data reads, change settings or execute a button.

Owner can ask about the native ESM / FastAPI architecture, route/navigation
system and controls. Teacher/admin receive their operational scope. Staff-only,
Owner-only and lesson-authoring routes are filtered; hidden assessment answers,
credentials and another user's private records remain outside the guide.

For control questions, the browser sends a bounded description of currently
visible controls and the last relevant workspace observed before navigation:
static route pattern (no object IDs/query values), label, link pattern, viewport
zone, computed foreground/background colours and disabled state. Input values,
chat transcript and attachment editor content are excluded. The previous surface
is session memory only and is cleared on identity/authority invalidation.

Owner-only handler metadata contains at most 800 characters of the registered
handler's source, never closure values, and appears only when the Owner asks
about its code/action. No handler is executed for help. Direct event listeners
outside the shared DOM helpers may have no metadata. Labels/observations are
untrusted quoted data. Unknown functionality or an unseen visual state is
clarified rather than invented. A dynamic application cannot honestly promise
that a finite rule library understands every future control or arbitrary question.

Refresh the catalogue after relevant code changes:

```sh
node scripts/riwi-site-catalog.mjs
```

The Python production build checks captured source hashes and fails on stale
site knowledge. It does not require Node to package or serve the application.

## Verification boundaries

Automated tests cover file validation/export roundtrips, safe HTML extraction,
mounted drop handling, guards, actor-filtered guide answers, current route/source
coverage, no-value UI capture, session invalidation and pre-disposal observation.
Safari Owner Preview QA separately verifies live OCR, scan/text PDF, DOCX edits,
HTML, downloaded files and site-guide replies. A file picker test does not prove
a physical drag gesture; desktop/responsive checks do not prove iPhone keyboard
or microphone acceptance. QA activation is not production activation.
