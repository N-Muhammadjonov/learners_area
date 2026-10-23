import {api} from '../../js/api-client.js';import {render} from '../../js/generated/ListeningSpeedPractice-v8.js';import {activityResult} from '../../js/adapters/listening-activity-v8.js';import {viewLifetime} from './view-lifetime.js';
/* Local speed-practice state (rate, typed answers, last result, panel open) is kept in the router-owned context.state.
   A successful Check calls context.refresh() to pick up the server's unlock ladder; the router keeps context.state across
   a refresh and clears it on normal navigation, so the typed answer, score line and open panel survive the refresh
   as they do in the original client component (router.refresh keeps client state). */
export function listeningSpeedPractice(context,p){const {dict,signal}=context,host=document.createElement('div'),audio={current:null},view=viewLifetime(context,host,audio);
 const bag=context.state??{},memory=(bag.speedPractice??={})[p.id]??={rate:null,answers:{},result:'',open:false};
 let rate=p.allowed.includes(memory.rate)?memory.rate:(p.allowed.at(-1)??1),answers=memory.answers,result=memory.result,busy=false;
 function remember(){memory.rate=rate;memory.answers=answers;memory.result=result;}
 function draw(){if(signal.aborted)return;const details=host.querySelector('details');if(details)memory.open=details.open;view.begin();const node=render({...p,dict,audio,rate,answers,result,busy,setRate:v=>{if(p.allowed.includes(v)){rate=v;remember();}},setAnswers:v=>{answers=typeof v==='function'?v(answers):v;remember();},setResult:v=>{result=v;remember();draw();},check});if(memory.open)node.open=true;view.commit(node);if(audio.current)audio.current.playbackRate=rate;}
 async function check(){if(busy||signal.aborted)return;busy=true;draw();try{if(!p.allowed.includes(rate))throw Error();const data=activityResult(await api.request(`/api/listening/full/${p.id}/activity`,{method:'POST',timeoutMs:12000,body:{activity:2,speedRate:rate,answers:{...answers},complete:true},signal}));if(signal.aborted)return;result=`${data.score} / ${data.total}`;remember();context.refresh();}catch{if(!signal.aborted){result=dict.fullListeningHub.speed.failed;remember();}}finally{busy=false;draw();}}
 draw();return host;}
