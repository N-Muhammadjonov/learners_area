import {el,listen} from '../../js/dom.js';
/** A presentation-only divider. Moving panes never remounts inputs or drafts. */
export function cdSplit(left,right,signal){
 const host=el('div',{class:'cd-split'}),divider=el('div',{class:'cd-divider',role:'separator',tabindex:'0','aria-orientation':'vertical','aria-label':'Resize question and answer panes','aria-valuemin':'25','aria-valuemax':'75','aria-valuenow':'50'},el('span',{'aria-hidden':'true'},'↔'));
 let size=50,dragging=false;
 const resize=value=>{size=Math.max(25,Math.min(75,value));host.style.setProperty('--cd-split',size+'%');divider.setAttribute('aria-valuenow',String(Math.round(size)));};
 listen(divider,'keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();resize(event.key==='Home'?25:event.key==='End'?75:size+(event.key==='ArrowLeft'?-2:2));}},signal);
 listen(divider,'pointerdown',event=>{if(event.button!==0)return;dragging=true;divider.setPointerCapture?.(event.pointerId);event.preventDefault();},signal);
 listen(divider,'pointermove',event=>{if(!dragging)return;const rect=host.getBoundingClientRect();if(rect.width)resize((event.clientX-rect.left)/rect.width*100);},signal);
 listen(divider,'pointerup',()=>dragging=false,signal);listen(divider,'pointercancel',()=>dragging=false,signal);
 host.append(left,divider,right);return host;
}
