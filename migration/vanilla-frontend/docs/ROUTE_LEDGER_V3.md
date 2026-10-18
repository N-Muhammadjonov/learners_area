# V3 semantic route/component ledger — PARTIAL

V2 inventory preserved. No route promoted by a pending frame, imported module or passing fixture.
Full source-state audits of the existing 27 candidates are still incomplete; broader 81-record expansion did not start.

```json
{
  "baseline": "9a7d9fc5a93608078644d61cd9f9850c05c4ddc8",
  "previousCheckpoint": "b22a0f4c56d3099d5e02739521c5c66d12f78196",
  "pageFiles": 115,
  "classificationCounts": {
    "CANONICAL_PAGE_CANDIDATE": 107,
    "PROTECTED_REDIRECT_ONLY": 5,
    "CONDITIONAL_CANONICAL_AND_LEGACY_REDIRECT": 1,
    "QUERY_DEPENDENT_LEGACY_REDIRECT": 1,
    "RETIRED_REDIRECT": 1
  },
  "activeCanonicalDenominator": "UNDETERMINED: canonical candidates need owner/product/integration confirmation, not every page is active",
  "partialPageCandidates": 27,
  "fullyConvertedAcceptedPages": 0,
  "fullyParityVerifiedPages": 0,
  "notStartedPageRecords": 81,
  "componentFiles": 206,
  "partialComponentFiles": 50,
  "fullyAcceptedComponents": 0,
  "codeCheckpoint": "a4f72f8e558398e83d2ad268b1485d343eb0cb1e",
  "status": "PARTIAL",
  "notStartedComponentFiles": 156,
  "codeCompleteRedirectOnlyRecords": 6,
  "retiredRecords": 1,
  "metrics": {
    "implementation": "UNDETERMINED — active product denominator + all-state audits unconfirmed",
    "functionalSecurity": "UNDETERMINED — subset synthetic evidence is not full acceptance",
    "visualIntegration": "UNDETERMINED — zero original comparisons / zero live accepted"
  },
  "sourceBuild": true,
  "unit": {
    "pass": 142,
    "fail": 0
  },
  "browser": {
    "foundation": 27,
    "v2": 14,
    "v3": 49,
    "fail": 0,
    "liveAccepted": 0
  },
  "v3NewPageImplementations": 0
}
```

Stages: NOT STARTED / IN PROGRESS / CODE COMPLETE / FUNCTIONAL TEST PASS / VISUAL VERIFIED / INTEGRATION BLOCKED / COMPLETE / RETIRED-N/A. Implementation, functional, visual and integration gates remain separate. Redirect-only code completion is not completed product UI.

| Pattern | Source classification | Layout | Stage | Functional | Visual / integration |
|---|---|---|---|---|---|
| /app/listening/attempts/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/attempts/:id/revision | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id/:activity | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id/mcq | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/tests/:id/study | CANONICAL_PAGE_CANDIDATE / DYNAMIC | FOCUS | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/admissions | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/content | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/admin/content/workspace | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/grammar/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/grammar | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening/import | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials/:type/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials/:type | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/admin/people/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/people | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/import | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/retention/staged | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/roster | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/users | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/video-lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing-prompts | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing/:kind/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing/:kind/new | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/assignments | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/coach | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/courses/ielts/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/courses/ielts | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/grammar/:topicId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/grammar | CONDITIONAL_CANONICAL_AND_LEGACY_REDIRECT | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/academic/:testId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/academic | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/general/:sectionId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/general | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/import | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/mcq/day/:day | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/mcq | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/live-classes | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/management | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/mocks | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/notifications | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/owner/audit | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/owner/dictionary | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/owner/integrations | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/owner | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/owner/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/owner/transfer | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/profile | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/progress | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/academic/:setId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/academic | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading/attempts/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/general/:setId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/general | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading | QUERY_DEPENDENT_LEGACY_REDIRECT | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/question-types | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reading/retention/results/:attemptId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/reports | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking/ai | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking/live-partner | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/speaking/practice | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/speaking/shadowing | RETIRED_REDIRECT | AUTHENTICATED_SHELL | RETIRED-N/A | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/support | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/live-classes/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/live-classes | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/speaking | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/students/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/students | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/teacher/support | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/video-lessons/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/video-lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/games/:gameId | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/games | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/review | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/exam/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/grade/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/language-stealing/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/lessons/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/submissions/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /app/writing/translation/:id | CANONICAL_PAGE_CANDIDATE / DYNAMIC | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED | NOT VERIFIED; NOT VERIFIED |
| /auth/recovery | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /login | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /onboarding | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| / | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; Original visual/device acceptance outstanding |
| /pending | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /register | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /reset-password/confirm | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /reset-password | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance | NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |

## Existing 27 candidates — targeted reconciliation, NOT full source-state audit

| Pattern | V3 change / retained subset | Ordinary engineering / acceptance still outstanding |
|---|---|---|
| /app/listening/tests/:id | Opaque authored host, hub-first protocol and shell-free access lifetime retained. | Nine ordinary activity engines, notes/flags/timers/autosave/recovery/outbox/repeated media states are NOT code-complete. |
| /app/admin/content | Existing source presentation candidate retained; shared shell interactions improved. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/admin/materials | Existing source presentation candidate retained; shared shell interactions improved. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/grammar/lessons | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/listening/academic | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/listening/general | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/listening/history | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/listening/lessons | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/listening/mcq/day/:day | Source Day/query navigation, stage protocol, true A–E multiselect, empty/error and media preservation. | All programme stages/transitions/content/audio/resume/permissions require completion and live verification. |
| /app/listening/mcq | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/management | Existing source presentation candidate retained; shared shell interactions improved. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/mocks | Independent mock projection and safe completed-attempt summaries. | Full source/native state audit and live role/ownership acceptance; source does not enable a runner. |
| /app/notifications | Validated notification rows; source observer threshold; serialized mutations/cleanup. | Full source unread/title/empty/error/focus/scroll and live delivery acceptance required. |
| /app/owner/audit | Existing source presentation candidate retained; shared shell interactions improved. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app | Independent dashboard/openLessons/mock regions and retries; narrow validation. | Full source-state audit, roadmap interactions, original visual and server projections required. |
| /app/reading/academic | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/reading/history | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/reading/lessons | Source catalogue layout and section navigation restored for existing candidates; no new destination completed. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /app/speaking | Existing source presentation candidate retained; shared shell interactions improved. | Source page + all imported controls/styles/handlers/states/API and nested workflow audit remains incomplete. |
| /auth/recovery | Uses the same reviewed source LoginForm(recovery); query error and existing recovery endpoint. | Complete source keyboard/focus/validation acceptance and live authorized recovery required. |
| /login | Source bootstrap retry, provider states and safe error classes; Telegram fallback. | Live provider/cookie/nonce flow and full form focus parity required. |
| /onboarding | Eight source fields/constraints; success invalidates session; refreshed locale/lang verified. | Entire source UI/state acceptance and real cookie rotation remain unverified. |
| / | Public entry preserved; original 27 probes rerun. | Original visual/intro-device acceptance still outstanding. |
| /pending | Status-specific forms, open-request state, safe retry and post-request authoritative refresh. | All source account transitions and real approval/SSE/role acceptance required. |
| /register | Source gender validation, drafts, retry and safe malformed/429/503 handling. | Complete keyboard/focus and server-policy validation required. |
| /reset-password/confirm | Token/query/reload handling and unavailable states. | Real single-use token validity/expiry and full keyboard lifecycle required. |
| /reset-password | Acknowledged generic success, retry and unsafe developer URL rejection. | Full source focus validation and real mail flow required. |

All 206 component source-file records and individual stages are in route-ledger-v3.json. Nine source-file candidates newly recorded as IN PROGRESS: source section layout/navigation, entry frame/outlet, code prewarm and retry/confirmation primitives; none is accepted complete. Original query-dependent Reading redirects, explicit Grammar writing/speaking tabs and retired Shadowing semantics remain unchanged. Unimplemented native destinations remain engineering gaps, not revived/converted pages.
