/** Interface location grammar only. Never an attempt identity or authorization source. */
const activities=new Set(['exam','review','retry','script','mcq','map','multi','completion','vocab']);
export function reviewLocation(hash){
 if(hash===''||hash==='#')return {activity:'hub'};
 const match=/^#([a-z]+)(?:\/part\/([1-4])(?:\/question\/([1-9]|[1-3][0-9]|40))?)?$/.exec(hash);
 if(!match||!activities.has(match[1]))return null;
 const activity=match[1],part=match[2]?Number(match[2]):1,question=match[3]?Number(match[3]):null;
 if(match[2]&&activity!=='review'||question&&Math.ceil(question/10)!==part)return null;
 return activity==='review'?{activity,part,question}:{activity};
}
export function reviewHash(value){
 if(value?.activity==='hub')return '';
 if(!activities.has(value?.activity))return null;
 if(value.activity!=='review')return '#'+value.activity;
 if(!Number.isInteger(value.part)||value.part<1||value.part>4||value.question!=null&&(!Number.isInteger(value.question)||Math.ceil(value.question/10)!==value.part||value.question<1||value.question>40))return null;
 return '#review/part/'+value.part+(value.question?'\/question/'+value.question:'');
}
/** Operates existing source controls; no material, questions, grading or persistence engine. */
export function reviewNavigationBridge(token){return `(()=>{const token=${JSON.stringify(token)};let disposed=false,applying=0,pending=null,question=null,scrollTimer=0,navigationFrame=0,lastSequence=0;
 const active=()=>document.querySelector('.activity.active')?.id.replace('activity-','')||'hub';
 const report=(sequence,previousScroll,focused=false)=>{if(disposed)return;const activity=active(),review=activity==='review';parent.postMessage({channel:'learners-area-authored-v1',token,op:'view',hub:activity==='hub',reviewActive:review,reviewPart:review&&typeof reviewPart==='number'?reviewPart:undefined,navigation:{activity,...(review?{part:reviewPart,question}: {})},navigationSequence:sequence||undefined,navigationFocused:focused,previousScroll,scroll:Math.max(0,Math.round(scrollY))},'*');};
 const apply=()=>{if(!pending||disposed||document.getElementById('hub')?.hasAttribute('aria-busy'))return;const d=pending;pending=null;applying=d.sequence;question=null;const current=active();
 try{if(d.activity==='hub'){if(current!=='hub')backHub();}else if(document.getElementById('activity-'+d.activity)){if(current!==d.activity)openActivity(d.activity);if(d.activity==='review'&&active()==='review'){if(reviewPart!==d.part)document.querySelector('[data-rpart="'+d.part+'"]').click();question=d.question||null;const target=question?document.getElementById('la-review-card-'+question):document.querySelector('[data-rpart="'+d.part+'"]');target?.focus({preventScroll:true});if(question)target?.scrollIntoView({block:'nearest'});else scrollTo(0,0);}}
 if(Number.isFinite(d.scroll)&&d.scroll>=0&&d.scroll<=10000000)scrollTo(0,d.scroll);
 }finally{const sequence=applying;applying=0;report(sequence);}};
 const receive=event=>{const d=event.data;if(event.source===parent&&d?.token===token&&d.channel==='learners-area-review-location-focus'&&d.sequence===lastSequence){cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(()=>{navigationFrame=0;if(disposed||d.sequence!==lastSequence)return;document.body.inert=false;const target=d.activity==='review'?(d.question?document.getElementById('la-review-card-'+d.question):document.querySelector('[data-rpart="'+d.part+'"]')):document.querySelector('#activity-'+d.activity+' [data-back]');target?.focus({preventScroll:true});if(Number.isFinite(d.scroll)&&d.scroll>=0&&d.scroll<=10000000)scrollTo(0,d.scroll);else if(d.question)target?.scrollIntoView({block:'nearest'});report(d.sequence,undefined,true);});return;}if(event.source!==parent||d?.token!==token||d.channel!=='learners-area-review-location'||!Number.isSafeInteger(d.sequence)||d.sequence<1||d.sequence<=lastSequence)return;const ids=['hub','exam','review','retry','script','mcq','map','multi','completion','vocab'];if(!ids.includes(d.activity)||d.activity==='review'&&(!Number.isInteger(d.part)||d.part<1||d.part>4||d.question!=null&&(!Number.isInteger(d.question)||Math.ceil(d.question/10)!==d.part)))return;lastSequence=d.sequence;document.body.inert=true;pending=d;apply();};
 const click=event=>{const target=event.target.closest?.('[data-open],[data-back],[data-rpart],[data-review-question]');if(!target||applying)return;const previousScroll=scrollY,selected=target.dataset.reviewQuestion;question=selected?Number(selected):null;cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(()=>{navigationFrame=0;report(undefined,previousScroll);});};
 const scrolling=()=>{if(disposed||applying||navigationFrame)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{scrollTimer=0;if(!disposed&&!applying)report();},200);};
 document.addEventListener('DOMContentLoaded',()=>{const hub=document.getElementById('hub');const observer=new MutationObserver(apply);if(hub)observer.observe(hub,{attributes:true,attributeFilter:['aria-busy']});addEventListener('message',receive);document.addEventListener('click',click,true);addEventListener('scroll',scrolling,{passive:true});addEventListener('pagehide',()=>{disposed=true;pending=null;observer.disconnect();clearTimeout(scrollTimer);cancelAnimationFrame(navigationFrame);removeEventListener('message',receive);document.removeEventListener('click',click,true);removeEventListener('scroll',scrolling);},{once:true});});})();`;}
