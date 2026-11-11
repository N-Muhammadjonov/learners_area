import {el} from '../../js/dom.js';
const NS='http://www.w3.org/2000/svg';
let companionCount=0;
const expressions={
 calm:['M28 35q7-4 13-1m14 0q7-3 13 1','M37 63q13 9 25 0q-10 14-24 2Z'],
 danger_near:['M27 35l13-7m15 0 13 7','M43 66a7 5 0 1 1 14 0a7 5 0 1 1-14 0Z'],
 lost:['M27 37q7-1 14-8m14 0q7 7 14 8','M37 71q13-15 25 0q-13-8-25 0Z']
};
function svgNode(tag,attributes){const n=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));return n;}
export function fluencyIcon(){const svg=svgNode('svg',{viewBox:'0 0 32 32',width:28,height:28,fill:'none','aria-hidden':'true',class:'fluency-hub-icon'});svg.append(svgNode('path',{d:'M8 11h16l4 13-6-2-3-4h-6l-3 4-6 2Z',stroke:'currentColor','stroke-width':1.8,'stroke-linejoin':'round'}),svgNode('path',{d:'M10 11V6m6 5V3m6 8V6M9 15v5m-2-2h4',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round'}));return svg;}

function companion(){
 const id='fluency-companion-'+(++companionCount),colors=id+'-colors';
 const host=el('div',{class:'la-mascot fluency-companion','data-mascot-state':'idle','aria-hidden':'true'});
 const svg=svgNode('svg',{viewBox:'0 0 100 100',focusable:'false'});
 const defs=svgNode('defs',{}),gradient=svgNode('linearGradient',{id:colors,x1:'.16',x2:'.82',y1:'0',y2:'1'});
 for(const [offset,color] of [['0%','#bb9aff'],['44%','#8dbbff'],['71%','#a0e67a'],['100%','#32c878']])gradient.append(svgNode('stop',{offset,'stop-color':color}));
 const faces=[];
 function figure(){
  const face=svgNode('g',{}),eyes=svgNode('g',{class:'fluency-companion-eyes'}),pupils=svgNode('g',{class:'fluency-companion-gaze'});
  face.append(svgNode('path',{d:'M17 18 Q35 31 47 26 Q67 27 84 10 Q91 5 93 13 Q79 36 80 53 Q79 71 92 87 Q95 96 87 94 Q67 80 51 80 Q36 76 19 87 Q12 92 10 85 Q20 65 17 53 Q21 38 10 24 Q8 16 17 18Z',fill:'url(#'+colors+')'}));
  for(const cx of [37,62]){
   eyes.append(svgNode('ellipse',{cx,cy:49,rx:11,ry:12,fill:'#f9fff7'}));
   pupils.append(svgNode('circle',{cx,cy:49,r:6.5,fill:'#18222d'}),svgNode('circle',{cx:cx+2,cy:46,r:2,fill:'#fff'}));
  }
  eyes.append(pupils);
  const brows=svgNode('path',{d:expressions.calm[0],fill:'none',stroke:'#18222d','stroke-width':3,'stroke-linecap':'round'}),
   mouth=svgNode('path',{class:'fluency-companion-mouth',d:expressions.calm[1],fill:'#18222d'});
  face.append(eyes,brows,mouth);faces.push([brows,mouth]);return face;
 }
 defs.append(gradient);
 const body=svgNode('g',{class:'fluency-companion-body'});body.append(figure());
 svg.append(defs,body);
 for(const [side,x] of [['left',0],['right',50]]){
  const clip=id+'-'+side,mask=svgNode('clipPath',{id:clip});mask.append(svgNode('rect',{x,y:0,width:50,height:100}));defs.append(mask);
  const half=svgNode('g',{class:'fluency-companion-half '+side,'data-companion-half':side}),part=svgNode('g',{'clip-path':'url(#'+clip+')'});part.append(figure());half.append(part);svg.append(half);
 }
 host.append(svg);
 return {node:host,react(reaction){
  if(host.dataset.mascotState===reaction)return;
  host.dataset.mascotState=reaction;
  const [browPath,mouthPath]=expressions[reaction]??expressions.calm;
  for(const [brows,mouth] of faces){brows.setAttribute('d',browPath);mouth.setAttribute('d',mouthPath);}
 }};
}
/** @returns {{node:HTMLElement,paint:(state:object,voice?:object)=>void}} */
export function fluencyArena(label){
 const node=el('div',{class:'fluency-arena','data-fluency-arena':'','aria-label':label,role:'img'});
 const waveform=el('div',{class:'fluency-waveform','aria-hidden':'true'}),bars=Array.from({length:21},()=>el('i'));
 waveform.append(...bars);
 const track=el('div',{class:'fluency-hazard-track','aria-hidden':'true'}),hazard=el('div',{class:'fluency-hazard'}),svg=svgNode('svg',{viewBox:'0 0 100 100',class:'fluency-disc',fill:'none',focusable:'false'});
 const teeth=Array.from({length:48},(_,i)=>{const angle=i*Math.PI/24,r=i%2?39:48;return `${50+Math.cos(angle)*r},${50+Math.sin(angle)*r}`;}).join(' ');
 svg.append(svgNode('polygon',{points:teeth,fill:'#cbd1db',stroke:'#ff796c','stroke-width':1.8}),svgNode('circle',{cx:50,cy:50,r:33,fill:'#9ca8b9',stroke:'#f98a7e','stroke-width':2}),svgNode('circle',{cx:50,cy:50,r:12,fill:'#253148',stroke:'#e0e6f0','stroke-width':2}),svgNode('circle',{cx:50,cy:50,r:4,fill:'#e0e6f0'}));hazard.append(svg);track.append(hazard);
 const actor=el('div',{class:'fluency-actor','aria-hidden':'true'}),mascot=companion();actor.append(mascot.node);
 node.append(waveform,track,actor,el('div',{class:'fluency-ground','aria-hidden':'true'}));
 let previousProgress=NaN;
 return {node,paint(state,voice={}){
  const p=state.dangerProgress??0;
  for(const [key,value] of Object.entries({phase:state.phase,speaking:String(!!state.speaking),near:String(p>=.72)}))if(node.dataset[key]!==value)node.dataset[key]=value;
  if(p!==previousProgress){node.style.setProperty('--danger',String(p));hazard.style.left=`${p*100}%`;previousProgress=p;}
  mascot.react(state.phase==='won'?'won':state.phase==='lost'?'lost':p>=.72?'danger_near':state.speaking?'speaking':'idle');
  const samples=state.speaking?voice.samples:null;
  bars.forEach((bar,i)=>{let amplitude=0;if(samples?.length){const start=Math.floor(i*samples.length/bars.length),end=Math.floor((i+1)*samples.length/bars.length);for(let j=start;j<end;j++)amplitude+=samples[j]**2;amplitude=Math.sqrt(amplitude/Math.max(1,end-start));}bar.style.height=`${4+Math.min(1,amplitude/.1)*30}px`;});
 }};
}
