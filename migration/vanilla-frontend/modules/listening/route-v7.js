import {legacyListeningExam,listeningReview} from './legacy.js';import {listeningRevision} from './revision.js';
import {testMcq} from './test-mcq.js';
import {fullListeningActivity} from './full-activity.js';import {fullListeningStudy} from './study.js';import {mcqMastery} from './mcq.js';
import {el} from '../../js/dom.js';import {viewData} from '../../js/adapters/frontend.js';import {ListeningSequenceLocked} from '../../js/generated/listening-locked.js';import {RegionFailureNotice,BackLink} from '../shared/presentation.js';import {listeningExam} from './exam.js';import {listeningPractice} from './practice.js';import {fullExamStart} from './exam-start.js';import {uuid} from '../../js/adapters/listening-v7.js';
/** New source-derived consumers; projections remain proposals, never synthetic live data. */
export function mount(context){const {root,url,dict,signal}=context,parts=url.pathname.split('/'),id=parts[4],activity=parts[5],attempt=parts[3]==='attempts',host=el('div',{'data-listening-native-v7':''});const main=el('main',{id:'main-content',tabindex:-1,class:'listening-full-focus relative min-h-dvh w-full min-w-0 overflow-x-hidden bg-paper','data-listening-full-focus':''});main.append(el('div',{class:'sticky top-0 z-40 flex min-h-16 w-full items-center bg-paper-raised/95 px-3 py-2 backdrop-blur',style:{paddingTop:'calc(0.5rem + env(safe-area-inset-top))',paddingLeft:'calc(0.75rem + env(safe-area-inset-left))',paddingRight:'calc(0.75rem + env(safe-area-inset-right))'},'data-listening-focus-backbar':''},BackLink({fallbackHref:'/app/listening',label:dict.nav.listening,className:'btn-secondary inline-flex min-h-11 w-fit items-center gap-1'})),host);root.append(main);let pending=false;
 async function load(){if(signal.aborted||pending)return;pending=true;host.setAttribute('aria-busy','true');host.replaceChildren(el('p',{role:'status'},dict.common.loading));try{if(!uuid(id))throw Error();const data=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
 if(data.kind==='locked')host.replaceChildren(ListeningSequenceLocked({dict}));
 else if(!attempt&&data.kind==='authored'){await context.navigate('/app/listening/tests/'+id+(activity==='mcq'?'#mcq':activity==='study'?'#review':''),{replace:true});}
 else if(!attempt&&['2','3','4','5'].includes(activity)&&data.kind==='activity'&&data.activity?.id===id&&data.activity.activity===Number(activity))host.replaceChildren(fullListeningActivity(context,data.activity));
 else if(!attempt&&activity==='mcq'&&data.kind==='mcq'&&data.mcq?.id===id)host.replaceChildren(testMcq(context,data.mcq));
 else if(!attempt&&activity==='study'&&data.kind==='study'&&data.study?.id===id)host.replaceChildren(fullListeningStudy(context,data.study));
 else if(!attempt&&activity==='1'&&data.kind==='exam-start'&&typeof data.title==='string')host.replaceChildren(fullExamStart(context,{id,title:data.title}));
 else if(!attempt&&['matching','completion','map','retry'].includes(activity)&&data.kind==='practice'&&data.practice?.id===id&&data.practice?.kind===activity)host.replaceChildren(listeningPractice(context,data.practice));
 else if(attempt&&activity==='revision'&&data.kind==='revision'&&data.revision?.attempt?.id===id)host.replaceChildren(listeningRevision(context,data.revision));
 else if(attempt&&!activity&&data.kind==='legacy-exam'&&data.exam?.attemptId===id)host.replaceChildren(legacyListeningExam(context,data.exam));
 else if(attempt&&!activity&&data.kind==='review'&&data.review?.attempt?.id===id)host.replaceChildren(listeningReview(context,data.review));
 else if(attempt&&data.kind==='exam'&&data.exam?.attemptId===id)host.replaceChildren(listeningExam(context,data.exam));
 else if(data.kind==='exam-locked')host.replaceChildren(el('div',{class:'listening-workspace'},el('a',{class:'btn-secondary',href:'/app/listening/tests/'+id},'← Listening'),el('p',{role:'status'},dict.fullListeningHub.research.examLocked)));
 else if(data.kind==='redirect'&&typeof data.href==='string'&&new RegExp('^/app/listening/(?:tests/[0-9a-f-]+/2|general/[0-9a-f-]+)$','i').test(data.href))await context.navigate(data.href,{replace:true});
 else throw Error('Source mode not yet implemented');
 }catch{if(!signal.aborted)host.replaceChildren(RegionFailureNotice({region:'listening',message:dict.common.error,retryLabel:dict.common.retry,refresh:load}));}finally{pending=false;if(!signal.aborted)host.setAttribute('aria-busy','false');}}
 void load();}
