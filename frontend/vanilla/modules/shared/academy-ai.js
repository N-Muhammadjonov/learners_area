import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {paymentMoney,paymentDate} from '../payments/format.js';

const labels={
 uz:{classes_today:'Bugungi darslar',accounts_due:'To‘lanmagan hisoblar',collection_net:'Qaytarishlardan keyingi tushum',revenue_recognized:'Ko‘rsatilgan xizmat daromadi',followups_due:'Bog‘lanish vaqti kelgan nomzodlar',parent_links:'Ota-ona bog‘lanishlari',balance_due:'To‘lanishi kerak',advance:'Avans',settled_refunds:'Qaytarilgan pul',verified_student:'Tasdiqlangan o‘quvchi'},
 en:{classes_today:'Today’s classes',accounts_due:'Outstanding accounts',collection_net:'Collections after refunds',revenue_recognized:'Revenue for delivered tuition',followups_due:'Admissions follow-ups due',parent_links:'Parent links',balance_due:'Amount due',advance:'Advance',settled_refunds:'Settled refunds',verified_student:'Verified student'},
};
/** The model cannot supply amounts, links, approval flags or an executable command. */
export function academyAiPanel(ctx,{endpoint,action='daily_brief',studentId,onDraft}={}){
 if(ctx.session?.assistantEnabled!==true)return null;
 const uz=ctx.locale==='uz',t=(a,b)=>uz?a:b,words=labels[uz?'uz':'en'];
 const status=el('p',{role:'status'}),body=el('div',{class:'space-y-3'});
 const run=el('button',{type:'button',class:'btn-secondary'},t('Dalillarni ko‘rish','Review evidence'));
 const node=el('details',{class:'card space-y-3 p-4','data-academy-ai':''},
  el('summary',{class:'cursor-pointer font-semibold'},action==='parent_message_draft'?t('RIWI — xabar qoralamasi','RIWI — message draft'):t('RIWI — hisobdagi dalillar','RIWI — evidence from your records')),
  el('p',{},t('Bu yordamchi ma’lumotni o‘qiydi va qoralama beradi. Pul yozmaydi va xabar yubormaydi.',
   'This assistant reads facts and prepares drafts. It cannot post money or send messages.')),run,status,body);
 listen(run,'click',async()=>{
  if(run.disabled)return;run.disabled=true;status.textContent=ctx.dict.common.loading;
  try{
   const result=await api.request(endpoint,{method:'POST',signal:ctx.signal,body:{action,locale:ctx.locale,...studentId?{studentId}:{}}});
   if(ctx.signal.aborted)return;
   if(result.brand!=='RIWI'||result.canExecute!==false||!Array.isArray(result.evidence))throw Error('invalid_proposal');
   if(result.evidence.some(row=>!Number.isSafeInteger(row.value)||!/^\/app(?:\/|#|$)/.test(row.sourceHref)))throw Error('invalid_evidence');
   const entries=result.evidence.map(row=>el('li',{},el('a',{href:row.sourceHref,class:'underline'},
    (words[row.kind]??t('Dalil','Evidence'))+': '+(row.unit==='UZS'?paymentMoney(row.value,ctx.locale):row.value))));
   body.replaceChildren(el('ul',{class:'space-y-2'},entries));
   if(result.draftText){
    if(result.approvalRequired!==true)throw Error('approval_missing');
    const text=el('textarea',{readonly:true,rows:4,class:'input','aria-label':t('Xabar qoralamasi','Message draft')});text.value=result.draftText;
    body.append(el('label',{class:'grid gap-2'},t('Yuborishdan oldin tekshiring','Review before sending'),text));
    if(onDraft){const apply=el('button',{type:'button',class:'btn-secondary'},t('Qoralamani formaga olish','Use draft in composer'));
     listen(apply,'click',()=>onDraft(result.draftText),ctx.signal);body.append(apply);}
   }
   status.textContent=t('Dalil vaqti: ','Evidence time: ')+paymentDate(result.observedAt,ctx.locale,'—');
  }catch{if(!ctx.signal.aborted){body.replaceChildren();status.textContent=t('Yordamchi hozir javob bermadi. Asosiy to‘lov va dars amallari ishlashda davom etadi.','The assistant is unavailable. Payments and lessons continue to work.');}}
  finally{run.disabled=false;}
 },ctx.signal);return node;
}
