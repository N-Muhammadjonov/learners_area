import {h} from '../../js/native.js';
import {Button} from '../../modules/shared/presentation.js';

const grid=document.querySelector('#sweep'),samples=document.querySelector('#samples');
const query=new URL(location.href).searchParams;
document.documentElement.dataset.theme=query.get('theme')==='night'?'night':'day';
if(query.get('baseline')==='1')document.querySelector('link[href="/modules/shared/design-system.css"]').href='/__baseline/modules/shared/design-system.css';
for(const theme of ['day','night'])document.querySelector('#themes').append(Button({variant:'secondary',children:theme,onClick:()=>{document.documentElement.dataset.theme=theme;}}));
for(let i=1;i<=12;i++)grid.append(h('a',{href:'#destination-'+i,class:'card',draggable:'false','data-sweep':String(i),'aria-label':'Sweep '+i,'data-ui-skill':['listening','reading','writing','speaking'][i%4]},String(i).padStart(2,'0')));
for(const [skill,title,href] of [['listening','Dashboard shortcut','/app/listening/lessons'],['vocabulary','Academic Vocabulary','/app/vocabulary'],['reading','Reading catalogue','/app/reading/academic'],['speaking','Speaking practice','/app/speaking/practice']]){
 samples.append(h('a',{href,class:'card','data-ui-skill':skill,'data-sample':skill},h('h2',{},title),h('p',{},'Native navigation card. Hover to reveal its own arrow.')));
}
const actions=document.querySelector('#actions');
actions.append(Button({children:'Primary action','data-qa-primary':''}),Button({variant:'secondary',children:'Secondary action','data-qa-secondary':''}),Button({children:'Disabled action',disabled:true}),h('a',{href:'#disabled',class:'card p-4','aria-disabled':'true','data-qa-disabled':''},'Disabled card'),Button({variant:'secondary',children:'Selected filter','aria-pressed':'true','data-qa-selected':''}),h('button',{type:'button',class:'la-icon-button','aria-label':'Icon action'},'↗'));
for(const [tag,label,attrs] of [['input','Search',{type:'search',placeholder:'Search materials'}],['select','Category',{}],['textarea','Response',{rows:2}]]){
 const input=h(tag,{class:'input','aria-label':label,...attrs},tag==='select'?h('option',{},'All categories'):null);
 document.querySelector('#fields').append(h('label',{},label,input));
}
for(const [i,title] of ['All','Reading','Speaking'].entries())document.querySelector('#tabs').append(h('button',{type:'button',class:'tab',role:'tab','aria-selected':String(i===0)},title));

// Instrumentation belongs only to this excluded test fixture, never the app.
const evidence={samples:0,wrongOwner:0,seen:[],mutations:0,layoutShifts:0,resources:0};
let last=null,sweepStartedAt=Infinity;
grid.addEventListener('pointermove',event=>{
 const card=event.target.closest('[data-sweep]');if(!card)return;
 if(sweepStartedAt===Infinity)sweepStartedAt=performance.now();
 const hovered=[...grid.querySelectorAll('[data-sweep]:hover')];
 evidence.samples++;
 evidence.resources=performance.getEntriesByType('resource').length;
 if(hovered.length!==1||hovered[0]!==card)evidence.wrongOwner++;
 if(last!==card.dataset.sweep){evidence.seen.push(card.dataset.sweep);last=card.dataset.sweep;}
 document.querySelector('#metrics').value=JSON.stringify(evidence);
});
new MutationObserver(records=>{evidence.mutations+=records.length;}).observe(grid,{subtree:true,childList:true,attributes:true});
if('PerformanceObserver' in window){
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=sweepStartedAt)evidence.layoutShifts+=entry.value;}).observe({type:'layout-shift'});}catch{}
}
