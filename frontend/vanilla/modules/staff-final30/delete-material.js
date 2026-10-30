/** Ported from main src/components/admin/DeleteMaterialButton.tsx. */
import {el,listen,setChildren} from './kit.js';
import {rawJson,UUID} from '../../js/adapters/staff-final30/core.js';
const KINDS=['reading','reading-set','listening','video','writing','writing-lesson','writing-model-text','writing-pattern','writing-translation','speaking','speaking-prompt'];
export function materialDelete(ctx,{type,id,backTo}){
 if(!KINDS.includes(type)||!UUID.test(id))return null;
 const {dict,signal,navigate}=ctx,t=dict.admin.materialDeletion??(ctx.locale==='uz'?{confirm:"Rostdan o'chirasizmi?",failed:"O'chirib bo'lmadi."}:{confirm:'Delete this material?',failed:'Unable to delete this material.'});
 let busy=false,confirming=false,failed=false;
 const host=el('span',{class:'inline-flex flex-wrap items-center gap-2','data-material-delete':id});
 const paint=()=>{
  const open=el('button',{type:'button',class:'btn-secondary text-sm',disabled:busy},dict.common.delete);
  listen(open,'click',()=>{confirming=true;paint();},signal);
  const yes=el('button',{type:'button',class:'btn-secondary',disabled:busy,'data-material-delete-confirm':''},busy?dict.common.loading:dict.common.delete);
  const no=el('button',{type:'button',class:'btn-secondary',disabled:busy},dict.common.cancel);
  listen(no,'click',()=>{confirming=false;paint();},signal);
  listen(yes,'click',async()=>{
   if(busy||signal.aborted)return;
   busy=true;failed=false;paint();
   try{
    const result=await rawJson('DELETE',`/api/admin/content/${type}/${id}`,undefined,signal);
    if(signal.aborted)return;
    if(!result.ok)throw new Error('delete rejected');
    confirming=false;
    if(backTo)await navigate(backTo);else await ctx.refresh?.();
   }catch{if(signal.aborted)return;failed=true;}
   finally{busy=false;if(!signal.aborted)paint();}
  },signal);
  setChildren(host,open,confirming?el('span',{class:'w-full space-y-2 rounded-xl border border-ink-100 p-3',role:'alert'},el('span',{class:'block'},t.confirm),yes,no):null,failed?el('span',{role:'status'},t.failed):null);
 };
 paint();return host;
}
