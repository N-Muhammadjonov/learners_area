import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';import {uuid} from '../../js/adapters/listening-v7.js';import {render} from '../../js/generated/FullExamStart-v7.js';
export function fullExamStart(context,{id,title,compact=false}){const {dict,signal}=context,host=document.createElement('div');let busy=false,error='',sound;
 function draw(){
  if(signal.aborted)return;
  if(!compact){host.replaceChildren(render({id,title,dict,busy,error,start,soundCheck}));return;}
  const button=el('button',{type:'button',class:'btn-primary',disabled:busy},dict.fullListeningHub.examStart.start);
  button.addEventListener('click',start,{once:true,signal});
  host.replaceChildren(button);
  if(error)host.append(el('p',{role:'alert'},error));
 }
 async function start(){if(busy||signal.aborted)return;busy=true;error='';draw();try{const data=await api.request(`/api/listening/full/${id}/start`,{method:'POST',timeoutMs:12000,signal});if(!uuid(data.id))throw Error();if(!signal.aborted)await context.navigate('/app/listening/attempts/'+data.id);}catch{if(!signal.aborted){busy=false;error=dict.fullListeningHub.examStart.failed;draw();}}}
 function soundCheck(){if(signal.aborted)return;void sound?.close();try{sound=new AudioContext();const ctx=sound,osc=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=.05;osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.35);osc.onended=()=>void ctx.close();}catch{error=dict.common.error;draw();}}
 signal.addEventListener('abort',()=>{void sound?.close();sound=null;host.replaceChildren();},{once:true});draw();return host;}
