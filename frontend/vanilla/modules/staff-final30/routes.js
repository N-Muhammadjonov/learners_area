/**
 * FINAL30 staff route table — a SEPARATE, additive table. It does NOT edit js/routes.js (read-only reference).
 * The integrator merges it per docs/final30/MERGE_PATCH_PLAN.md: each entry replaces the `unavailable.js`
 * loader of the same pattern, keeps `protected:true`, and keeps the shared-shell prepare() path unchanged.
 * Patterns not listed here are NOT IMPLEMENTED in this delivery (see ROUTE_STATUS.md) and must keep unavailable.js.
 */
const t=(m,name)=>()=>import(`./${m}.js`).then(x=>name?{mount:x[name]}:x);
export default [
 {pattern:'/app/management',roles:['teacher','admin','owner'],load:t('management-hub')},
 {pattern:'/app/management/study-plans',roles:['teacher','admin','owner'],load:t('study-plans')},
 {pattern:'/app/admin/statistics',roles:['owner'],load:t('statistics')},
 {pattern:'/app/admin/admissions',roles:['admin','owner'],load:t('admissions')},
 {pattern:'/app/admin/people',roles:['admin','owner'],load:t('people')},
 {pattern:'/app/admin/people/:id',roles:['owner'],load:t('teacher','studentMount')},
 {pattern:'/app/admin/roster',roles:['admin','owner'],load:t('roster')},
 {pattern:'/app/admin/content/workspace',roles:['admin','owner'],load:t('content-workspace')},
 {pattern:'/app/admin/grammar',roles:['admin','owner'],load:t('grammar','listMount')},
 {pattern:'/app/admin/grammar/:id',roles:['admin','owner'],load:t('grammar','detailMount')},
 {pattern:'/app/admin/reading',roles:['admin','owner'],load:t('reading','listMount')},
 {pattern:'/app/admin/reading/import',roles:['admin','owner'],load:t('reading-import')},
 {pattern:'/app/admin/reading/retention',roles:['admin','owner'],load:t('retention','bankMount')},
 {pattern:'/app/admin/reading/retention/staged',roles:['admin','owner'],load:t('retention','stagedMount')},
 {pattern:'/app/admin/reading/:id',roles:['admin','owner'],load:t('reading','detailMount')},
 {pattern:'/app/admin/writing',roles:['admin','owner'],load:t('writing','listMount')},
 {pattern:'/app/admin/writing/:kind/new',roles:['admin','owner'],load:t('writing','newMount')},
 {pattern:'/app/admin/writing/:kind/:id',roles:['admin','owner'],load:t('writing','editMount')},
 {pattern:'/app/admin/materials/:type',roles:['teacher','admin','owner'],load:t('materials','kindMount')},
 {pattern:'/app/admin/materials/:type/:id',roles:['teacher','admin','owner'],load:t('materials','editorMount')},
 {pattern:'/app/admin/video-lessons',roles:['teacher','admin','owner'],load:t('video-lessons')},
 {pattern:'/app/teacher/speaking',roles:['teacher','admin','owner'],load:t('speaking')},
 {pattern:'/app/admin/listening',roles:['admin','owner'],load:t('listening','libraryMount')},
 {pattern:'/app/admin/listening/import',roles:['admin','owner'],load:t('listening-import')},
 {pattern:'/app/admin/listening/:id',roles:['admin','owner'],load:t('listening','detailMount')},
 {pattern:'/app/owner',roles:['owner'],load:t('owner-overview')},
 {pattern:'/app/owner/transfer',roles:['owner'],load:t('owner-transfer')},
 {pattern:'/app/owner/retention',roles:['owner'],load:t('owner-retention')},
 {pattern:'/app/owner/integrations',roles:['owner'],load:t('owner-integrations')},
 {pattern:'/app/owner/dictionary',roles:['owner'],load:t('owner-dictionary')},
 {pattern:'/app/teacher/students',roles:['teacher','owner'],load:t('teacher','studentsMount')},
 {pattern:'/app/teacher/students/:id',roles:['teacher','owner'],load:t('teacher','studentMount')},
 {pattern:'/app/teacher/students/:id/assignments/:assignmentId',roles:['teacher','owner'],load:t('homework','assignmentMount')},
 {pattern:'/app/teacher/assessments/:studentId/:module/:attemptId',roles:['teacher','owner'],load:t('homework','assessmentMount')},
 {pattern:'/app/teacher/homework',roles:['teacher','owner'],load:t('homework','homeworkMount')},
 {pattern:'/app/teacher/support',roles:['teacher','admin','owner'],load:t('teacher','supportMount')},
 {pattern:'/app/teacher/live-classes',roles:['teacher','admin','owner'],load:t('teacher-live','listMount')},
 {pattern:'/app/teacher/live-classes/:id',roles:['teacher','admin','owner'],load:t('teacher-live','detailMount')},
].map(r=>({...r,protected:true}));
