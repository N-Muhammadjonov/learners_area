import {el} from '../../js/dom.js';
/** Original ReadingWorkspace (header with timer, save badge and font size; mobile tabs; two resizable panes; footer)
 * as a PERSISTENT shell. The shell, the two scrolling panes, the divider and the tabs are created once, so a
 * redraw never resets a pane's scroll position or moves the focus away from an answer. `update()` replaces only the
 * slots it is given: a typed answer rebuilds the questions and navigation, never the passage text. */
const VOLATILE=new Set(['data-answered','data-general-save-state','data-save-state','data-time-remaining']);
const SPLIT_MIN=35,SPLIT_MAX=70;
const flat=value=>[value].flat(Infinity).filter(node=>node!=null);
/** Stop the learner-highlight controllers inside a subtree before its DOM is discarded. */
function stopHighlights(node){for(const host of node.querySelectorAll('[data-highlight-host]'))host.stop?.();}
/** Identity of a control across a rebuild: its tag and its stable data attributes (values such as the answered flag change). */
function signature(node){return [node.tagName,...[...node.attributes].filter(a=>a.name.startsWith('data-')&&!VOLATILE.has(a.name)).map(a=>`${a.name}=${a.value}`)].join('|');}
export function createWorkspace({labels,brand,title,state,setPane,setFont}){
 const root=el('div',{class:'reading-workspace','data-reading-workspace':true});
 const brandNode=el('span',{class:'reading-workspace-brand'},brand),titleNode=el('h1',{},title);
 const toolsBox=el('div',{class:'reading-workspace-tools'});
 const fontButton=(label,delta)=>{const b=el('button',{type:'button','aria-label':label},delta<0?'A−':'A+');b.addEventListener('click',()=>setFont(state.fontSize+delta));return b;};
 const smaller=fontButton(labels.smaller,-1),larger=fontButton(labels.larger,1);
 const fontControls=el('div',{class:'reading-font-controls'},smaller,larger);
 root.append(el('header',{class:'reading-workspace-header'},el('div',{class:'reading-workspace-identity'},brandNode,titleNode),toolsBox));
 const tabs=el('div',{class:'reading-mobile-tabs',role:'tablist','aria-label':title});
 const tabButtons={};
 for(const key of ['passage','questions']){const b=el('button',{type:'button',role:'tab','aria-controls':`reading-${key}-pane`},labels[key]);b.addEventListener('click',()=>setPane(key));tabButtons[key]=b;tabs.append(b);}
 root.append(tabs);
 const passageSection=el('section',{id:'reading-passage-pane',class:'reading-workspace-passage','aria-label':labels.passage});
 const questionsSection=el('section',{id:'reading-questions-pane',class:'reading-workspace-questions','aria-label':labels.questions});
 const divider=el('div',{role:'separator','aria-orientation':'vertical','aria-label':labels.resize,'aria-valuemin':SPLIT_MIN,'aria-valuemax':SPLIT_MAX,tabindex:0,class:'reading-workspace-divider'},el('span',{}));
 const panels=el('div',{class:'reading-workspace-panels'},passageSection,divider,questionsSection);
 const navigation=el('nav',{class:'reading-question-navigation','aria-label':labels.questions});
 const action=el('div',{class:'reading-workspace-action'});
 root.append(panels,el('footer',{class:'reading-workspace-footer'},navigation,action));
 const constrain=n=>Math.max(SPLIT_MIN,Math.min(SPLIT_MAX,n));
 const applySplit=next=>{state.split=next;root.style.setProperty('--reading-split',`${next}%`);divider.setAttribute('aria-valuenow',String(Math.round(next)));};
 let dragging=false;
 divider.addEventListener('pointerdown',e=>{dragging=true;divider.setPointerCapture(e.pointerId);});
 divider.addEventListener('pointermove',e=>{if(!dragging)return;const box=panels.getBoundingClientRect();if(box.width>0)applySplit(constrain((e.clientX-box.left)/box.width*100));});
 divider.addEventListener('pointerup',e=>{dragging=false;if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);});
 divider.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();applySplit(constrain(state.split+(e.key==='ArrowLeft'?-2:2)));}});
 let passageNode=null;
 /** Restore focus to the equivalent control after its slot was rebuilt (same id, or the same stable data attributes). */
 function restoreFocus(saved){
  let node=saved.id?document.getElementById(saved.id):null;
  if(!node||!root.contains(node))node=[...root.querySelectorAll(saved.tag)].find(candidate=>signature(candidate)===saved.signature)??null;
  if(!node||!node.isConnected)return;
  node.focus({preventScroll:true});
  if(saved.selection&&typeof node.setSelectionRange==='function')try{node.setSelectionRange(saved.selection.start,saved.selection.end);}catch{}
 }
 /** Patch the given slots. Omitted slots keep their current DOM. Focus inside the workspace survives the patch. */
 function update(parts={}){
  const active=document.activeElement;
  const saved=active&&root.contains(active)?{id:active.id||null,tag:active.tagName,signature:signature(active),selection:typeof active.selectionStart==='number'?{start:active.selectionStart,end:active.selectionEnd}:null}:null;
  if(parts.title!==undefined&&parts.title!==titleNode.textContent)titleNode.textContent=parts.title;
  if(parts.tools){toolsBox.replaceChildren(...flat(parts.tools),fontControls);}
  if(parts.passagePane&&parts.passagePane!==passageNode){stopHighlights(passageSection);passageSection.replaceChildren(parts.passagePane);passageNode=parts.passagePane;}
  if(parts.questionsPane!==undefined){const top=questionsSection.scrollTop,left=questionsSection.scrollLeft;stopHighlights(questionsSection);questionsSection.replaceChildren(...flat(parts.questionsPane));questionsSection.scrollTop=top;questionsSection.scrollLeft=left;}
  if(parts.navigation!==undefined)navigation.replaceChildren(...flat(parts.navigation));
  if(parts.action!==undefined)action.replaceChildren(...flat(parts.action));
  if(parts.pane!==undefined){
   panels.dataset.readingPane=parts.pane;
   for(const key of ['passage','questions']){const selected=parts.pane===key;tabButtons[key].setAttribute('aria-selected',selected?'true':'false');}
  }
  smaller.disabled=state.fontSize<=14?true:null;larger.disabled=state.fontSize>=22?true:null;
  root.style.setProperty('--reading-font-size',`${state.fontSize}px`);
  root.style.setProperty('--reading-split',`${state.split}%`);
  divider.setAttribute('aria-valuenow',String(Math.round(state.split)));
  if(saved)restoreFocus(saved);
 }
 update({pane:state.pane??'passage'});
 return {root,update};
}
