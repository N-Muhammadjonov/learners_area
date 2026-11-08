import {el,listen} from '../../js/dom.js';
import {cdSplit} from '../shared/cd-layout.js';

export function writingCd(ctx,{paper,timer,saveStatus,retry,tabs,prompt,questionLabel,minHint,materialHost,textArea,answerLabel,answerCount,wordCount,message,leave,submit,move}){
 const signal=ctx.signal,title=el('strong'),instruction=el('div',{class:'cd-instruction'}),part=el('strong'),hint=el('p');instruction.append(part,hint);
 const root=el('section',{'data-cd-exam':'writing','data-exam-runner':'','data-exam-mode':paper.mode,class:'cd-writing'});
 const icon=(text,label,action)=>{const b=el('button',{type:'button',class:'cd-icon','aria-label':label,title:label},text);listen(b,'click',action,signal);return b;};
 const menu=el('div',{class:'cd-menu',hidden:true}),notes=el('aside',{class:'cd-notes',hidden:true},el('label',{},'Notes',el('textarea',{'aria-label':'Notes',rows:'6',maxlength:'10000'})));
 leave.className='cd-text-button';submit.className='cd-submit';retry.className='cd-text-button';menu.append(leave);
 const header=el('header',{class:'cd-header'},el('span',{class:'cd-mark','aria-hidden':'true'},'LA'),el('div',{class:'cd-heading'},title,el('div',{},timer,el('span',{},' remaining')),saveStatus),el('div',{class:'cd-tools'},retry,icon('⛶','Fullscreen',()=>{if(document.fullscreenElement)void document.exitFullscreen?.();else void root.requestFullscreen?.();}),icon('☰','Options',()=>menu.hidden=!menu.hidden),icon('✎','Notes',()=>{notes.hidden=!notes.hidden;if(!notes.hidden)notes.querySelector('textarea').focus();})));
 questionLabel.className='sr-only';minHint.className='sr-only';answerLabel.className='sr-only';answerCount.className='sr-only';
 const question=el('section',{class:'exam-question-pane cd-question','aria-labelledby':'exam-question'},questionLabel,prompt,minHint,materialHost);
 const answer=el('section',{class:'exam-answer-pane cd-answer'},answerLabel,textArea,el('div',{class:'cd-word-count'},wordCount),answerCount,el('div',{class:'cd-task-arrows'},icon('←','Previous task',()=>move(-1)),icon('→','Next task',()=>move(1))));
 const footer=el('footer',{class:'cd-footer'},tabs,el('div',{class:'cd-submit-wrap'},submit));
 root.append(header,instruction,menu,notes,message,cdSplit(question,answer,signal),footer);
 return {node:root,update(entry){const number=entry.taskType==='task1'?1:2;title.textContent=paper.title||`Writing · Task ${number}`;part.textContent='Part '+number;hint.textContent=`You should spend about ${number===1?20:40} minutes on this task. Write at least ${number===1?150:250} words.`;}};
}
