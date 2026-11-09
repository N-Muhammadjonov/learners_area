import {el} from '../../js/dom.js';
const NS='http://www.w3.org/2000/svg';let serial=0;
function shape(tag,attrs={},...children){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));n.append(...children);return n;}
/** Original LA companion. Decorative only: no audio, media, timers or listeners. */
export function speakingMascot({state='idle'}={}){
 const id='la-companion-'+(++serial),node=el('span',{class:'la-mascot','data-mascot-state':['idle','loading','success'].includes(state)?state:'idle','aria-hidden':'true'});
 node.append(shape('svg',{viewBox:'0 0 144 132',width:144,height:132,fill:'none',focusable:'false'},
  shape('defs',{},shape('linearGradient',{id,x1:18,y1:15,x2:125,y2:115,gradientUnits:'userSpaceOnUse'},shape('stop',{'stop-color':'#b7a5ff'}),shape('stop',{offset:1,'stop-color':'#5853cf'}))),
  shape('ellipse',{cx:72,cy:120,rx:36,ry:5,fill:'currentColor',opacity:.1}),
  shape('path',{d:'M72 25V14',stroke:'#8b79e8','stroke-width':4,'stroke-linecap':'round'}),shape('circle',{cx:72,cy:11,r:5,fill:'#59ddcf'}),
  shape('rect',{x:16,y:54,width:15,height:29,rx:7,fill:'#7e70cb'}),shape('rect',{x:113,y:54,width:15,height:29,rx:7,fill:'#7e70cb'}),
  shape('rect',{x:27,y:28,width:90,height:80,rx:28,fill:'url(#'+id+')'}),
  shape('rect',{x:36,y:39,width:72,height:53,rx:19,fill:'#182641',stroke:'#c7bdff','stroke-width':2}),
  shape('g',{class:'la-mascot__eyes',fill:'#88f2df'},shape('rect',{x:50,y:55,width:10,height:15,rx:5}),shape('rect',{x:84,y:55,width:10,height:15,rx:5})),
  shape('path',{class:'la-mascot__smile',d:'M62 79q10 8 20 0',stroke:'#88f2df','stroke-width':3,'stroke-linecap':'round'}),
  shape('path',{d:'m51 105-5 10m47-10 5 10',stroke:'#8070d4','stroke-width':7,'stroke-linecap':'round'}),
  shape('path',{d:'m121 24 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z',fill:'#59ddcf'})));
 return node;
}
