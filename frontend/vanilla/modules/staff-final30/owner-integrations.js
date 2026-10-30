import {el,listen,mountStaff,heading,dateTime,badge,setChildren} from './kit.js';
import {integrations,aiStatus,saveAi} from '../../js/adapters/staff-final30/owner.js';
/** Source: owner/integrations/page.tsx + AiControlPanel.tsx. States and non-sensitive names only; no secret values exist in any DTO. */
const LABEL={database:'database',storage:'storage',telegram:'telegram',email:'email',external_ai:'externalAi',speech_to_text:'speechToText'};
const TONE={connected:'good',error:'bad',unverified:'warn',not_configured:'neutral'};
export const mount=mountStaff({name:'management-integrations',roles:['owner'],
 load:async ctx=>{const [report,ai]=await Promise.all([integrations(ctx.signal),aiStatus(ctx.signal)]);return {...report,ai};},
 render(ctx,data,view){
  const {dict,signal}=ctx,t=dict.integration,a=dict.aiControl;
  const panel=aiPanel(ctx,data.ai,a);
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},heading(t.title,t.subtitle),panel,
   el('div',{class:'flex flex-col gap-2'},data.report.map(r=>{const label=t[LABEL[r.key]??'database']??r.key,state={connected:t.connected,error:t.error,unverified:t.unverified,not_configured:t.notConfigured}[r.state];
    return el('div',{class:'card flex flex-wrap items-center justify-between gap-2 p-5'},el('div',{},el('p',{class:'text-sm font-medium text-ink-900'},label),el('p',{class:'text-xs text-ink-300'},`${r.detail??'—'} · ${t.lastChecked} ${r.checkedAt.slice(0,16).replace('T',' ')}`)),badge(state,TONE[r.state],{'data-integration':r.key,'data-state':r.state}));})),
   el('p',{class:'rounded-sm bg-paper-sunken p-3 text-xs text-ink-500'},t.secretNote));
 }});
function aiPanel(ctx,initial,a){
 const {signal}=ctx;let status=initial,enabled=initial.owner.externalEnabled,fallback=initial.owner.fallback,pending=false,message=null;
 const host=el('section',{class:'card flex flex-col gap-3 p-4','data-ai-control':''});
 const providerId={v:initial.owner.providerId??initial.effective.providerId},model={v:initial.owner.model??''};
 function paint(){
  const radio=(name,checked,onSel,label)=>{const i=el('input',{type:'radio',name,checked:checked?'':null});i.checked=checked;listen(i,'change',onSel,signal);return el('label',{class:'flex items-center gap-1 text-sm'},i,' ',label);};
  const sel=el('select',{class:'input','data-ai-provider-select':''},status.providers.map(p=>el('option',{value:p.id},p.type==='internal'?a.riwiOnly:`${p.displayName} (${p.id})`)));sel.value=providerId.v;listen(sel,'change',()=>{providerId.v=sel.value;},signal);
  const mi=el('input',{class:'input',maxlength:'100',placeholder:a.modelPlaceholder,'data-ai-model-input':''});mi.value=model.v;listen(mi,'input',()=>{model.v=mi.value;},signal);
  const save=el('button',{type:'button',class:'btn-primary',disabled:pending},pending?a.saving:a.save);listen(save,'click',()=>void doSave(),signal);
  setChildren(host,
   el('div',{},el('h2',{class:'font-display text-xl text-ink-900'},a.title),el('p',{class:'text-sm text-ink-500'},a.subtitle),el('p',{class:'text-xs text-ink-500'},a.learnerLabel)),
   el('p',{class:'text-sm','data-ai-ceiling':String(status.deploymentCeiling)},`${a.ceiling}: `,el('strong',{},status.deploymentCeiling?a.on:a.off),status.deploymentCeiling?null:el('span',{class:'block text-xs text-band-warn'},a.ceilingOffNote)),
   status.owner.source==='unavailable'?el('p',{class:'text-sm text-band-bad',role:'alert'},a.unavailable):null,
   el('fieldset',{class:'flex flex-wrap items-center gap-3'},el('legend',{class:'text-sm font-semibold text-ink-700'},a.master),radio('ai-master',enabled,()=>{enabled=true;},a.on),radio('ai-master',!enabled,()=>{enabled=false;},a.off)),
   el('label',{class:'flex flex-col gap-1 text-sm'},el('span',{class:'font-semibold text-ink-700'},a.provider),sel),
   el('label',{class:'flex flex-col gap-1 text-sm'},el('span',{class:'font-semibold text-ink-700'},a.modelLabel),mi,el('span',{class:'text-xs text-ink-500'},a.modelHint)),
   el('fieldset',{class:'flex flex-col gap-1'},el('legend',{class:'text-sm font-semibold text-ink-700'},a.fallbackLabel),radio('ai-fallback',fallback==='riwi',()=>{fallback='riwi';},a.fallbackRiwi),radio('ai-fallback',fallback==='none',()=>{fallback='none';},a.fallbackStrict)),
   el('ul',{class:'flex flex-col gap-1 text-xs text-ink-500'},status.providers.filter(p=>p.type==='external').map(p=>el('li',{'data-ai-provider':p.id},el('strong',{class:'text-ink-700'},p.displayName),` · ${a.model}: ${p.model??'—'} · ${p.secretsPresent?a.secretsOk:`${a.secretsMissing}: ${p.missingSecretNames.join(', ')}`}`))),
   status.configIssues.length?el('div',{class:'text-xs text-band-warn'},`${a.configIssues}: ${status.configIssues.map(i=>`#${i.index+1} ${i.reason}`).join('; ')}`):null,
   el('p',{class:'text-sm','data-ai-effective':status.effective.ready?'ready':'off'},`${a.effective}: `,el('strong',{},status.effective.ready?a.ready:a.notReady),status.effective.ready?el('span',{class:'block text-xs text-ink-500'},`${a.model}: ${status.effective.model??'—'} · ${status.effective.fallback==='none'?a.fallbackStrict:a.fallbackRiwi}`):null),
   el('p',{class:'text-xs text-ink-500'},`${a.lastChange}: ${status.owner.updatedAt?dateTime(status.owner.updatedAt):a.neverChanged}`),
   el('div',{class:'flex items-center gap-2'},save,message?el('span',{class:`text-sm ${message.tone==='good'?'text-band-good':'text-band-bad'}`,role:'status'},message.text):null));
 }
 async function doSave(){if(pending||signal.aborted)return;pending=true;message=null;paint();
  try{status=await saveAi({externalEnabled:enabled,providerId:providerId.v,model:model.v,fallback},signal);if(signal.aborted)return;enabled=status.owner.externalEnabled;fallback=status.owner.fallback;providerId.v=status.owner.providerId??status.effective.providerId;model.v=status.owner.model??'';message={tone:'good',text:a.saved};}
  catch(e){if(signal.aborted)return;message={tone:'bad',text:e.code==='unknown_provider'?a.unknownProvider:e.code==='invalid_model'?a.invalidModel:a.failed};}
  finally{pending=false;if(!signal.aborted)paint();}}
 paint();return host;
}
