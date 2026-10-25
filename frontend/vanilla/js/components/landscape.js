import {el} from '../dom.js';
/** Keep the supplied photograph intact; CSS turns its portrait storage into a horizontal scene. */
export function landscape(){
 return el('div',{class:'la-landscape','aria-hidden':'true'},el('img',{src:'/brand/welcome-landscape.jpg',alt:'',width:736,height:1571,decoding:'async',fetchpriority:'high',draggable:false}));
}
