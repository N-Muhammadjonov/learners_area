# ADAPTERS REQUIRED
Two kinds. Everything below is a **proposal or a reuse note**; nothing here exists on a server by virtue of this delivery. Every read DTO is validated fail-closed (`js/adapters/staff-final30/*.js`); no fallback identity, role, policy or data.

## A. Existing handlers called as-is (source-inspected)
| Call | Handler | Used by |
|---|---|---|
| POST `/api/admin/admission/:id/decide` {decision,note} | admin/admission/[id]/decide | admissions |
| PATCH `/api/admin/users/:id/role` {role}; POST `…/status` {status,reason} | admin/users/[id]/* | people |
| POST `/api/admin/roster` (form) | admin/roster | roster |
| GET/POST `/api/owner/ai-control` | owner/ai-control | integrations |
| POST `/api/owner/retention` {dryRun}; GET `/api/owner/student-export?format=` | owner/* | retention |
| POST `/api/owner/transfer` | owner/transfer | transfer |
| `/api/owner/dictionary/{summary,drafts,drafts/:id,history,publish,publish/:id,entries/:id,rollback}` | owner/dictionary/[...action] | dictionary |
| POST `/api/teacher/feedback`; GET `/api/assignments/assignable`; POST `/api/assignments` | teacher, assignments | student detail |
| PATCH `/api/support/reports/:id` | support/reports/[id] | support |
| POST `/api/teacher/live-classes`; PATCH `…/:id` | teacher/live-classes | live classes |
| POST `/api/admin/grammar/topics`, `…/topics/:id/exercises`, `/api/admin/grammar/import` | admin/grammar/* | grammar |
| POST `/api/admin/reading/passages`, `…/passages/:id/questions` | admin/reading/* | reading |
| POST/PUT `/api/admin/writing/:kind[/:id]` | admin/writing/[kind] | writing |
| POST `/api/admin/content/:type/:id/publication` | admin/content/[type]/[id]/publication | every PublicationControl |
| GET/PUT `/api/materials/:type/:id` | materials/[type]/[id] | ResourceComposer (loads + saves its own blocks) |
| POST `/api/uploads/intent`, PUT presigned URL (or POST `/api/uploads`), POST `/api/uploads/finalize`, DELETE `/api/uploads/:id` | uploads/* | upload engine |
| POST `/api/admin/video-lessons` | admin/video-lessons | video lessons |
| POST `/api/admin/reading/import` {bundle,dryRun} | admin/reading/import | reading import |
| PATCH/DELETE `/api/admin/listening/tests/:id`; POST `/api/admin/content/{validate,import}`; GET `/api/admin/content/template` | admin/listening/*, admin/content/* | listening admin + canonical import |
| GET `/api/owner/dictionary/{search,entries/:id}` | owner/dictionary | DictionaryPanel |
| GET `/api/admin/content/{bank,authoring-capabilities,template,items/:m/:t/:ref,versions/:id/preview}`; POST `…/validate`, `…/drafts`, `…/versions/:id/publication` | admin/content/* | authoring workspace |
| GET/PATCH `/api/admin/retention/texts/:id`; POST `…/texts`, `…/texts/:id/versions`, `…/validate` | admin/retention/* | retention bank |

## B. PROPOSED read adapters — `GET /api/frontend/staff/<kind>` → `{version:1,kind,data}`
Authority: server re-derives role from the database on every call (`requireAdministrator`/`requireOwner`/`requireStaff`), 403 for others, 404 for not-found/not-on-roster; teacher scoping by roster is server-side. Dates ISO strings. No secrets, hashes, answer keys or direct R2 URLs in any DTO.
| kind | Source function(s) | DTO (see validator) |
|---|---|---|
| `admissions` | listPendingAccessRequests, listRecentDecisions(10) | pending[id,applicantName,applicantEmail,message,createdAt], recent[id,applicantName,decidedAt] |
| `people` (q,role,status,page) | listPeople + grantableRoles(actor) | people[], filters, page,pageSize,total,totalPages, actorId, actorRole, grantableRoles |
| `student-results` (id) | getMockOverview, getProgressData | student, unavailable, testIds, attempts[id,mockTestId,title,skill,finishedAt,estimatedBand,rawScore], practice{skill→count|null} |
| `roster` (teacher,q) | page queries + listRoster | teachers, selected, roster, candidates, listCap, rosterCap, query |
| `owner-overview` | countPeople, pending count, integrationReport, brand config | counts[role,status,count], pendingCount, integrations[key,state], brand{siteName,favicon,assets[key,path]} |
| `owner-integrations` | integrationReport | report[key,state,detail,checkedAt] |
| `owner-retention` | readRetentionConfig | config{5 numbers} |
| `owner-transfer` | requireOwner().email | ownerEmail |
| `teacher-students` | listStudents | students[id,name,email,onboardingCompletedAt] |
| `teacher-student` (id) | getStudentDetail, findEvaluationsForSources, live prompts, activationOverview, staffProvenanceLabel | student, results{…}, activation, prompts[id,label], submissions[id,status,category,content,evaluation{…provenanceLabel},feedback[]] |
| `support-inbox` | listReports | reports[id,route,module,status,message,reporterName,createdAt,viewport,lastErrorCode] |
| `teacher-live-classes` | listAllForTeacher + grouped attendance COUNT | classes[id,title,status,scheduledAt,durationMinutes,attendees] |
| `teacher-live-class` (id) | getLiveClassDetail, roster join, joinState/opensAt | liveClass{…hasMeetingUrl,hasRecordingUrl}, joinState, opensAt, roster[name,email,joinedAt] |

Additional PROPOSED read kinds (same envelope): `listening-library`(page: cards[…collection,legacy,authoredRuntime,publicationState…] + hasMore), `listening-test`(id: {redirectToFull} or test+questions), `listening-import` ({schemaReady}), `speaking-manage` (rows with canManage + blocks incl. server-signed objectUrl, prompts for admin/owner), `reading-retention`(level,filter,sort,page: inventory[level,activeCount,target,remainingToTarget,lifetimeUses,archivedCount] + bank{page,pageCount,total,rows[]}), `retention-staged`(level: report{items[],heldTextCount,mismatchCount}), `materials-kind`(type) rows[id,title,studentVisible], `materials-owner`(type,id) owner{title,studentVisible} (404 when the caller may not manage it), `video-admin` lessons[] + authored[id,title,lessonTitle,provider,transcriptSource,hasNotes,publicationState,publishAt] (teachers: server returns only their own), `grammar-topics`, `grammar-topic`(id), `reading-passages`, `reading-passage`(id), `writing-admin`(section: counts for all 5 kinds + rows of the section; `unavailable:true` replaces the source `NotMigrated` state), `writing-admin-new`(kind: pattern sources), `writing-admin-item`(kind,id: the row as `getWritingContent`, pattern sources).

## C. External dependencies not in the snapshot / not yet ported
* `public/brand/*` artwork (owner overview).
* `DictionaryPanel.tsx` integration (owner dictionary slot).
* `package-lock.json` (`npm ci` fails; build was NOT run — see TEST_EVIDENCE).
* **Staff upload engine: PORTED** (`js/adapters/staff-final30/uploads.js`; policy/signature/errors copied from source). Client ceilings are product defaults; the server remains authoritative. The student-side uploaders (Arena: Writing/Speaking) should share this module at integration to avoid divergence. Presigned `uploadUrl` must be https (or same-origin) or the upload is refused client-side.
* `FullListeningLibrary`, `ListeningTestActions`, `ListeningImport`, `MaterialPlayer` (Arena listening scope).
* **pdf.js** (`pdfjs-dist` legacy build + worker, same-origin) for Reading-import PDFs: inject as `ctx.readPdfTextLayer(bytes,signal)`; otherwise PDFs are refused. A bundling/CSP decision for the integrator.
* **Listening legacy import:** POST `/api/admin/listening/import` {payload,audioUploadId,imageUploadId} is the existing handler; the server re-validates the whole package. Not ported (refused): oldest exam-page format and the authored-runtime frame.
