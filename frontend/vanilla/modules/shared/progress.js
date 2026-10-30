import {el} from '../../js/dom.js';

/** Percentages describe saved work only. Unknown totals and unopened items have no percentage. */
export function progressRatio(state,done,total){
 if(state!=='in_progress'||!Number.isFinite(done)||done<0||!Number.isFinite(total)||total<=0)return '';
 const count=Math.min(done,total);
 return `${count}/${total} · ${Math.round(count/total*100)}%`;
}
export function answerProgress({state,done,total,label,attrs={}}){
 const ratio=progressRatio(state,done,total);
 return el('span',{...attrs,class:`learning-progress${state==='in_progress'?' learning-progress-active':''}`,title:label},
  state==='completed'?'✓ ':null,ratio||label);
}
export function videoProgressText(state,watched,duration,label){
 if(state!=='in_progress'||!Number.isFinite(watched)||watched<0)return label;
 const seconds=Math.floor(watched),clock=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 return Number.isFinite(duration)&&duration>0?`${label} · ${clock} / ${Math.min(100,Math.round(watched/duration*100))}%`:`${label} · ${clock}`;
}
