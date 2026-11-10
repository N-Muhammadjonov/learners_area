import {el} from '../../js/dom.js';
import {speakingMascot} from '../shared/mascot.js';
const NS='http://www.w3.org/2000/svg';
function svgNode(tag,attributes){const n=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n;}
export function fluencyIcon(){const svg=svgNode('svg',{viewBox:'0 0 32 32',width:28,height:28,fill:'none','aria-hidden':'true',class:'fluency-hub-icon'});svg.append(svgNode('path',{d:'M8 11h16l4 13-6-2-3-4h-6l-3 4-6 2Z',stroke:'currentColor','stroke-width':1.8,'stroke-linejoin':'round'}),svgNode('path',{d:'M10 11V6m6 5V3m6 8V6M9 15v5m-2-2h4',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round'}));return svg;}
/** @returns {{node:HTMLElement,paint:(state:object,voice?:object)=>void}} */
export function fluencyArena(label){
 const node=el('div',{class:'fluency-arena','data-fluency-arena':'','aria-label':label,role:'img'});
 const waveform=el('div',{class:'fluency-waveform','aria-hidden':'true'}),bars=Array.from({length:21},()=>el('i'));
 waveform.append(...bars);
 const track=el('div',{class:'fluency-hazard-track','aria-hidden':'true'}),hazard=el('div',{class:'fluency-hazard'}),svg=svgNode('svg',{viewBox:'0 0 100 100',class:'fluency-disc',fill:'none',focusable:'false'});
 const teeth=Array.from({length:48},(_,i)=>{const angle=i*Math.PI/24,r=i%2?39:48;return `${50+Math.cos(angle)*r},${50+Math.sin(angle)*r}`;}).join(' ');
 svg.append(svgNode('polygon',{points:teeth,fill:'#cbd1db',stroke:'#ff796c','stroke-width':1.8}),svgNode('circle',{cx:50,cy:50,r:33,fill:'#9ca8b9',stroke:'#f98a7e','stroke-width':2}),svgNode('circle',{cx:50,cy:50,r:12,fill:'#253148',stroke:'#e0e6f0','stroke-width':2}),svgNode('circle',{cx:50,cy:50,r:4,fill:'#e0e6f0'}));hazard.append(svg);track.append(hazard);
 const robot=el('div',{class:'fluency-robot','aria-hidden':'true'}),mascot=speakingMascot();robot.append(mascot);
 node.append(waveform,track,robot,el('div',{class:'fluency-ground','aria-hidden':'true'}));
 let previousProgress=NaN;
 return {node,paint(state,voice={}){
  const p=state.dangerProgress??0;
  for(const [key,value] of Object.entries({phase:state.phase,speaking:String(!!state.speaking),near:String(p>=.72)}))if(node.dataset[key]!==value)node.dataset[key]=value;
  if(p!==previousProgress){node.style.setProperty('--danger',String(p));hazard.style.left=`${p*100}%`;previousProgress=p;}
  const reaction=state.phase==='won'?'won':state.phase==='lost'?'lost':p>=.72?'danger_near':state.speaking?'speaking':'idle';if(mascot.dataset.mascotState!==reaction)mascot.dataset.mascotState=reaction;
  const samples=voice.samples;
  bars.forEach((bar,i)=>{let amplitude=0;if(samples?.length){const start=Math.floor(i*samples.length/bars.length),end=Math.floor((i+1)*samples.length/bars.length);for(let j=start;j<end;j++)amplitude+=samples[j]**2;amplitude=Math.sqrt(amplitude/Math.max(1,end-start));}bar.style.height=`${4+Math.min(1,amplitude/.1)*30}px`;});
 }};
}
