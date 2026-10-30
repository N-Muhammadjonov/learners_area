import {el,listen,mountStaff,BackLink,fill,put,pageParam,setChildren} from './kit.js';
import {materialPlayer} from './speaking.js';
import {library,test,renameTest,deleteTest,COLLECTIONS} from '../../js/adapters/staff-final30/listening.js';
const ROLES=['admin','owner'];
/** components/listening/ListeningTestActions.tsx — rename / permanent delete. Any failure is the generic message (source); success refreshes. */
export function testActions(ctx,{id,title,onDone}){
 const {dict,signal}=ctx,S=((ctx.state.listeningActions??={})[id]??={editing:false,deleting:false,name:title,pending:false,error:''}),node=el('div',{class:'space-y-2','data-listening-test-actions':''});
 async function run(remove){if(S.pending||signal.aborted)return;S.pending=true;S.error='';paint();
  try{if(remove)await deleteTest(id,signal);else await renameTest(id,S.name,signal);if(signal.aborted)return;S.editing=S.deleting=false;S.pending=false;await onDone();}
  catch{if(signal.aborted)return;S.pending=false;S.error=dict.errors.unknown;paint();}}
 function paint(){
  const b=(text,cls,fn,attrs={})=>{const x=el('button',{type:'button',class:cls,disabled:S.pending,...attrs},text);listen(x,'click',fn,signal);return x;};
  const form=S.editing?(()=>{const i=el('input',{class:'input','aria-label':title,maxlength:'200',required:'','data-listening-rename-input':''});i.value=S.name;listen(i,'input',()=>{S.name=i.value;},signal);const f=el('form',{class:'space-y-2'},i,el('button',{type:'submit',class:'btn-primary',disabled:S.pending,'data-listening-rename-save':''},dict.common.save),b(dict.common.cancel,'btn-secondary ml-2',()=>{S.editing=false;paint();}));listen(f,'submit',e=>{e.preventDefault();void run(false);},signal);return f;})():null;
  const del=S.deleting?el('div',{class:'space-y-2'},el('p',{},`${dict.common.delete}: ${title}?`),b(dict.common.delete,'btn-primary',()=>void run(true),{'data-listening-delete-confirm':''}),b(dict.common.cancel,'btn-secondary ml-2',()=>{S.deleting=false;paint();})):null;
  const open=node.querySelector('details')?.open;
  setChildren(node,el('details',{class:'self-end',open:open?'':null},el('summary',{class:'cursor-pointer text-right text-xl','aria-label':`${dict.common.edit}: ${title}`},'⋯'),el('div',{class:'flex gap-2 py-2'},b(dict.common.edit,'btn-secondary',()=>{S.editing=true;S.deleting=false;paint();},{'data-listening-edit':''}),b(dict.common.delete,'btn-secondary',()=>{S.deleting=true;S.editing=false;paint();},{'data-listening-delete':''}))),form,del,S.error?el('p',{role:'alert'},S.error):null);
 }
 paint();return node;
}
/** components/listening/FullListeningLibrary.tsx (management mode) — a card is filed under ITS OWN collection; nothing is reclassified. */
export function listeningLibrary(ctx,cards,view){
 const {dict,signal}=ctx,t=dict.fullListeningHub.library,S=(ctx.state.listeningLibrary??={search:'',collection:'academic',section:0});
 const cat=c=>c.collection??'uncatalogued',tabs=COLLECTIONS.filter(k=>k!=='uncatalogued'||cards.some(c=>cat(c)==='uncatalogued')),inCat=cards.filter(c=>cat(c)===S.collection);
 const visible=inCat.filter(c=>c.title.toLowerCase().includes(S.search.toLowerCase())&&(!S.section||(c.sectionNumbers??[1,2,3,4]).includes(S.section)));
 const nav=el('nav',{class:'listening-collection-tabs','aria-label':t.collections},tabs.map(k=>{const b=el('button',{type:'button','data-listening-collection':k,'aria-pressed':String(S.collection===k)},`${t[k]} (${cards.filter(c=>cat(c)===k).length})`);listen(b,'click',()=>{S.collection=k;S.section=0;view.rerender();},signal);return b;}));
 const sections=S.collection==='general'?[0,...new Set(inCat.flatMap(c=>c.sectionNumbers??[1,2,3,4]))].sort((a,b)=>a-b).map(n=>{const b=el('button',{type:'button','aria-pressed':String(S.section===n),class:S.section===n?'btn-primary':'btn-secondary','data-listening-section':String(n)},n?fill(t.sectionN,{n}):t.fullListening);listen(b,'click',()=>{S.section=n;view.rerender();},signal);return b;}):[];
 const search=el('input',{class:'input','data-listening-search':'','data-focus-key':'ls-search'});search.value=S.search;listen(search,'input',()=>{S.search=search.value;view.rerender();},signal);
 const grid=el('div',{class:'full-listening-grid'},visible.map(c=>{
  const badge=c.legacy?fill(t.questionsMeta,{n:c.questions??0}):c.authoredRuntime?dict.nav.listening:S.section?t.badgeSection:t.badgeFull;
  const meta=c.authoredRuntime?fill(t.authoredMeta,{min:Math.round(c.duration/60)}):S.section?fill(t.sectionOf,{n:S.section}):c.legacy?t.legacyMeta:fill(t.fullMeta,{parts:c.sectionNumbers?.length??4,min:Math.round(c.duration/60)});
  const total=c.activityCount??5;
  return el('article',{class:'listening-library-card card p-5 flex flex-col gap-3','data-listening-card':c.id},c.publicationState==='archived'?el('p',{'data-archived-listening-test':'',class:'text-sm text-ink-500'},t.archivedTestHint):null,testActions(ctx,{id:c.id,title:c.title,onDone:()=>view.reload({quiet:true})}),el('span',{class:'listening-library-badge badge'},badge),el('h2',{class:'font-display text-xl font-bold'},c.title),el('p',{},meta),
   !c.authoredRuntime?el('div',{},el('progress',{class:'w-full',max:total,value:Number(c.completed),'aria-label':fill(t.progressLabel,{title:c.title})}),el('p',{},fill(t.completedOf5,{done:c.completed,total}))):null,
   c.legacy?el('a',{class:'btn-primary',href:`/app/admin/listening/${c.id}`},`${dict.common.continue} →`):el('a',{class:'btn-primary mt-auto',href:S.section&&!c.authoredRuntime?`/app/listening/tests/${c.id}/study?section=${S.section}`:`/app/listening/tests/${c.id}`},S.section?t.openSection:Number(c.completed)>=total?t.review:c.started?t.continue:t.start));}));
 return el('section',{class:'listening-library space-y-6','data-async-content':'listening-tests'},nav,el('div',{class:'flex flex-wrap items-center gap-2'},sections,el('label',{class:'ml-auto'},t.search,search)),grid,!visible.length?el('p',{class:'card p-5'},t.empty):null);
}
/** Source: admin/listening/page.tsx — one combined list (full tests + legacy), paged by `?page=`. */
export const libraryMount=mountStaff({name:'management-listening',roles:ROLES,load:c=>library(pageParam(c.url),c.signal),
 render(ctx,d,view){const {dict}=ctx,page=pageParam(ctx.url),t=dict.fullListeningHub.library;
  return el('div',{class:'listening-workspace mx-auto flex max-w-[1840px] flex-col gap-6','data-management-listening-library':''},el('div',{class:'flex flex-wrap items-center justify-between gap-3'},el('h1',{class:'font-display text-2xl'},dict.admin.listeningTitle),el('a',{class:'btn-primary',href:'/app/admin/listening/import','data-admin-listening-import':''},dict.listeningImport.title)),
   d.unavailable?el('p',{role:'alert'},dict.errors.unknown):listeningLibrary(ctx,d.cards,view),
   el('nav',{class:'flex gap-2'},page>1?el('a',{class:'btn-secondary',href:`/app/admin/listening?page=${page-1}`,'data-listening-prev':''},t.previous):null,d.hasMore?el('a',{class:'btn-secondary',href:`/app/admin/listening?page=${page+1}`,'data-listening-next':''},`${dict.common.continue} →`):null));}});
/** Source: admin/listening/[id]/page.tsx — a canonical full test redirects to the learner page; otherwise the legacy desk: audio + the set learners get + actions. */
export const detailMount=mountStaff({name:'management-listening-test',roles:ROLES,notFoundBack:null,load:c=>test(c.url.pathname.split('/').filter(Boolean).at(-1),c.signal),
 render(ctx,d,view){const {dict,navigate}=ctx,id=ctx.url.pathname.split('/').filter(Boolean).at(-1);
  if(d.redirectToFull){queueMicrotask(()=>void navigate(`/app/listening/tests/${id}`,{replace:true}));return el('div',{'data-listening-redirect':''});}
  return el('div',{class:'listening-workspace mx-auto flex max-w-3xl flex-col gap-4'},BackLink({fallbackHref:'/app/admin/listening',label:dict.common.back}),el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},d.test.title),el('div',{class:'mt-2'},materialPlayer(d.test.audioUrl,d.test.audioType,'Open audio','No audio file uploaded yet.'))),
   el('div',{class:'flex flex-col gap-2'},d.questions.map(q=>el('div',{class:'card','data-listening-question':q.id},el('div',{class:'flex items-center justify-between'},el('span',{class:'text-sm font-medium text-ink-900'},`${q.order}. ${q.questionText}`),el('span',{class:'text-xs text-ink-300'},q.type)),el('p',{class:'mt-1 text-xs text-ink-300'},`Answer: ${q.correctAnswer}`)))),
   testActions(ctx,{id:d.test.id,title:d.test.title,onDone:()=>view.reload({quiet:true})}));}});
