/** Lexical decoration inside an authorized Listening document, without changing exam markup. */
export function scriptLexicalBridge(token){
 return `(()=>{
 const token=${JSON.stringify(token)};
 const common=new Set('a an the i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those who whom whose which what when where why how is am are was were be been being do does did done have has had having to of at in on with for from and or but if so as by than then there here not no yes can could will would shall should may might must'.split(' '));
 let disconnected=false,observer=null;
 const send=(op,more)=>parent.postMessage(Object.assign({channel:'learners-area-authored-v1',token,op},more),'*');
 const transcriptPart=()=>Number((document.querySelector('#scriptTabs [data-spart].active')||document.querySelector('#scriptTabs [aria-selected="true"][data-spart]'))?.dataset.spart);
 function annotate(){
  if(disconnected||!document.querySelector('#activity-script.active'))return;
  const part=transcriptPart();
  if(!Number.isInteger(part)||part<1||part>4)return;
  const source=typeof DATA==='object'?DATA.transcript?.[String(part)]:null;
  if(typeof source!=='string')return;
  const terms=new Set();
  let didChange=false;
  for(const segment of document.querySelectorAll('#scriptHost .script-transcript [data-script-source-start]')){
   if(segment.dataset.laLexicalPrepared==='true')continue;
   segment.dataset.laLexicalPrepared='true';
   const begin=Number(segment.getAttribute('data-script-source-start'));
   if(!Number.isSafeInteger(begin)||begin<0)continue;
   const raw=segment.textContent||'';
   if(source.slice(begin,begin+raw.length)!==raw)continue;
   const fragment=document.createDocumentFragment(),pattern=/[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
   let cursor=0,match;
   while((match=pattern.exec(raw))!==null){
    if(match.index>cursor)fragment.append(document.createTextNode(raw.slice(cursor,match.index)));
    const word=match[0],key=word.toLowerCase();
    if(common.has(key))fragment.append(document.createTextNode(word));
    else {
     const el=document.createElement('span');
     el.textContent=word;
     el.dataset.laScriptWord=word;
     el.dataset.laScriptBegin=String(begin+match.index);
     el.dataset.vocabularySaved='false';
     fragment.append(el);
     terms.add(key);
    }
    cursor=match.index+word.length;
   }
   if(cursor<raw.length)fragment.append(document.createTextNode(raw.slice(cursor)));
   segment.replaceChildren(fragment);didChange=true;
  }
  if(didChange&&terms.size)send('saved-terms',{terms:[...terms].slice(0,600),part});
 }
 function close(){disconnected=true;observer?.disconnect();window.removeEventListener('message',received);document.removeEventListener('dblclick',selected,true);}
 function received(event){
  const msg=event.data;
  if(event.source!==parent||msg?.channel!=='learners-area-script-saved'||msg.token!==token||msg.part!==transcriptPart()||!Array.isArray(msg.terms))return;
  const saved=new Set(msg.terms.map(s=>String(s).toLowerCase()));
  for(const node of document.querySelectorAll('#scriptHost [data-la-script-word]')){
   node.dataset.vocabularySaved=saved.has(node.dataset.laScriptWord.toLowerCase())?'true':'false';
  }
 }
 function selected(event){
  const node=event.target instanceof Element?event.target.closest('[data-la-script-word]'):null;
  if(!node||!node.closest('#activity-script.active #scriptHost .script-transcript'))return;
  const part=transcriptPart(),word=node.dataset.laScriptWord,start=Number(node.dataset.laScriptBegin);
  const source=typeof DATA==='object'?DATA.transcript?.[String(part)]:null;
  if(typeof word!=='string'||typeof source!=='string'||!Number.isSafeInteger(start)||source.slice(start,start+word.length)!==word)return;
  const context=source.slice(Math.max(0,start-130),Math.min(source.length,start+word.length+130));
  send('word',{mode:'script-context',word,context,part,x:event.clientX,y:event.clientY});
 }
 function ready(){
  if(disconnected)return;
  if(!document.getElementById('la-script-dotted-style')){
   const style=document.createElement('style');style.id='la-script-dotted-style';
   style.textContent='[data-la-script-word]{text-decoration:underline dotted rgba(91,110,133,.65);text-decoration-thickness:1px;text-underline-offset:2px;cursor:help}[data-la-script-word][data-vocabulary-saved="true"]{text-decoration-color:#11b89e}';
   document.head.append(style);
  }
  observer=new MutationObserver(annotate);
  observer.observe(document.body,{subtree:true,childList:true});
  annotate();
  document.addEventListener('dblclick',selected,true);
  window.addEventListener('message',received);
  window.addEventListener('pagehide',close,{once:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();`;
}
