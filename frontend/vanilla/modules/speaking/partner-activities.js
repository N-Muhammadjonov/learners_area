import {el} from '../../js/dom.js';

const prompts={
 picture:[
  'Describe the park. What could happen next?',
  'Describe the weather and the landscape. Would you visit this place?',
  'Describe this street. What changes would make it a better place to live?'
 ],
 taboo:['Library · avoid: books, read, quiet','Train · avoid: railway, station, travel','Birthday · avoid: cake, candles, party'],
 truths:[
  'Say two true things and one invented thing about a trip. Your partner guesses the invented one.',
  'Say two truths and one lie about your childhood hobbies. Your partner asks a follow-up question.',
  'Describe three things you did this week. Make one up. Switch roles after the guess.'
 ]
};
const kinds=['picture','taboo','truths','mock'];
const mockParts=[0,1,1,2];

function scene(variant){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 320 112');svg.setAttribute('aria-hidden','true');
 const shape=(tag,attrs)=>{
  const n=document.createElementNS(svg.namespaceURI,tag);
  for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);
  svg.append(n);
 };
 shape('rect',{width:320,height:112,rx:8,fill:'#badff9'});
 shape('circle',{cx:260,cy:23,r:14,fill:'#ffcc60'});
 shape('path',{d:variant===1?'M0 84L68 29l53 43 56-48 87 70 56-43v61H0Z':'M0 83q80-38 167 0t153 0v29H0Z',fill:'#65a996'});
 if(variant===2){
  for(let x=14;x<280;x+=65){
   shape('rect',{x,y:43,width:46,height:53,rx:2,fill:x%2?'#9b597d':'#ab6c60'});
   for(let i=0;i<3;i++)shape('rect',{x:x+8+i*12,y:53,width:7,height:11,fill:'#fff1c9'});
  }
  shape('path',{d:'M0 97h320v15H0Z',fill:'#627182'});
 }else if(variant===0){
  for(let x=28;x<260;x+=85){
   shape('rect',{x,y:49,width:6,height:40,fill:'#6f563e'});
   shape('circle',{cx:x+3,cy:44,r:19,fill:'#3e8672'});
  }
  shape('path',{d:'M115 112l40-32 14 1-18 31Z',fill:'#fff1c9'});
 }else{
  shape('path',{d:'M40 112q64-32 133-19l72 19Z',fill:'#4f96be'});
 }
 return svg;
}

export function partnerActivity({activity,t,me,sessionId,connected,busy,act,button}){
 const box=el('section',{class:'lp-activity card','data-partner-activity':''},el('h3',{},t.activities));
 const control=el('div',{class:'lp-action-row'});
 const send=(action,extra={})=>void act({action,sessionId,version:activity.version,...extra});
 const actionButton=(label,action,extra={},css='btn-secondary')=>button(label,()=>send(action,extra),css,{disabled:!connected||busy});
 const {kind}=activity,liveMock=kind==='mock'&&['proposal','running'].includes(activity.phase);
 if(!liveMock){
  for(const mode of kinds)control.append(actionButton(t.kinds[mode],'activity_start',{kind:mode}));
  box.append(control);
 }
 if(!kind)return box;
 const panel=el('div',{class:'lp-shared-content'},el('strong',{},t.kinds[kind]));
 if(kind==='question')panel.append(el('p',{},activity.question.prompt_text),activity.question.cue_card?el('p',{class:'whitespace-pre-line'},activity.question.cue_card):null);
 else if(kind==='mock'){
  const examiner=activity.owner===me;
  panel.append(el('p',{},examiner?t.examiner:t.candidate));
  if(activity.phase==='proposal')panel.append(examiner?el('p',{},t.mockWaiting):actionButton(t.acceptMock,'activity_next',{},'btn-primary'));
  if(activity.phase==='running'){
   const question=activity.questions[mockParts[activity.step]];
   panel.append(el('strong',{},t.mockStages[activity.step]),el('p',{},question.prompt_text),
    question.cue_card?el('p',{class:'whitespace-pre-line'},question.cue_card):null,
    el('output',{class:'lp-clock','data-partner-clock':'',role:'timer','aria-live':'off'}));
   if(examiner)panel.append(actionButton(t.nextStage,'activity_next',{},'btn-primary'));
  }
  if(activity.phase==='scoring'){
   if(!examiner)panel.append(el('p',{},t.mockWaitingScore));
   else{
    const form=el('form',{class:'lp-bands'}),fields=t.criteria.map(label=>{
     const select=el('select',{class:'input','aria-label':label},...Array.from({length:19},(_,i)=>el('option',{value:i,selected:i===12},String(i/2))));
     form.append(el('label',{},label,select));return select;
    });
    form.append(el('button',{type:'submit',class:'btn-primary',disabled:!connected||busy},t.saveScore));
    form.addEventListener('submit',event=>{event.preventDefault();if(connected&&!busy)send('mock_score',{bands:fields.map(field=>Number(field.value))});});
    panel.append(form);
   }
  }
  if(activity.phase==='finished'){
   const scores=activity.bands.map(value=>value/2);
   panel.append(el('p',{},t.practiceResult+' · '+(Math.round(scores.reduce((a,b)=>a+b,0)/2)/2).toFixed(1)),
    el('ul',{},...scores.map((value,i)=>el('li',{},t.criteria[i]+' · '+value.toFixed(1)))));
  }
 }else{
  if(kind==='picture')panel.append(scene(activity.variant));
  panel.append(el('p',{},prompts[kind]?.[activity.variant]??''));
 }
 if(kind!=='mock'||activity.phase!=='finished')panel.append(actionButton(t.stopActivity,'activity_stop'));
 box.append(panel);return box;
}
