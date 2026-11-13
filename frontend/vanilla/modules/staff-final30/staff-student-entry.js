import {el} from '../../js/dom.js';
import {studentPlanInline} from './student-plan-inline.js';
import {BackLink} from './kit.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admins see only the already-authorized plan completion view.
 * Owner's original full student page and teacher permissions stay unchanged. */
export async function mount(ctx){
 const role=ctx.session?.user?.role;
 if(role==='owner'){
  const {studentMount}=await import('./teacher.js');
  if(!ctx.signal.aborted)return studentMount(ctx);
  return;
 }
 if(role!=='admin')return;
 const id=ctx.url.pathname.split('/').filter(Boolean).at(-1);
 const host=el('div',{class:'mx-auto flex max-w-6xl flex-col gap-5','data-admin-student-plan':''});
 host.append(BackLink({fallbackHref:'/app/admin/people',label:ctx.dict.common.back}));
 if(!UUID.test(id)){
  host.append(el('p',{role:'alert'},ctx.locale==='uz'?'Talaba topilmadi.':'Student not found.'));
 }else{
  host.append(studentPlanInline(ctx,id));
 }
 ctx.root.append(host);
}
