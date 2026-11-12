/** V56 native Management front door. Current main reference:
 * src/app/app/(shell)/management/page.tsx @ b62b78f. */
import {el} from './kit.js';
import {STATS_EN,STATS_UZ} from './statistics-strings.js';
import {ACADEMIC_EN,ACADEMIC_UZ} from './monitoring-strings.js';
import {
 IconAdmissions,IconAudit,IconChevronRight,IconContent,IconGrammar,
 IconListening,IconLive,IconPeople,IconPlay,IconReading,IconRetention,
 IconSettings,IconSpeaking,IconSupport,IconWriting
} from '../../js/generated/icons.js';

export function managementAreas(dict,role){
 const admin=role==='admin'||role==='owner',owner=role==='owner';
 const staff=['teacher','admin','owner'].includes(role);const areas=[];
 const stats=dict.managementStats??(dict.people.name==='Ism'?STATS_UZ:STATS_EN);
 const add=(href,title,body,icon)=>areas.push({href,title,body,icon});
 if(admin){
  if(owner)add('/app/admin/statistics',dict.nav.statistics??stats.title,stats.scope,IconAudit);
  add('/app/admin/people',dict.nav.adminUsers,dict.management.peopleBody,IconPeople);
  add('/app/admin/admissions',dict.admission.title,dict.management.admissionsBody,IconAdmissions);
  add('/app/admin/roster',dict.reporter.roster.title,dict.reporter.roster.body,IconPeople);
 }
 if(role==='teacher'||owner){
  const academic=dict.people.name==='Ism'?ACADEMIC_UZ:ACADEMIC_EN;
  add('/app/teacher/students',dict.nav.people,dict.management.studentsBody,IconPeople);
  add('/app/teacher/homework',academic.homework,academic.homeworkBody,IconWriting);
  add('/app/management?view=mocks',dict.people.name==='Ism'?'Mock testlar':'Mock Tests',dict.people.name==='Ism'?'Mock yaratish, materiallarni nashr qilish va natijalarni tekshirish.':'Create mocks, publish materials, review and grade results.',IconAudit);
 }
 if(staff){
  add('/app/management/study-plans',
      dict.people.name==='Ism'?'O‘quv rejasi natijalari':'Study plan progress',
      dict.people.name==='Ism'?'7/30 kunlik rejalardagi mashqlar va o‘quvchi progressini ko‘rish.':'View daily tasks and verified progress on 7/30-day plans.',
      IconPeople);
  add('/app/teacher/support',dict.support.inbox,dict.management.supportBody,IconSupport);
  add('/app/teacher/live-classes',dict.liveClasses.manageTitle,dict.management.liveBody,IconLive);
  add('/app/teacher/speaking',dict.speaking.manageTitle,dict.management.speakingBody,IconSpeaking);
 }
 if(staff&&!admin){
  add('/app/admin/video-lessons',dict.videoLessonAdmin.title,dict.management.videoBody,IconPlay);
  add('/app/admin/materials',dict.admin.materialsTitle,dict.management.materialsBody,IconContent);
 }
 if(admin){
  add('/app/admin/reading',dict.admin.readingTitle,dict.management.readingBody,IconReading);
  add('/app/admin/listening',dict.admin.listeningTitle,dict.management.listeningBody,IconListening);
  add('/app/admin/grammar',dict.admin.grammarTitle,dict.management.grammarBody,IconGrammar);
  add('/app/admin/writing',dict.admin.writingAdmin.title,dict.management.writingBody,IconWriting);
  add('/app/admin/video-lessons',dict.videoLessonAdmin.title,dict.management.videoBody,IconPlay);
  add('/app/admin/materials',dict.admin.materialsTitle,dict.management.materialsBody,IconContent);
  add('/app/admin/content',dict.nav.contentLibrary,dict.management.contentBody,IconContent);
 }
 add('/app/reports',dict.reporter.title,dict.reporter.managementBody,IconAudit);
 add('/app/support',dict.nav.support,dict.support.subtitle,IconSupport);
 if(staff){
  add('/app/management/guardians',dict.people.name==='Ism'?'Ota-onalar':'Guardians',dict.people.name==='Ism'?'Talaba–ota-ona bog‘lanishlari va qo‘lda yuboriladigan xabarlar.':'Student–guardian links and manually sent messages.',IconPeople);
 }
 if(owner){
  add('/app/owner',dict.owner.title,dict.management.ownerBody,IconSettings);
  add('/app/owner/integrations',dict.owner.integrations,dict.management.integrationsBody,IconSettings);
  add('/app/owner/retention',dict.owner.retention,dict.management.retentionBody,IconRetention);
  add('/app/owner/audit',dict.owner.audit,dict.management.auditBody,IconAudit);
 }
 return areas;
}
export async function mount(ctx){
 const {root,signal,session,dict,navigate,url}=ctx;
 const role=session?.user?.role;
 if(!['teacher','admin','owner'].includes(role)){void navigate('/app',{replace:true});return;}
 const view=url?.searchParams?.get('view');
 if(['mocks','mock-create','mock-grading'].includes(view)){
  if(!['teacher','owner'].includes(role)){void navigate('/app/management',{replace:true});return;}
  const entry=view==='mocks'?await import('./mock-management.js'):
    view==='mock-create'?await import('./mock-create.js'):await import('./mock-grading.js');
  if(signal?.aborted)return;
  await (view==='mock-grading'?entry.mockGradingMount:view==='mock-create'?entry.mockCreateMount:entry.mount)(ctx);
  return;
 }
 const link=(href,classes,...children)=>el('a',{href,class:classes},...children);
 const areas=managementAreas(dict,role);
 const cards=areas.map(({href,title,body,icon})=>{
  const a=link(href,'panel group flex min-h-[150px] flex-col gap-3 transition-colors hover:border-gold/45 hover:bg-paper-sunken',
   el('span',{'aria-hidden':'true',class:'flex h-11 w-11 items-center justify-center rounded-xl border border-ink-100 bg-paper-sunken text-[22px] text-gold'},icon({})),
   el('span',{class:'card-title'},title),el('span',{class:'body-text flex-1 text-[0.9375rem]'},body),
   el('span',{class:'inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-ink-500 group-hover:text-ink-900'},IconChevronRight({className:'text-[16px]'})));
  a.setAttribute('data-management-area',href);return a;
 });
 const host=el('div',{class:'flex flex-col gap-8','data-management-hub':''},
  areas.length?el('div',{class:'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3'},cards):el('p',{},dict.management.emptyForRole));
 if(signal?.aborted)return;
 root.append(host);
 signal?.addEventListener('abort',()=>host.remove(),{once:true});
}
