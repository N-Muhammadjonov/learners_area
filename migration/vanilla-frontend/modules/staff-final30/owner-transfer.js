import {el,listen,mountStaff,errorText,heading} from './kit.js';
import {transferInfo,transferOwnership} from '../../js/adapters/staff-final30/owner.js';
/**
 * Source: owner/transfer/page.tsx + OwnershipTransferForm.tsx. Server-authoritative: the form has NO extra
 * confirmation dialog in the source (email + keepRole + the owner's password re-entered, button disabled until
 * email and password are present). That is preserved exactly. The password lives only in the DOM input and is
 * wiped on success, on abort/navigation, and never copied into route state.
 */
export const mount=mountStaff({name:'management-transfer',roles:['owner'],load:ctx=>transferInfo(ctx.signal),
 render(ctx,data,view){
  const {dict,signal}=ctx,t=dict.owner,S=(ctx.state.transfer??={done:false,email:'',keepRole:'admin'});
  const warn=el('p',{class:'rounded-sm bg-band-warn/10 p-3 text-xs leading-relaxed text-band-warn'},t.transferWarning);
  const wrap=body=>el('div',{class:'mx-auto flex max-w-xl flex-col gap-4'},el('h1',{class:'font-display text-2xl text-ink-900'},t.transfer),warn,body);
  if(S.done)return wrap(el('div',{class:'card p-5 text-sm text-band-good',role:'status'},t.transferDone));
  const email=el('input',{id:'transfer-email',type:'email',autocomplete:'off',class:'input'}),pw=el('input',{id:'transfer-password',type:'password',autocomplete:'current-password',class:'input'});
  email.value=S.email;
  const role=el('select',{id:'transfer-role',class:'input'},['admin','teacher','student'].map(r=>el('option',{value:r},`${dict.people.role}: ${r[0].toUpperCase()+r.slice(1)}`)));role.value=S.keepRole;
  const err=el('p',{role:'alert',hidden:true,class:'text-xs text-band-bad'}),btn=el('button',{type:'button',class:'btn-primary',disabled:true},t.transferConfirm);
  const lab=(id,text)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},text);
  const sync=()=>{btn.disabled=!email.value.trim()||!pw.value;};
  listen(email,'input',()=>{S.email=email.value;sync();},signal);listen(pw,'input',sync,signal);listen(role,'change',()=>{S.keepRole=role.value;},signal);
  signal.addEventListener('abort',()=>{pw.value='';},{once:true});
  let busy=false;
  listen(btn,'click',async()=>{if(busy||btn.disabled||signal.aborted)return;busy=true;[email,pw,role,btn].forEach(n=>n.disabled=true);btn.textContent=dict.common.saving;err.hidden=true;
   try{await transferOwnership({email:email.value,password:pw.value,keepRole:role.value},signal);if(signal.aborted)return;pw.value='';S.done=true;view.rerender();void ctx.refresh?.();}
   catch(e){if(signal.aborted)return;err.textContent=`${t.transferFailed} ${errorText(e,dict)}`;err.hidden=false;}
   finally{busy=false;if(!signal.aborted&&!S.done){[email,pw,role].forEach(n=>n.disabled=false);btn.textContent=t.transferConfirm;sync();}}},signal);
  return wrap(el('div',{class:'card flex flex-col gap-3 p-5'},el('div',{},lab('transfer-email',t.transferTarget),email),el('div',{},lab('transfer-role',t.roleAfterTransfer),role),el('div',{},lab('transfer-password',t.passwordLabel),pw,el('p',{class:'mt-1 text-xs text-ink-300'},data.ownerEmail)),err,btn));
 }});
