import {el} from '../dom.js';
/** One responsive backdrop: original blue artwork on phones/portrait tablets, scenery on wide screens. */
export function landscape(){
 return el('div',{class:'la-public-background','aria-hidden':'true'},
  el('div',{class:'la-blue-backdrop la-welcome-cosmos'},el('span',{class:'la-welcome-ring la-welcome-ring-one'}),el('span',{class:'la-welcome-ring la-welcome-ring-two'}),el('span',{class:'la-welcome-aurora'})),
  el('div',{class:'la-landscape'},el('img',{src:'/brand/welcome-landscape.jpg',alt:'',width:736,height:1571,decoding:'async',draggable:false})));
}
