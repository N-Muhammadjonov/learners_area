import {anySignal} from '../../js/signals.js';
import {accountResult} from '../../js/adapters/account.js';
import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {failure as failureMessage} from '../../js/request-errors.js';
import {render} from '../../js/generated/ReportProblem.js';

const REPORT_TYPES=new Set(['problem','suggestion','encouragement']);
const TYPE_PREFIX={problem:'',suggestion:'[suggestion] ',encouragement:'[encouragement] '};

export function reportProblem({dict,signal,url,locale},{floating=false}={}){
 const host=el('div');
 const controller=new AbortController();
 const flight=anySignal([signal,controller.signal]);
 let open=false,message='',kind='problem',state='idle',error='',lastError=null;
 const viewport=typeof window==='object'?`${window.innerWidth}×${window.innerHeight}`:'';
 try{
  const code=sessionStorage.getItem('learners-area:last-error');
  lastError=typeof code==='string'&&/^[a-z][a-z0-9_.:-]{0,99}$/i.test(code)?code:null;
 }catch{}
 const pathname=url.pathname,parts=pathname.split('/').filter(Boolean);
 const moduleName=(parts[0]==='app'?parts[1]:parts[0])??'app';
 const setOpen=next=>{
  open=Boolean(typeof next==='function'?next(open):next);
  draw();
  host.querySelector(open?'[data-report-message]':'[data-report-toggle]')?.focus();
 };
 const setKind=next=>{
  if(!REPORT_TYPES.has(next)||flight.aborted)return;
  kind=next;
  if(state!=='sending')state='idle';
  draw();
  host.querySelector('[data-report-kind]')?.focus();
 };
 const setMessage=next=>{
  message=String(next??'').slice(0,1950);
  const button=host.querySelector('[data-report-send]');
  if(button)button.disabled=state==='sending'||message.trim().length<3;
 };
 function draw(){
  if(flight.aborted)return;
  host.replaceChildren(render({dict,locale,floating,open,setOpen,kind,setKind,message,setMessage,state,viewport,lastError,error,pathname,moduleName,send}));
  host.querySelector('[data-report-failed]')?.setAttribute('role','alert');
  host.querySelector('[data-report-sent]')?.setAttribute('role','status');
 }
 async function send(){
  if(flight.aborted||state==='sending'||message.trim().length<3)return;
  state='sending';
  error='';
  draw();
  try{
   const body={route:pathname,module:moduleName,message:TYPE_PREFIX[kind]+message.trim(),viewport:viewport||undefined,lastErrorCode:lastError??undefined};
   accountResult(await api.request('/api/support/reports',{method:'POST',body,signal:flight}),'mutation');
   if(flight.aborted)return;
   message='';
   state='sent';
  }catch(e){
   if(flight.aborted)return;
   error=failureMessage(e,dict);
   state='failed';
  }finally{
   if(state==='sending')state='idle';
   draw();
  }
 }
 const dispose=()=>{controller.abort();signal.removeEventListener('abort',dispose);host.replaceChildren();};
 host.dispose=dispose;
 signal.addEventListener('abort',dispose,{once:true});
 if(signal.aborted)dispose();else draw();
 return host;
}
