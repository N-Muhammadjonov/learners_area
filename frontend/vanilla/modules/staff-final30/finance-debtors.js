import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {paymentMoney,paymentDate} from '../payments/format.js';

/** The list uses current server balances; it never filters only visible browser rows. */
export function financeDebtors(ctx,onSelect){
 const uz=ctx.locale==='uz',t=(a,b)=>uz?a:b;
 const q=el('input',{type:'search',class:'input',maxlength:120});
 const branch=el('input',{class:'input',maxlength:120});
 const overdue=el('input',{type:'checkbox'});
 const status=el('p',{role:'status'}),rows=el('div',{class:'space-y-3'});
 const button=(label,props={})=>el('button',{type:'button',class:'btn-secondary',...props},label);
 const submit=button(t('Qidirish','Search'),{type:'submit'}),prev=button(t('Oldingi','Previous')),next=button(t('Keyingi','Next'));
 const form=el('form',{class:'flex flex-wrap items-end gap-3'},
  el('label',{class:'grid gap-1'},t('Ism yoki email','Name or email'),q),
  el('label',{class:'grid gap-1'},t('Filial (ixtiyoriy)','Branch (optional)'),branch),
  el('label',{class:'flex gap-2'},overdue,t('Faqat muddati o‘tgan','Overdue only')),submit);
 const host=el('section',{class:'space-y-3','data-finance-debtors':''},
  el('h3',{class:'font-semibold'},t('To‘lanmagan hisoblar','Outstanding accounts')),
  el('p',{},t('Qoldiq barcha davrlar bo‘yicha hozirgi hisobdan olinadi. Filtr o‘quvchining joriy filialiga qaraydi.',
    'Balances are current across all billing periods. Branch filters use current memberships.')),form,status,rows,
  el('div',{class:'flex gap-2'},prev,next));
 let offset=0,ticket=0;
 async function load(){
  const request=++ticket;submit.disabled=true;status.textContent=ctx.dict.common.loading;
  try{
   const result=await api.request('/api/staff/finance/debtors?'+new URLSearchParams({q:q.value.trim(),branch:branch.value.trim(),overdueOnly:overdue.checked,offset,limit:20}),{signal:ctx.signal,fresh:true});
   if(ctx.signal.aborted||request!==ticket)return;
   rows.replaceChildren(...result.items.map(row=>{
    const open=button(t('Hisobni ochish','Open account'));listen(open,'click',()=>onSelect(row.studentId,row.name),ctx.signal);
    return el('article',{class:'card flex flex-wrap items-center justify-between gap-3 p-3'},
     el('div',{},el('h4',{class:'font-semibold'},row.name),
      el('p',{},t('Qarz: ','Outstanding: ')+paymentMoney(row.balanceDueMinor,ctx.locale)),
      el('p',{class:'text-sm'},t('Muddati o‘tgan: ','Overdue: ')+paymentMoney(row.overdueMinor,ctx.locale))),open);
   }));
   if(!result.items.length)rows.append(el('p',{},t('Bu filtrda to‘lanmagan hisob topilmadi.','No outstanding accounts match these filters.')));
   status.textContent=t('Hisob sanasi: ','Business date: ')+paymentDate(result.asOf,ctx.locale,'—')+' · '+t('Topildi: ','Found: ')+result.total;
   prev.disabled=offset===0;next.disabled=!result.pagination.hasMore;
  }catch{if(!ctx.signal.aborted&&request===ticket){status.textContent=t('Ro‘yxat yuklanmadi. Filtrni qayta yuboring.','Could not load accounts. Retry the filter.');}}
  finally{if(request===ticket)submit.disabled=false;}
 }
 listen(form,'submit',event=>{event.preventDefault();offset=0;void load();},ctx.signal);
 listen(prev,'click',()=>{offset=Math.max(0,offset-20);void load();},ctx.signal);
 listen(next,'click',()=>{offset+=20;void load();},ctx.signal);
 host.addEventListener('academy-load',()=>void load(),{signal:ctx.signal});
 return host;
}
