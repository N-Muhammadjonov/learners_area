# V4 route ledger — PARTIAL

Source denominators preserved. CODE COMPLETE means scoped ordinary frontend engineering closed, not live/visual/product acceptance. See SOURCE_STATE_INVENTORY_V4.md for the three bounded closures. None of the other 24 candidates is silently promoted.

```json
{
  "baseline": "9a7d9fc5a93608078644d61cd9f9850c05c4ddc8",
  "previousCheckpoint": "948d012cabe0c8c31fbc82502dc2077fc6af8293",
  "pageFiles": 115,
  "classificationCounts": {
    "CANONICAL_PAGE_CANDIDATE": 107,
    "PROTECTED_REDIRECT_ONLY": 5,
    "CONDITIONAL_CANONICAL_AND_LEGACY_REDIRECT": 1,
    "QUERY_DEPENDENT_LEGACY_REDIRECT": 1,
    "RETIRED_REDIRECT": 1
  },
  "activeCanonicalDenominator": "UNDETERMINED — 108 inventory candidates are not confirmed active product pages",
  "partialPageCandidates": 24,
  "fullyConvertedAcceptedPages": 0,
  "fullyParityVerifiedPages": 0,
  "notStartedPageRecords": 81,
  "componentFiles": 206,
  "partialComponentFiles": 46,
  "fullyAcceptedComponents": 0,
  "codeCheckpoint": "75f8e7652b6785355fee231f9a5c2f9db2f17ef7",
  "status": "PARTIAL",
  "notStartedComponentFiles": 154,
  "codeCompleteRedirectOnlyRecords": 6,
  "retiredRecords": 1,
  "metrics": {
    "implementation": "UNDETERMINED — active product denominator + all-state audits unconfirmed",
    "functionalSecurity": "UNDETERMINED — subset synthetic evidence is not full acceptance",
    "visualIntegration": "UNDETERMINED — zero original comparisons / zero live accepted"
  },
  "sourceBuild": true,
  "unit": {
    "pass": 181,
    "fail": 0,
    "skip": 0
  },
  "browser": {
    "foundation": 27,
    "v2": 14,
    "v3": 49,
    "v4": 72,
    "total": 162,
    "fail": 0,
    "skip": 0,
    "liveAccepted": 0
  },
  "v3NewPageImplementations": 0,
  "canonicalCandidates": 108,
  "frontendCodeCompleteCanonicalCandidates": 3,
  "frontendCodeCompleteComponents": 6,
  "v4NewPageImplementations": 0,
  "completedModule": "Bounded password recovery/reset frontend; NOT whole Phase 1",
  "componentAccounting": "6 CODE COMPLETE + 46 IN PROGRESS + 154 NOT STARTED = 206",
  "routeAccounting": "3 canonical CODE COMPLETE + 24 IN PROGRESS + 81 NOT STARTED + 6 redirect-only CODE COMPLETE + 1 RETIRED-N/A = 115"
}
```

| Pattern | Source classification | Layout | Implementation | Functional / visual / integration |
|---|---|---|---|---|
| /app/listening/attempts/:id | CANONICAL_PAGE_CANDIDATE | FOCUS | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/attempts/:id/revision | CANONICAL_PAGE_CANDIDATE | FOCUS | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id/:activity | CANONICAL_PAGE_CANDIDATE | FOCUS | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id/mcq | CANONICAL_PAGE_CANDIDATE | FOCUS | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/tests/:id | CANONICAL_PAGE_CANDIDATE | FOCUS | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/tests/:id/study | CANONICAL_PAGE_CANDIDATE | FOCUS | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/admissions | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/content | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/admin/content/workspace | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/grammar/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/grammar | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening/import | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/listening | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials/:type/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials/:type | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/materials | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/admin/people/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/people | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/import | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/reading/retention/staged | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/roster | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/users | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/video-lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing-prompts | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing/:kind/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing/:kind/new | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/admin/writing | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/assignments | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/coach | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/courses/ielts/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/courses/ielts | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/grammar/:topicId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/grammar/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/grammar | CONDITIONAL_CANONICAL_AND_LEGACY_REDIRECT | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/academic/:testId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/academic | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/general/:sectionId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/general | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/import | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/listening/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/mcq/day/:day | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening/mcq | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/listening | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/live-classes | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/management | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/mocks | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/notifications | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/owner/audit | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/owner/dictionary | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/owner/integrations | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/owner | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/owner/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/owner/transfer | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/profile | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/progress | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/academic/:setId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/academic | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading/attempts/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/general/:setId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/general | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading/lessons/:lessonId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/lessons/author | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/reading | QUERY_DEPENDENT_LEGACY_REDIRECT | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/question-types | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/retention | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reading/retention/results/:attemptId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/reports | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking/ai | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking/lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking/live-partner | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /app/speaking/practice | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/speaking/shadowing | RETIRED_REDIRECT | AUTHENTICATED_SHELL | RETIRED-N/A | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/support | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/live-classes/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/live-classes | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/speaking | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/students/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/students | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/teacher/support | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/video-lessons/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/video-lessons | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/games/:gameId | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/games | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/vocabulary/review | PROTECTED_REDIRECT_ONLY | AUTHENTICATED_SHELL | CODE COMPLETE | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/exam/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/grade/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/history | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/language-stealing/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/lessons/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/submissions/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /app/writing/translation/:id | CANONICAL_PAGE_CANDIDATE | AUTHENTICATED_SHELL | NOT STARTED | NOT VERIFIED; NOT VERIFIED; NOT VERIFIED |
| /auth/recovery | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | CODE COMPLETE | UNIT + CHROMIUM FIXTURE PASS; live authority/mail not accepted; NOT VERIFIED — zero original rendered comparisons; LIVE BLOCKED — public projection absent; existing APIs disconnected in static preview |
| /login | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /onboarding | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| / | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; Original visual/device acceptance outstanding |
| /pending | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /register | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | IN PROGRESS | FIXTURE SUBSET PASS; NOT full source-state/live acceptance; NOT VERIFIED — zero original comparisons; BLOCKED for live data/policy — proposed DTOs or existing APIs disconnected; ordinary client gaps remain |
| /reset-password/confirm | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | CODE COMPLETE | UNIT + CHROMIUM FIXTURE PASS; live authority/mail not accepted; NOT VERIFIED — zero original rendered comparisons; LIVE BLOCKED — public projection absent; existing APIs disconnected in static preview |
| /reset-password | CANONICAL_PAGE_CANDIDATE | PUBLIC_OR_ACCOUNT_GATE | CODE COMPLETE | UNIT + CHROMIUM FIXTURE PASS; live authority/mail not accepted; NOT VERIFIED — zero original rendered comparisons; LIVE BLOCKED — public projection absent; existing APIs disconnected in static preview |

Explicit Grammar tabs, dynamic/query/fragment semantics, six redirects and retired Shadowing classifications are retained. Full per-file evidence and inherited remaining work: route-ledger-v4.json. Active-product completion percentage: UNDETERMINED; closed inventory candidates 3/108 (2.78%), not an acceptance percentage.
