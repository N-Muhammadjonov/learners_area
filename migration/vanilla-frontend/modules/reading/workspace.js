import {el} from '../../js/dom.js';
/** Original ReadingWorkspace: header with timer, save badge and font size; mobile tabs; two resizable panes; footer. */
export function workspace({tools,passagePane,questionsPane,navigation,action,labels,title,brand,pane,setPane,state,setFont}){
 const root=el('div',{class:'reading-workspace','data-reading-workspace':true,style:{'--reading-split':`${state.split}%`,'--reading-font-size':`${state.fontSize}px`}});
 const fontButton=(label,delta,disabled)=>{const b=el('button',{type:'button','aria-label':label,disabled:disabled?true:null},delta<0?'A−':'A+');b.addEventListener('click',()=>setFont(state.fontSize+delta));return b;};
 root.append(el('header',{class:'reading-workspace-header'},
  el('div',{class:'reading-workspace-identity'},el('span',{class:'reading-workspace-brand'},brand),el('h1',{},title)),
  el('div',{class:'reading-workspace-tools'},tools,el('div',{class:'reading-font-controls'},fontButton(labels.smaller,-1,state.fontSize<=14),fontButton(labels.larger,1,state.fontSize>=22))),
 ));
 const tabs=el('div',{class:'reading-mobile-tabs',role:'tablist','aria-label':title});
 for(const key of ['passage','questions']){const b=el('button',{type:'button',role:'tab','aria-selected':pane===key?'true':'false','aria-controls':`reading-${key}-pane`},labels[key]);b.addEventListener('click',()=>setPane(key));tabs.append(b);}
 root.append(tabs);
 const panels=el('div',{class:'reading-workspace-panels','data-reading-pane':pane});
 panels.append(el('section',{id:'reading-passage-pane',class:'reading-workspace-passage','aria-label':labels.passage},passagePane));
 const divider=el('div',{role:'separator','aria-orientation':'vertical','aria-label':labels.resize,'aria-valuemin':35,'aria-valuemax':70,'aria-valuenow':Math.round(state.split),tabindex:0,class:'reading-workspace-divider'},el('span',{}));
 const constrain=n=>Math.max(35,Math.min(70,n));
 let dragging=false;
 divider.addEventListener('pointerdown',e=>{dragging=true;divider.setPointerCapture(e.pointerId);});
 divider.addEventListener('pointermove',e=>{if(!dragging)return;const box=panels.getBoundingClientRect();if(box.width>0){const next=constrain((e.clientX-box.left)/box.width*100);state.split=next;root.style.setProperty('--reading-split',`${next}%`);divider.setAttribute('aria-valuenow',String(Math.round(next)));}});
 divider.addEventListener('pointerup',e=>{dragging=false;if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);});
 divider.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=constrain(state.split+(e.key==='ArrowLeft'?-2:2));state.split=next;root.style.setProperty('--reading-split',`${next}%`);divider.setAttribute('aria-valuenow',String(Math.round(next)));}});
 panels.append(divider);
 panels.append(el('section',{id:'reading-questions-pane',class:'reading-workspace-questions','aria-label':labels.questions},questionsPane));
 root.append(panels);
 root.append(el('footer',{class:'reading-workspace-footer'},el('nav',{class:'reading-question-navigation','aria-label':labels.questions},navigation),el('div',{class:'reading-workspace-action'},action)));
 return root;
}
