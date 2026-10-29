import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {notifyLedger} from '../vocabulary/shared.js';

/** A source-verified save: new words and existing words share the chosen folder. */
export function vocabularySaver(context,{promptId,words,copy,pictureStory=null}){
 const {dict,signal,locale}=context,f=dict.vocabulary.folders;
 const automatic=locale==='uz'?'Bu savol uchun alohida papka':'A separate folder for this question';
 const host=el('div',{class:'space-y-3','data-speaking-vocabulary-saver':''});
 const picker=el('select',{class:'input','data-practice-folder':'','aria-label':f.title});
 const name=el('input',{class:'input',maxLength:80,'aria-label':f.name,'data-practice-folder-name':''});
 const nameLabel=el('label',{class:'block space-y-1',hidden:true},el('span',{},f.name),name);
 const folderStatus=el('p',{role:'status','data-practice-folder-status':''});
 const result=el('p',{role:'status','data-practice-save-status':''});
 const retry=el('button',{type:'button',class:'btn-secondary',hidden:true,'data-practice-folders-retry':''},dict.errorPage.retry);
 const buttons=[],wordStatuses=new Map();let saving=false,loading=false,destination='',folderName='',folderRows=[];
 const savedLabel=locale==='uz'?'✓ Saqlandi':'✓ Saved';
 function resetConfirmation(){result.textContent='';buttons.forEach((b,i)=>{b.textContent=i===0?copy.saveAll:copy.addWord;});for(const status of wordStatuses.values())status.textContent='';}
 // Explicit inline hiding is needed because the button/block CSS overrides [hidden].
 nameLabel.style.display='none';retry.style.display='none';
 function lock(){picker.disabled=saving||loading;name.disabled=saving;retry.disabled=saving||loading;for(const b of buttons)b.disabled=saving;}
 function options(rows=[]){folderRows=rows;picker.replaceChildren(el('option',{value:''},automatic),...rows.map(r=>el('option',{value:r.id},r.name)),el('option',{value:'new'},f.create));picker.value=destination;}
 options();
 listen(picker,'change',()=>{destination=picker.value;resetConfirmation();nameLabel.hidden=destination!=='new';nameLabel.style.display=destination==='new'?'block':'none';if(destination==='new')name.focus();},signal);
 listen(name,'input',()=>{folderName=name.value;},signal);
 async function loadFolders(){
  if(loading||signal.aborted)return;loading=true;retry.hidden=true;retry.style.display='none';folderStatus.textContent=dict.common.loading;lock();
  try{const d=await api.request('/api/vocabulary/folders',{signal,fresh:true});if(signal.aborted)return;
   if(!Array.isArray(d.folders)||d.folders.some(r=>typeof r.id!=='string'||typeof r.name!=='string'))throw Error('invalid_folders');
   options(d.folders);folderStatus.textContent='';
  }catch{if(!signal.aborted){folderStatus.textContent=dict.errors.unknown;retry.hidden=false;retry.style.display='inline-flex';}}
  finally{loading=false;if(!signal.aborted)lock();}
 }
 listen(retry,'click',()=>void loadFolders(),signal);
 async function save(indices,isAll=false){
  if(saving||signal.aborted)return;
  if(destination==='new'&&!folderName.trim()){name.focus();return;}
  const body={promptId,indices,...(destination==='new'?{folderName:folderName.trim()}:destination?{folderId:destination}:{})};
  saving=true;const localStatus=isAll?result:wordStatuses.get(indices[0]);
  result.textContent=dict.common.loading;if(localStatus)localStatus.textContent=dict.common.loading;lock();
  try{
   let d;
   if(pictureStory){
    // Reuse the existing Vocabulary/folder API; keep the server-verified IELTS prompt path unchanged.
    const desired=destination==='new'?folderName.trim():pictureStory.title.slice(0,80);
    let folder=destination&&destination!=='new'?folderRows.find(r=>r.id===destination):folderRows.find(r=>r.name===desired);
    if(destination&&destination!=='new'&&!folder)throw Error('folder_not_found');
    if(!folder){
     const made=await api.request('/api/vocabulary/folders',{method:'POST',body:{name:desired},signal});
     if(!made.folder?.id)throw Error('folder_not_created');
     folder=made.folder;folderRows=[...folderRows,folder];options(folderRows);
    }
    const items=indices.map(i=>({term:words[i].term,definitionEn:words[i].definitionEn||words[i].term,translationUz:words[i].translationUz}));
    d=await api.request('/api/vocabulary',{method:'POST',body:{items,folderId:folder.id,sourceType:'manual'},signal});
    // Existing senses are deduplicated by the API and are not moved on a manual save.
    // Place every returned owned entry in the selected folder before confirming success.
    if(d.ok!==true||!Array.isArray(d.ids)||!d.ids.length)throw Error('save_not_confirmed');
    const moved=await api.request('/api/vocabulary/folders',{method:'POST',body:{entryIds:d.ids,folderId:folder.id},signal});
    if(moved.ok!==true||moved.moved!==d.ids.length)throw Error('folder_move_not_confirmed');
    d={...d,folder};
   }else d=await api.request('/api/speaking/prompts/vocabulary',{method:'POST',body,signal});
   if(signal.aborted)return;
   if(d.ok!==true||!Array.isArray(d.ids)||!d.ids.length||d.ids.length>indices.length||!Number.isInteger(d.added)||!Number.isInteger(d.duplicates)||d.added<0||d.duplicates<0||d.added+d.duplicates!==indices.length||!d.folder?.id||typeof d.folder.name!=='string'||(body.folderId&&d.folder.id!==body.folderId))throw Error('save_not_confirmed');
   notifyLedger();result.textContent=copy.savedWords.replace('{added}',String(d.added)).replace('{duplicates}',String(d.duplicates)).replace('{folder}',d.folder.name);
   if(d.moved>0)result.textContent+=locale==='uz'?` · ${d.moved} ta so'z papkaga o'tkazildi`:` · ${d.moved} words moved to the folder`;
   if(localStatus)localStatus.textContent=result.textContent;
   if(isAll)buttons[0].textContent=savedLabel;
   for(const i of indices)if(buttons[i+1])buttons[i+1].textContent=savedLabel;
  }catch{if(!signal.aborted){result.textContent=copy.saveFailed;if(localStatus)localStatus.textContent=copy.saveFailed;}}
  finally{saving=false;if(!signal.aborted)lock();}
 }
 const all=el('button',{type:'button',class:'btn-primary','data-practice-save':'all'},copy.saveAll);buttons.push(all);listen(all,'click',()=>void save(words.map((_,i)=>i),true),signal);
 host.append(el('label',{class:'block space-y-1'},el('span',{},f.title),picker),nameLabel,folderStatus,retry,all,result);
 for(const [i,w] of words.entries()){
  const add=el('button',{type:'button',class:'btn-secondary mt-2','data-practice-save':i},copy.addWord);buttons.push(add);listen(add,'click',()=>void save([i]),signal);
  const status=el('p',{role:'status',class:'mt-2 text-sm','data-practice-word-save-status':i});wordStatuses.set(i,status);
  host.append(el('article',{class:'rounded-xl border border-ink-100 p-3'},el('strong',{},w.term),w.definitionEn!==w.term?el('p',{},w.definitionEn):null,el('p',{},w.translationUz??''),el('p',{class:'text-ink-500'},w.exampleSentence??''),add,status));
 }
 void loadFolders();return host;
}
