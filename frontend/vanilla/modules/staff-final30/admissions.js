import {el,listen,mountStaff,heading,errorText,dateOnly,put} from './kit.js';
import {confirmAction} from '../shared/confirm-action.js';
import {admissions,decide} from '../../js/adapters/staff-final30/people.js';
/** Source: admin/admissions/page.tsx + components/admin/AdmissionQueue.tsx. Roles: admin, owner. */
export const mount=mountStaff({name:'management-admissions',roles:['admin','owner'],
 load:ctx=>admissions(ctx.signal),
 render(ctx,data,view){
  const {dict,signal}=ctx,t=dict.admission,state=(ctx.state.admissions??={busy:null,error:null,notes:{}});
  const queue=el('div',{class:'flex flex-col gap-3'});
  if(state.error)put(queue,el('p',{role:'alert',class:'text-xs text-band-bad'},state.error));
  async function act(id,decision){
   state.busy=id;state.error=null;view.rerender();
   try{await decide(id,decision,state.notes[id],signal);delete state.notes[id];state.busy=null;await view.reload({quiet:true});}
   catch(e){if(signal.aborted)throw e;state.busy=null;state.error=`${dict.people.failed} ${errorText(e,dict)}`;view.rerender();throw e;}
  }
  if(data.pending.length===0)put(queue,el('p',{class:'text-sm text-ink-500'},t.reviewEmpty));
  for(const r of data.pending){
   const note=el('input',{class:'input flex-1 text-xs',placeholder:t.notePlaceholder,maxlength:'500','data-focus-key':'note-'+r.id,'aria-label':t.notePlaceholder});note.value=state.notes[r.id]??'';
   listen(note,'input',()=>{state.notes[r.id]=note.value;},signal);
   const mk=(label,cls,decision)=>confirmAction({signal,trigger:label,triggerClassName:cls,triggerDisabled:state.busy!==null,title:t.confirmDecisionTitle,description:t.confirmDecisionBody,confirmLabel:dict.common.confirm,cancelLabel:dict.common.cancel,pendingLabel:dict.loadingPage.label,failureMessage:dict.people.failed,onConfirm:()=>act(r.id,decision)}).node;
   put(queue,el('div',{class:'card flex flex-col gap-3 p-4','data-access-request':r.id,'data-applicant':r.applicantEmail??r.applicantName},
    el('div',{class:'flex flex-wrap items-start justify-between gap-2'},el('div',{},el('p',{class:'text-sm font-medium text-ink-900'},r.applicantName),el('p',{class:'text-xs text-ink-300'},`${r.applicantEmail??'—'} · ${t.requestedOn} ${dateOnly(r.createdAt)}`)),el('span',{class:'badge bg-band-warn/10 text-band-warn'},t.statusPending)),
    r.message?el('p',{class:'rounded-sm bg-paper-sunken p-3 text-xs text-ink-500'},r.message):null,
    el('div',{class:'flex flex-col gap-2 sm:flex-row sm:items-center'},note,el('div',{class:'flex gap-2'},mk(t.approve,'btn-primary text-xs','approve'),mk(t.reject,'btn-secondary text-xs','reject')))));
  }
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-6'},heading(t.title,t.explainer),
   el('section',{class:'flex flex-col gap-3'},el('h2',{class:'font-display text-lg text-ink-900'},t.queueTitle,data.pending.length?el('span',{class:'ml-2 badge bg-band-warn/10 text-band-warn','data-pending-count':''},String(data.pending.length)):null),queue),
   data.recent.length?el('section',{class:'flex flex-col gap-3'},el('h2',{class:'font-display text-lg text-ink-900'},t.recentTitle),el('div',{class:'card flex flex-col gap-2'},data.recent.map(r=>el('div',{class:'flex items-center justify-between gap-2 text-sm'},el('span',{class:'text-ink-700'},r.applicantName),el('span',{class:'text-xs text-ink-300'},r.decidedAt?dateOnly(r.decidedAt):'—'))))):null);
 }});
