import {el,listen,mountStaff,heading,put,setChildren} from './kit.js';
import {retentionConfig,runRetention} from '../../js/adapters/staff-final30/owner.js';
/**
 * Source: owner/retention/page.tsx + RetentionRunner.tsx. The source runs cleanup from its own button with NO extra
 * confirmation (preview first by convention). Preserved as-is; see docs/final30/SOURCE_STATE_LEDGER.md finding F-1.
 */
export const mount=mountStaff({name:'management-retention',roles:['owner'],load:ctx=>retentionConfig(ctx.signal),
 render(ctx,data){
  const {dict,signal}=ctx,t=dict.retention,c=data.config,S=(ctx.state.retention??={results:null,dryRun:true,error:null});
  const rows=[[t.inactiveStudent,`${c.inactiveStudentMonths} ${t.months}`],[t.rawConversations,`${c.rawEventMonths} ${t.months}`],[t.structuredResults,`${c.structuredResultMonths} ${t.months}`],[t.reportSnapshots,`${c.structuredResultMonths} ${t.months}`],[t.generatedExports,`${c.generatedExportDays} ${t.days}`],[t.auditHistory,`${c.auditMonths} ${t.months}`]];
  const dry=el('button',{type:'button',class:'btn-secondary text-xs'},t.dryRun),run=el('button',{type:'button',class:'btn-primary text-xs'},t.run),out=el('div',{class:'flex flex-col gap-1','data-retention-output':''}),err=el('p',{role:'alert',hidden:true,class:'text-xs text-band-bad'});
  const paint=()=>{setChildren(out,);if(!S.results)return;put(out,el('p',{class:'text-xs text-ink-300','data-retention-mode':S.dryRun?'dry-run':'applied'},S.dryRun?t.previewOnly:t.lastRun),...S.results.map(r=>el('div',{class:'flex flex-wrap items-center justify-between gap-2 text-xs','data-retention-rule':r.rule,'data-retention-affected':String(r.affected)},el('span',{class:'font-mono text-ink-700'},r.rule),el('span',{class:'text-ink-500'},`${r.affected===0?t.nothing:`${r.affected} · ${t.deleted}`}${r.note?` — ${r.note}`:''}`))));};
  let busy=false;
  async function go(isDry){if(busy||signal.aborted)return;busy=true;dry.disabled=run.disabled=true;(isDry?dry:run).textContent=t.running;err.hidden=true;
   try{const r=await runRetention(isDry,signal);if(signal.aborted)return;S.dryRun=r.dryRun;S.results=r.results;paint();}
   catch(e){if(signal.aborted)return;err.textContent=dict.errors.unknown;err.hidden=false;}
   finally{busy=false;if(!signal.aborted){dry.disabled=run.disabled=false;dry.textContent=t.dryRun;run.textContent=t.run;}}}
  listen(dry,'click',()=>void go(true),signal);listen(run,'click',()=>void go(false),signal);paint();
  const fmt=el('select',{name:'format',class:'input'},['pdf','docx','zip'].map(f=>el('option',{value:f},t.formats[f])));
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},heading(t.title,t.subtitle),
   el('div',{class:'card flex flex-col gap-2 p-5'},rows.map(([l,v])=>el('div',{class:'flex items-center justify-between gap-2 text-sm'},el('span',{class:'text-ink-700'},l),el('span',{class:'font-mono text-ink-900'},v)))),
   el('div',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-lg'},t.studentExport),el('p',{class:'text-sm text-ink-500'},t.studentExportBody),
    el('form',{action:'/api/owner/student-export',method:'get','data-native':'',class:'flex flex-wrap items-end gap-3'},el('label',{},t.fileFormat,fmt),el('button',{type:'submit',class:'btn-primary'},t.downloadStudents))),
   el('div',{class:'card flex flex-col gap-3 p-5'},el('div',{class:'flex flex-wrap gap-2'},dry,run),err,out));
 }});
