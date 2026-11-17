import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {paymentMoney,paymentDate} from '../payments/format.js';

const labels={
 uz:{active_groups:'Faol guruhlar',available_seats:'Faol guruhlardagi bo‘sh o‘rinlar',active_leads:'Qabul jarayonidagi nomzodlar',trials_scheduled:'Sinov darsi belgilangan nomzodlar',assigned_active_students:'Sizga biriktirilgan faol o‘quvchilar',classes_today:'Bugungi darslar',accounts_due:'To‘lanmagan hisoblar',collection_net:'Qaytarishlardan keyingi tushum',revenue_recognized:'Ko‘rsatilgan xizmat daromadi',followups_due:'Bog‘lanish vaqti kelgan nomzodlar',parent_links:'Ota-ona bog‘lanishlari',balance_due:'To‘lanishi kerak',advance:'Avans',settled_refunds:'Qaytarilgan pul',verified_student:'Tasdiqlangan o‘quvchi'},
 en:{active_groups:'Active groups',available_seats:'Available seats in active groups',active_leads:'Open admissions leads',trials_scheduled:'Leads with a scheduled trial',assigned_active_students:'Your assigned active students',classes_today:'Today’s classes',accounts_due:'Outstanding accounts',collection_net:'Collections after refunds',revenue_recognized:'Revenue for delivered tuition',followups_due:'Admissions follow-ups due',parent_links:'Parent links',balance_due:'Amount due',advance:'Advance',settled_refunds:'Settled refunds',verified_student:'Verified student'},
};
labels.uz.incomplete_attendance='Tugallanmagan davomat · oxirgi 7 kun';
labels.en.incomplete_attendance='Incomplete attendance · last 7 days';
/** The model cannot supply amounts, links, approval flags or an executable command. */
export function academyAiPanel(ctx,{endpoint,action='daily_brief',studentId,onDraft}={}){
 if(ctx.session?.assistantEnabled!==true)return null;
 const uz=ctx.locale==='uz',t=(a,b)=>uz?a:b,words=labels[uz?'uz':'en'];
 const status=el('p',{role:'status'}),body=el('div',{class:'space-y-3'});
 const question=el('input',{class:'input',type:'text',maxlength:1000,'data-workflow-question':'',placeholder:t('Masalan: davomat jarayonini tushuntir','For example: explain the attendance workflow')});
 const workflow=el('select',{class:'input','data-workflow-selector':''},el('option',{value:''},t('Mos jarayonni tanlash','Choose a relevant workflow')));
 const workflowField=el('label',{class:'grid gap-1',hidden:true},t('Jarayon','Workflow'),workflow);
 const run=el('button',{type:'button',class:'btn-secondary'},t('Dalillarni ko‘rish','Review evidence'));
 const node=el('details',{class:'card space-y-3 p-4','data-academy-ai':''},
  el('summary',{class:'cursor-pointer font-semibold'},action==='parent_message_draft'?t('RIWI — xabar qoralamasi','RIWI — message draft'):t('RIWI — hisobdagi dalillar','RIWI — evidence from your records')),
  el('p',{},t('Bu yordamchi ma’lumotni o‘qiydi va qoralama beradi. Pul yozmaydi va xabar yubormaydi.',
   'This assistant reads facts and prepares drafts. It cannot post money or send messages.')),
  action!=='parent_message_draft'?el('label',{class:'grid gap-1'},t('Qaysi qadam bo‘yicha yordam kerak?','Which step do you need help with?'),question):null,
  workflowField,run,status,body);
 listen(run,'click',async()=>{
  if(run.disabled)return;run.disabled=true;question.disabled=true;workflow.disabled=true;status.textContent=ctx.dict.common.loading;
  try{
   const result=await api.request(endpoint,{method:'POST',signal:ctx.signal,body:{action,locale:ctx.locale,
    ...question.value.trim()?{question:question.value.trim()}:{},...workflow.value?{workflowId:workflow.value}:{},...studentId?{studentId}:{}}});
   if(ctx.signal.aborted)return;
   if(result.brand!=='RIWI'||result.canExecute!==false||!Array.isArray(result.evidence))throw Error('invalid_proposal');
   if(result.evidence.some(row=>!Number.isSafeInteger(row.value)||!/^\/app(?:\/|#|$)/.test(row.sourceHref)))throw Error('invalid_evidence');
   const guidance=result.workflows??[];
   if(!Array.isArray(guidance)||guidance.some(row=>!/^\/app(?:\/|#|$)/.test(row.href)||typeof row.title!=='string'||
    !['inputs','automatic','review','outputs'].every(key=>Array.isArray(row[key])&&row[key].every(text=>typeof text==='string'))))throw Error('invalid_workflow');
   const entries=result.evidence.map(row=>el('li',{},el('a',{href:row.sourceHref,class:'underline'},
    (words[row.kind]??t('Dalil','Evidence'))+': '+(row.unit==='UZS'?paymentMoney(row.value,ctx.locale):row.value))));
   body.replaceChildren(el('ul',{class:'space-y-2'},entries));
   for(const row of guidance){
    body.append(el('section',{class:'space-y-3','data-workflow':row.id},el('h3',{class:'font-semibold'},row.title),el('p',{},row.trigger),
     ...[['inputs',t('Kerakli ma’lumot','Required input')],['automatic',t('Sayt o‘zi bajaradi','The site handles')],
      ['review',t('Tekshirish kerak','Review')],['outputs',t('Natija','Output')]].map(([key,title])=>
       el('div',{},el('h4',{class:'font-semibold'},title),el('ol',{class:'list-decimal pl-5'},row[key].map(text=>el('li',{},text))))),
     el('a',{href:row.href,class:'btn-secondary'},t('Tegishli bo‘limni ochish','Open workspace'))));
   }
   if(Array.isArray(result.availableWorkflows)){
    const selected=workflow.value;
    workflow.replaceChildren(el('option',{value:''},t('Mos jarayonni tanlash','Choose a relevant workflow')),
     ...result.availableWorkflows.filter(row=>/^[a-z_]{1,40}$/.test(row.id)&&typeof row.title==='string').map(row=>el('option',{value:row.id},row.title)));
    workflow.value=[...workflow.options].some(option=>option.value===selected)?selected:'';
    workflowField.hidden=result.availableWorkflows.length<2;
   }
   if(result.draftText){
    if(result.approvalRequired!==true)throw Error('approval_missing');
    const text=el('textarea',{readonly:true,rows:4,class:'input','aria-label':t('Xabar qoralamasi','Message draft')});text.value=result.draftText;
    body.append(el('label',{class:'grid gap-2'},t('Yuborishdan oldin tekshiring','Review before sending'),text));
    if(onDraft){const apply=el('button',{type:'button',class:'btn-secondary'},t('Qoralamani formaga olish','Use draft in composer'));
     listen(apply,'click',()=>onDraft(result.draftText),ctx.signal);body.append(apply);}
   }
   status.textContent=(question.value.trim()&&result.questionMatched===false?t('Umumiy jarayon ko‘rsatildi. Kerakli jarayonni ro‘yxatdan tanlang. ','A general workflow is shown. Choose the relevant process from the list. '):'')+
    t('Dalil vaqti: ','Evidence time: ')+paymentDate(result.observedAt,ctx.locale,'—');
  }catch{if(!ctx.signal.aborted){body.replaceChildren();status.textContent=t('Yordamchi hozir javob bermadi. Asosiy to‘lov va dars amallari ishlashda davom etadi.','The assistant is unavailable. Payments and lessons continue to work.');}}
  finally{run.disabled=false;question.disabled=false;workflow.disabled=false;}
 },ctx.signal);return node;
}
