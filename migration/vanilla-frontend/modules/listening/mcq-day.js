import {el} from '../../js/dom.js';import {viewData} from '../../js/adapters/frontend.js';import {mcqDay} from '../../js/adapters/mcq.js';import {render} from '../../js/generated/ListeningMcqDayPage.js';import {mcqActivePosition,MCQ_FINAL_STAGE} from '../../js/generated/mcq-position.js';import {mcqMastery} from './mcq.js';import {ListeningSequenceLocked} from '../../js/generated/listening-locked.js';import {RegionFailureNotice} from '../shared/presentation.js';
export function mount(context){const {root,dict,url,signal}=context,host=el('div',{'data-native-mcq-day':''},el('p',{role:'status'},dict.common.loading));root.append(host);let busy=false;
 async function missing(){const view=await import('../not-found.js');if(!signal.aborted){host.replaceChildren();await view.mount({...context,root:host});};}
 async function load(){if(busy||signal.aborted)return;busy=true;try{const data=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
  if(data.kind==='locked'){host.replaceChildren(ListeningSequenceLocked({dict,mcq:true}));return;}
  if(data.kind==='not_found'||data.day===null){await missing();return;}
  const day=mcqDay(data.day,Number.parseInt(url.pathname.split('/').at(-1),10),context.session.user.role),questions=day.questions,requested=Number.parseInt(url.searchParams.get('q')??'',10),activeIndex=mcqActivePosition(questions,Number.isInteger(requested)?requested:null)-1,active=questions[activeIndex]??null;
  host.replaceChildren(render({day,dict,t:dict.listening.mcqProgram,questions,activeIndex,active,complete:questions.length>0&&day.status.state==='completed',MCQ_FINAL_STAGE,McqMastery:props=>mcqMastery(context,props)}));
 }catch(e){if(signal.aborted)return;if(e.status===404){await missing();return;}host.replaceChildren(el('div',{'data-integration-required':'mcq-day'},RegionFailureNotice({region:'mcq-day',message:dict.common.error,retryLabel:dict.common.retry,refresh:load})));}finally{busy=false;}}
 void load();
}
