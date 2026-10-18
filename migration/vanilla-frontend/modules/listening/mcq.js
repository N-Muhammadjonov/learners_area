import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {render,empty} from '../../js/generated/McqMastery.js';
import {mcqPayload,canAdvance} from '../../js/adapters/mcq.js';
/** Every transition/reveal/outcome is server-authoritative. No local grading. */
export function mcqMastery(context,{questions:initial,audioUrl,dayNavigation}){
 const {dict,signal}=context,host=el('div',{'data-native-mcq':''});let questions=initial.map(q=>({...q})),open=null,payload=null,text='',error=null,busy=false,revision=0;
 function sync(){const b=host.querySelector('[data-mcq-advance]');if(b)b.disabled=busy||!canAdvance(payload,text);host.setAttribute('aria-busy',String(busy));}
 function setText(next){text=next;sync();}
 // Delegate option changes at capture time: read current native checked state,
 // not source render-closure text. No repaint/focus/audio reset per keystroke.
 host.addEventListener('change',e=>{if(!e.target.matches?.('[data-mcq-option]')||payload?.session.stage!=='revealed')return;e.stopImmediatePropagation();const selected=[...host.querySelectorAll('[data-mcq-option]:checked')].map(n=>n.getAttribute('data-mcq-option'));text=payload.multiple?JSON.stringify(selected):selected[0]??'';sync();},{capture:true});
 function draw(){if(signal.aborted)return;if(!questions.length){host.replaceChildren(empty({dict}));sync();return;}const previous=host.querySelector('audio'),nextView=render({questions,open,payload,text,error:open?error:null,busy,openDrill,advance,setText,dict,dayNavigation,audioUrl}),next=nextView.querySelector?.('audio');if(previous&&next&&next.src===previous.src)next.replaceWith(previous);else if(previous){previous.pause();previous.removeAttribute('src');previous.load();}host.replaceChildren(nextView);if(error&&!open)host.append(el('p',{role:'alert',class:'mt-2 text-sm text-band-bad'},error));if(error)host.querySelectorAll('p.text-band-bad').forEach(n=>n.setAttribute('role','alert'));sync();}
 async function openDrill(id){if(busy||signal.aborted)return;const version=++revision;busy=true;error=null;text='';draw();try{const data=mcqPayload(await api.request('/api/listening/mcq',{method:'POST',body:{questionId:id},signal}),id);if(version!==revision||signal.aborted)return;payload=data;open=id;}catch(e){if(!signal.aborted)error=dict.common.error;}finally{if(version===revision){busy=false;draw();}}}
 async function advance(){if(busy||signal.aborted||!canAdvance(payload,text))return;busy=true;error=null;const version=++revision,step=payload.next;sync();try{const next=mcqPayload(await api.request(`/api/listening/mcq/${encodeURIComponent(payload.session.id)}`,{method:'PATCH',body:{step:step.to,...(step.field?{text}:{})},signal}),payload.question.id,payload.session.id);if(signal.aborted||version!==revision)return;payload=next;text='';questions=questions.map(q=>q.id===next.question.id?{...q,stage:next.session.stage}:q);if(next.session.stage==='reasoned'&&dayNavigation){void context.navigate(dayNavigation.currentHref,{replace:true,scroll:false});return;}}catch{if(!signal.aborted)error=dict.common.error;}finally{if(version===revision){busy=false;draw();}}}
 function dispose(){revision++;host.querySelectorAll('audio').forEach(a=>{a.pause();a.removeAttribute('src');a.load();});host.replaceChildren();}
 signal.addEventListener('abort',dispose,{once:true});if(signal.aborted)dispose();else draw();return host;
}
