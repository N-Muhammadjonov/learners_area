import {el} from '../../js/dom.js';
import {plainPrimaryClick} from '../../js/return-navigation.js';
import {fullExamStart} from './exam-start.js';
import {isolatedListeningStyle} from './source-style.js';

/** Key-free source presentation. Audio stays on the existing authorized Cloudflare path. */
export function originalListeningEntry(context,data,id){
 const layout=data.originalLayout;
 if(!layout||typeof layout.shell!=='string'||layout.shell.length>5000||
    typeof layout.style!=='string'||layout.style.length>50000||
    /<(?:script|iframe|audio|video|source|object|embed)\b|\son\w+\s*=/i.test(layout.shell)||
    /@import|url\s*\(/i.test(layout.style)||!Array.isArray(layout.activities)||layout.activities.length>12||
    layout.activities.some(row=>!row||['id','number','title','description'].some(key=>typeof row[key]!=='string'||row[key].length>1000))||
    layout.activities[0]?.id!=='exam')throw Error('Invalid original Listening layout');
 const host=el('section',{'data-listening-secure-gate':'','data-listening-source-hub':''});
 const shadow=host.attachShadow({mode:'open'}),surface=el('div',{class:'la-listening-source'});
 const template=document.createElement('template');template.innerHTML=layout.shell;
 surface.append(template.content);
 const cards=surface.querySelector('#activityCards');
 if(!cards||surface.querySelector('audio,video,source,script,iframe'))throw Error('Invalid original Listening hub');
 const allowed=new Set(Array.isArray(data.activities)?data.activities:[]),uz=context.locale==='uz';
 const locked=context.dict.fullListeningHub.locked;
 for(const row of layout.activities){
  if(row.id!=='exam'&&!allowed.has(row.id))continue;
  const attributes={class:'activity-card','data-listening-activity':row.id};
  const children=[el('span',{class:'num'},row.number),el('h2',{},row.title),el('p',{},row.description)];
  if(row.id==='exam'){
   if(data.attemptId){
    const href='/app/listening/attempts/'+data.attemptId;
    const resume=el('a',{...attributes,href,'data-listening-resume':''},children,
     el('span',{class:'open-chip'},uz?'Testni davom ettirish':'Resume exam'));
    resume.addEventListener('click',event=>{if(!plainPrimaryClick(event))return;event.preventDefault();void context.navigate(href);},{signal:context.signal});
    cards.append(resume);
   }else cards.append(el('article',attributes,children,fullExamStart(context,{id,title:data.title,compact:true,actionClass:'open-chip'})));
  }else cards.append(el('article',{...attributes,'aria-disabled':'true','data-listening-activity-locked':''},children,
   el('span',{class:'open-chip'},locked)));
 }
 const integrationStyle='a.activity-card{display:block;text-decoration:none}.activity-card[aria-disabled=true]{cursor:default}.activity-card[aria-disabled=true] .open-chip{background:var(--card2);color:var(--muted)}.activity-card .open-chip{border:0;font:inherit;font-weight:850;font-size:12px;line-height:normal}';
 shadow.append(el('style',{},isolatedListeningStyle(layout.style)+integrationStyle),surface);
 return host;
}
