# API compatibility matrix

214 API route files discovered. No backend modified. This is a source-index, NOT a fully reviewed contract matrix. Request/response schemas, ownership, dynamic fetch calls, retry safety and authorization remain unverified except the explicitly reviewed contracts below.

## Reviewed subset
- GET `/api/auth/state`: same-origin session cookies; no body; `{ok,role,accountStatus,expiresAt}` or 401 `{error:"unauthenticated"}`; private no-store. Does not expose user id/name/email/onboarding/policy. Cannot bootstrap a full shell cache scope.
- POST `/api/auth/recovery/login`: JSON `{email,password}`. Existing server exclusively decides recovery eligibility. No retry or cache. LoginForm reads `{accountStatus,onboarded,role}` and maps server failures. Live integration BLOCKED without backend.
- POST `/api/theme`: JSON `{theme:"day"|"night"}`; authoritative server cookie transport; optimistic UI reverts on failure. No retries/cache.
- POST `/api/locale`: JSON `{locale:"uz"|"en"}`; server cookie; update dictionary only after success. No retries/cache.
- GET `/api/auth/changes`: optional SSE configured on server; AccessChangeListener behavior not yet converted.

## Missing boundaries (proposals, NOT existing APIs)
1. Public release/bootstrap adapter supplying publicAuthPolicy, Telegram mode/configured public bot username, Google availability, brand display configuration, locale/theme. NEVER bot tokens or private environment. Required before normal login/register/reset pages may be enabled.
2. Authenticated shell bootstrap returning database-verified user id/name/email/photo availability/onboarding and scoped presentation data. Existing state endpoint is not sufficient. Preserve expiry and access-change authority.
3. Per-page server view-data adapters for direct database/service reads listed in source-inventory.json. Must retain ownership, role, grading and answer redaction server-side. No general database proxy. Inspect each page before defining exact schemas.

## All discovered route handlers
| Endpoint | Exported methods | Source | Auth checks detected (not proof) | Contract status |
|---|---|---|---|---|
| /api/admin/admission/[id]/decide | POST | src/app/api/admin/admission/[id]/decide/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/[type]/[id]/publication | POST | src/app/api/admin/content/[type]/[id]/publication/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/authoring-capabilities | GET | src/app/api/admin/content/authoring-capabilities/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/bank | GET | src/app/api/admin/content/bank/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/drafts | POST | src/app/api/admin/content/drafts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/import | POST, GET | src/app/api/admin/content/import/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/items/[module]/[contentType]/[sourceRef] | GET | src/app/api/admin/content/items/[module]/[contentType]/[sourceRef]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/items | GET | src/app/api/admin/content/items/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/lessons/[id]/edit | GET | src/app/api/admin/content/lessons/[id]/edit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/lessons/[id]/revision | POST | src/app/api/admin/content/lessons/[id]/revision/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/previews | GET | src/app/api/admin/content/previews/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/template | GET | src/app/api/admin/content/template/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/validate | POST | src/app/api/admin/content/validate/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/versions/[id]/preview | GET | src/app/api/admin/content/versions/[id]/preview/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/content/versions/[id]/publication | POST | src/app/api/admin/content/versions/[id]/publication/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/grammar/import | POST | src/app/api/admin/grammar/import/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/grammar/topics/[id]/exercises | POST | src/app/api/admin/grammar/topics/[id]/exercises/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/grammar/topics | POST | src/app/api/admin/grammar/topics/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/listening/import | POST | src/app/api/admin/listening/import/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/listening/tests/[id]/convert | GET, POST | src/app/api/admin/listening/tests/[id]/convert/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/listening/tests/[id]/questions | POST | src/app/api/admin/listening/tests/[id]/questions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/listening/tests/[id] | PATCH, DELETE | src/app/api/admin/listening/tests/[id]/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/listening/tests | POST | src/app/api/admin/listening/tests/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/reading/import | POST | src/app/api/admin/reading/import/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/reading/passages/[id]/questions | POST | src/app/api/admin/reading/passages/[id]/questions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/reading/passages | POST | src/app/api/admin/reading/passages/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/retention/texts/[id] | GET, PATCH | src/app/api/admin/retention/texts/[id]/route.ts | requireRetentionAdmin | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/retention/texts/[id]/versions | POST | src/app/api/admin/retention/texts/[id]/versions/route.ts | requireRetentionAdmin | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/retention/texts | GET, POST | src/app/api/admin/retention/texts/route.ts | requireRetentionAdmin | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/retention/validate | POST | src/app/api/admin/retention/validate/route.ts | requireRetentionAdmin | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/roster | POST | src/app/api/admin/roster/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/uploads/cleanup | POST | src/app/api/admin/uploads/cleanup/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/users/[id]/role | PATCH | src/app/api/admin/users/[id]/role/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/users/[id]/status | POST | src/app/api/admin/users/[id]/status/route.ts | requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/video-lessons | GET, POST | src/app/api/admin/video-lessons/route.ts | requireStaff | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/writing-prompts | POST | src/app/api/admin/writing-prompts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/writing/[kind]/[id] | PUT | src/app/api/admin/writing/[kind]/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admin/writing/[kind] | POST | src/app/api/admin/writing/[kind]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/admission/request | POST | src/app/api/admission/request/route.ts | getCurrentUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/assignments/[id]/evaluate | POST | src/app/api/assignments/[id]/evaluate/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/assignments/assignable | GET | src/app/api/assignments/assignable/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/assignments | GET, POST | src/app/api/assignments/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/changes | GET | src/app/api/auth/changes/route.ts | getCurrentSessionAuthority | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/google/callback | GET | src/app/api/auth/google/callback/route.ts | verifyGoogleIdToken | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/google/start | GET | src/app/api/auth/google/start/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/login | POST | src/app/api/auth/login/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/logout | POST | src/app/api/auth/logout/route.ts | verifySessionToken | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/recovery/login | POST | src/app/api/auth/recovery/login/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/register | POST | src/app/api/auth/register/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/reset/confirm | POST | src/app/api/auth/reset/confirm/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/reset/request | POST | src/app/api/auth/reset/request/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/state | GET | src/app/api/auth/state/route.ts | getCurrentSessionAuthority | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/telegram/callback | GET | src/app/api/auth/telegram/callback/route.ts | verifyTelegramPayload | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/telegram/intent/cancel | POST | src/app/api/auth/telegram/intent/cancel/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/telegram/intent/exchange | POST | src/app/api/auth/telegram/intent/exchange/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/telegram/intent | POST | src/app/api/auth/telegram/intent/route.ts | getCurrentUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/auth/telegram/intent/status | GET | src/app/api/auth/telegram/intent/status/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/dictionary/entries/[lexemeId] | GET, POST | src/app/api/dictionary/entries/[lexemeId]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/dictionary/recent | GET, DELETE | src/app/api/dictionary/recent/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/dictionary/save | POST | src/app/api/dictionary/save/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/dictionary/search | GET | src/app/api/dictionary/search/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/grammar/exercises/[id]/practice | POST | src/app/api/grammar/exercises/[id]/practice/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/grammar/exercises/[id]/produce | POST | src/app/api/grammar/exercises/[id]/produce/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/grammar/topics/[id]/submit | POST | src/app/api/grammar/topics/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/history | GET | src/app/api/history/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/admins/[telegramUserId] | PATCH, DELETE | src/app/api/internal/telegram/admins/[telegramUserId]/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/admins | GET, POST | src/app/api/internal/telegram/admins/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/admission/decide | POST | src/app/api/internal/telegram/admission/decide/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/admission/pending | GET | src/app/api/internal/telegram/admission/pending/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/admission/request | POST | src/app/api/internal/telegram/admission/request/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/auth/confirm | POST | src/app/api/internal/telegram/auth/confirm/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/broadcasts/[id] | GET, POST | src/app/api/internal/telegram/broadcasts/[id]/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/broadcasts/claim | POST | src/app/api/internal/telegram/broadcasts/claim/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/broadcasts | POST | src/app/api/internal/telegram/broadcasts/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/contacts/[telegramUserId] | GET | src/app/api/internal/telegram/contacts/[telegramUserId]/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/contacts/phone | POST | src/app/api/internal/telegram/contacts/phone/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/contacts | POST | src/app/api/internal/telegram/contacts/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId]/delete | POST | src/app/api/internal/telegram/directory/[userId]/delete/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId]/message | POST | src/app/api/internal/telegram/directory/[userId]/message/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId]/remove | POST | src/app/api/internal/telegram/directory/[userId]/remove/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId] | GET | src/app/api/internal/telegram/directory/[userId]/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId]/status | POST | src/app/api/internal/telegram/directory/[userId]/status/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory/[userId]/unlink | POST | src/app/api/internal/telegram/directory/[userId]/unlink/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/directory | GET | src/app/api/internal/telegram/directory/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/drafts | POST | src/app/api/internal/telegram/drafts/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/notifications | GET, PUT, POST | src/app/api/internal/telegram/notifications/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/ops | GET, PATCH | src/app/api/internal/telegram/ops/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/owner/handover | POST | src/app/api/internal/telegram/owner/handover/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/owner | GET | src/app/api/internal/telegram/owner/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/owner/transfer | POST | src/app/api/internal/telegram/owner/transfer/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/ready | GET | src/app/api/internal/telegram/ready/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/required-channels | GET, POST | src/app/api/internal/telegram/required-channels/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/support/threads/[id]/actions | POST | src/app/api/internal/telegram/support/threads/[id]/actions/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/support/threads/[id]/messages | POST | src/app/api/internal/telegram/support/threads/[id]/messages/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/support/threads/[id] | GET | src/app/api/internal/telegram/support/threads/[id]/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/support/threads | GET, POST | src/app/api/internal/telegram/support/threads/route.ts | verifyInternalBotRequest, requireBotPermission | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/updates | POST | src/app/api/internal/telegram/updates/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/internal/telegram/users/[telegramUserId] | GET | src/app/api/internal/telegram/users/[telegramUserId]/route.ts | verifyInternalBotRequest | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/lessons/[id]/notes | GET, POST | src/app/api/lessons/[id]/notes/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/lessons/[id] | GET | src/app/api/lessons/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/lessons/[id]/state | POST | src/app/api/lessons/[id]/state/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/lessons/blocks/[blockId]/answer | POST | src/app/api/lessons/blocks/[blockId]/answer/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/lessons/units | GET | src/app/api/lessons/units/route.ts | requireStaff | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/attempts/[id]/draft | PUT | src/app/api/listening/attempts/[id]/draft/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/attempts/[id]/submit | POST | src/app/api/listening/attempts/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/attempts | POST | src/app/api/listening/attempts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/activity | POST | src/app/api/listening/full/[id]/activity/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/authored-state | GET, PUT | src/app/api/listening/full/[id]/authored-state/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/authored | GET | src/app/api/listening/full/[id]/authored/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/practice | POST | src/app/api/listening/full/[id]/practice/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/progress | GET, POST | src/app/api/listening/full/[id]/progress/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/sandbox | GET | src/app/api/listening/full/[id]/sandbox/route.ts | requireAdministrator, requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/start | POST | src/app/api/listening/full/[id]/start/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/full/[id]/study | POST | src/app/api/listening/full/[id]/study/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/mcq/[id] | GET, PATCH | src/app/api/listening/mcq/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/listening/mcq | POST | src/app/api/listening/mcq/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/live-classes/[id]/join | POST | src/app/api/live-classes/[id]/join/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/live-partner | GET, POST | src/app/api/live-partner/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/locale | POST | src/app/api/locale/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/materials/[type]/[id] | GET, PUT | src/app/api/materials/[type]/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/media/authorize | POST | src/app/api/media/authorize/route.ts | verifyMediaAuthorizationProof, verifyMediaCapability | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/notifications | GET, POST | src/app/api/notifications/route.ts | requireUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/onboarding | POST | src/app/api/onboarding/route.ts | getCurrentSessionAuthority | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/owner/ai-control | GET, POST | src/app/api/owner/ai-control/route.ts | requireOwner | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/owner/dictionary/[...action] | GET, POST, PATCH, DELETE | src/app/api/owner/dictionary/[...action]/route.ts | requireOwner | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/owner/retention | POST | src/app/api/owner/retention/route.ts | requireOwner | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/owner/student-export | GET | src/app/api/owner/student-export/route.ts | requireOwner | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/owner/transfer | POST | src/app/api/owner/transfer/route.ts | requireOwner, verifyPassword | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/profile/photo/[id] | GET | src/app/api/profile/photo/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/profile/photo | POST, DELETE | src/app/api/profile/photo/route.ts | requireActiveUser, verifySignature | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/profile | PATCH | src/app/api/profile/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reading/academic | POST | src/app/api/reading/academic/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reading/attempts/[id] | PATCH | src/app/api/reading/attempts/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reading/attempts/[id]/submit | POST | src/app/api/reading/attempts/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reading/attempts | POST | src/app/api/reading/attempts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reading/general/progress | POST | src/app/api/reading/general/progress/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/reports | GET | src/app/api/reports/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/resources/[...key] | GET, HEAD | src/app/api/resources/[...key]/route.ts | getCurrentSessionAuthority | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/attempts/[id]/draft | PATCH | src/app/api/retention/attempts/[id]/draft/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/attempts/[id]/finish-reading | POST | src/app/api/retention/attempts/[id]/finish-reading/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/attempts/[id] | GET | src/app/api/retention/attempts/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/attempts/[id]/submit | POST | src/app/api/retention/attempts/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/attempts | POST, GET | src/app/api/retention/attempts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/history | GET | src/app/api/retention/history/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/retention/summary | GET | src/app/api/retention/summary/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/search | GET | src/app/api/search/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/ai/script | GET | src/app/api/speaking/ai/script/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/attempts/[id] | GET, DELETE, PATCH | src/app/api/speaking/attempts/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/attempts/[id]/submit | POST | src/app/api/speaking/attempts/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/attempts/[id]/transcript | POST | src/app/api/speaking/attempts/[id]/transcript/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/attempts | POST, GET | src/app/api/speaking/attempts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/live-partner/questions | GET | src/app/api/speaking/live-partner/questions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/materials/[id] | PATCH, DELETE | src/app/api/speaking/materials/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/materials | POST | src/app/api/speaking/materials/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/practice/facets | GET | src/app/api/speaking/practice/facets/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/practice/questions | GET | src/app/api/speaking/practice/questions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/prompts/[id]/support | GET | src/app/api/speaking/prompts/[id]/support/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/prompts | GET, POST | src/app/api/speaking/prompts/route.ts | requireActiveUser, requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/prompts/vocabulary | POST | src/app/api/speaking/prompts/vocabulary/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/speaking/topics | POST, DELETE | src/app/api/speaking/topics/route.ts | requireActiveUser, requireAdministrator | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/support/reports/[id] | PATCH | src/app/api/support/reports/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/support/reports | POST, GET | src/app/api/support/reports/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/teacher/feedback | POST | src/app/api/teacher/feedback/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/teacher/live-classes/[id] | PATCH | src/app/api/teacher/live-classes/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/teacher/live-classes | POST | src/app/api/teacher/live-classes/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/theme | POST | src/app/api/theme/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/uploads/[id] | DELETE | src/app/api/uploads/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/uploads/finalize | POST | src/app/api/uploads/finalize/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/uploads/intent | POST | src/app/api/uploads/intent/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/uploads | POST | src/app/api/uploads/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/version | GET | src/app/api/version/route.ts |  | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/video-lessons/[id]/answers | POST | src/app/api/video-lessons/[id]/answers/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/video-lessons/[id]/progress | POST, GET | src/app/api/video-lessons/[id]/progress/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/video-lessons/[id]/response | POST | src/app/api/video-lessons/[id]/response/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/video-lessons/[id]/vocabulary | POST | src/app/api/video-lessons/[id]/vocabulary/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/[id]/contexts | GET | src/app/api/vocabulary/[id]/contexts/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/[id]/review | POST | src/app/api/vocabulary/[id]/review/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/[id]/use | POST | src/app/api/vocabulary/[id]/use/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/due | GET | src/app/api/vocabulary/due/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/folders | GET, POST | src/app/api/vocabulary/folders/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/games | GET, POST | src/app/api/vocabulary/games/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/leaderboard | GET | src/app/api/vocabulary/leaderboard/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/lookup | GET | src/app/api/vocabulary/lookup/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/meaning | GET | src/app/api/vocabulary/meaning/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/packs | GET, POST | src/app/api/vocabulary/packs/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary | GET, POST | src/app/api/vocabulary/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/search | GET | src/app/api/vocabulary/search/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/sentences | GET | src/app/api/vocabulary/sentences/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/vocabulary/summary | GET | src/app/api/vocabulary/summary/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/activation/check | POST | src/app/api/writing/activation/check/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/activation/items | GET, POST | src/app/api/writing/activation/items/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/exam/[id]/draft | PUT | src/app/api/writing/exam/[id]/draft/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/exam/[id]/finalize | POST | src/app/api/writing/exam/[id]/finalize/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/exam/[id] | GET | src/app/api/writing/exam/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/exam | POST | src/app/api/writing/exam/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/grade/[id] | POST | src/app/api/writing/grade/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/grade | POST | src/app/api/writing/grade/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/lessons/[id] | POST | src/app/api/writing/lessons/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/patterns/[id] | PUT | src/app/api/writing/patterns/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/stealing/practice | GET, POST | src/app/api/writing/stealing/practice/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/stealing/sessions/[id] | POST | src/app/api/writing/stealing/sessions/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/stealing/sessions | POST | src/app/api/writing/stealing/sessions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/submissions/[id] | PATCH | src/app/api/writing/submissions/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/submissions/[id]/submit | POST | src/app/api/writing/submissions/[id]/submit/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/submissions | POST | src/app/api/writing/submissions/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/translation/[id]/answer | POST | src/app/api/writing/translation/[id]/answer/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/translation/[id] | GET | src/app/api/writing/translation/[id]/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/translation | POST | src/app/api/writing/translation/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing/finish | POST | src/app/api/writing/typing/finish/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing/pause | POST | src/app/api/writing/typing/pause/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing/prepare | POST | src/app/api/writing/typing/prepare/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing/resume | POST | src/app/api/writing/typing/resume/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing | GET, POST | src/app/api/writing/typing/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
| /api/writing/typing/start | POST | src/app/api/writing/typing/start/route.ts | requireActiveUser | SOURCE DISCOVERED — CONTRACT NOT FULLY REVIEWED |
