import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {privateScope} from '../../js/private-scope.js';
import {missing} from '../listening/catalogue-v9.js';
import {articles} from './articles-data.js';

const messages = {
 en: {empty:'Articles will appear here when they are published.', noMatches:'No articles match these filters.', search:'Search by title or source', topic:'Topic', notCompleted:'Not completed', completed:'Completed', progressError:'Could not load article progress.', progressSaveError:'Could not save article completion.', start:'Start reading', minute:'min read', questions:'questions', back:'Back to Articles', check:'Check answers', score:'Correct answers', correct:'Correct', incorrect:'Incorrect', unanswered:'Choose an answer', questionsTitle:'Questions'},
 uz: {empty:'Maqolalar qo‘shilgach shu yerda ko‘rinadi.', noMatches:'Bu filtrlarga mos maqola topilmadi.', search:'Nomi yoki manbasi bo‘yicha qidirish', topic:'Mavzu', notCompleted:'Bajarilmagan', completed:'Bajarilgan', progressError:'Maqola holatini yuklab bo‘lmadi.', progressSaveError:'Maqola holati saqlanmadi.', start:'O‘qishni boshlash', minute:'daqiqalik mutolaa', questions:'ta savol', back:'Articles bo‘limiga qaytish', check:'Javoblarni tekshirish', score:'To‘g‘ri javoblar', correct:'To‘g‘ri', incorrect:'Noto‘g‘ri', unanswered:'Javobni tanlang', questionsTitle:'Savollar'}
};

function texts(context){return messages[context.locale === 'uz' ? 'uz' : 'en'];}
function ensureStyles(){
 if(document.querySelector('link[data-reading-articles-css]'))return;
 const link=el('link',{rel:'stylesheet',href:'/modules/reading/articles.css','data-reading-articles-css':''});
 document.head.append(link);
}
function card(article,t){
 const thumbnail=article.image?.endsWith('.jpg')?article.image.replace(/\.jpg$/,'.thumb.webp'):article.image;
 const image=thumbnail?el('img',{class:'reading-article-image',src:thumbnail,alt:'',loading:'eager',decoding:'async'}):el('div',{class:'reading-article-image reading-article-placeholder','aria-hidden':'true'},'Aa');
 const tags=el('div',{class:'reading-article-tags'},article.level?el('span',{class:'reading-article-level'},article.level):null,(article.topics??[]).map(topic=>el('span',{class:'reading-article-topic'},topic)));
 return el('article',{class:'reading-article-card','data-reading-article':article.id},image,
  el('div',{class:'reading-article-card-body'},tags,el('h2',{class:'reading-article-title'},article.title),
   el('p',{class:'reading-article-count'},`${article.questionCount??(article.questions??[]).length} ${t.questions}`),
   el('a',{class:'btn-primary reading-article-action',href:`/app/reading/articles/${encodeURIComponent(article.id)}`},`${t.start} →`)));
}
export function mountArticles(context){
 ensureStyles();const t=texts(context),signal=context.signal;
 const search=el('input',{type:'search',class:'reading-article-search',placeholder:t.search,'aria-label':t.search,'data-article-search':''});
 const topics=[...new Set(articles.flatMap(article=>article.topics??[]))].sort((a,b)=>a.localeCompare(b));
 const topic=el('select',{class:'reading-article-topic-filter','aria-label':t.topic,'data-article-topic':''},el('option',{value:''},t.topic),topics.map(value=>el('option',{value},value)));
 const levelButtons=['B2','C1'].map(level=>el('button',{type:'button','data-article-level':level,'aria-pressed':'false'},level));
 const statusButtons=[['not_completed',t.notCompleted],['completed',t.completed]].map(([status,label])=>el('button',{type:'button','data-article-status':status,'aria-pressed':'false',disabled:true},label));
 const statusMessage=el('p',{class:'reading-article-filter-message',role:'status'}),empty=el('p',{class:'reading-articles-empty',hidden:true},t.noMatches);
 const cards=articles.map(article=>card(article,t)),grid=el('div',{class:'reading-article-grid'},cards);
 let level='',status='',completed=new Set();
 const apply=()=>{
  const query=search.value.trim().toLocaleLowerCase(),selectedTopic=topic.value;let visible=0;
  articles.forEach((article,index)=>{const matches=(!query||[article.title,article.source??''].some(value=>value.toLocaleLowerCase().includes(query)))&&(!selectedTopic||(article.topics??[]).includes(selectedTopic))&&(!level||article.level===level)&&(!status||(status==='completed')===completed.has(article.id));cards[index].hidden=!matches;if(matches)visible++;});
  empty.hidden=visible>0;
 };
 search.addEventListener('input',apply,{signal});topic.addEventListener('change',apply,{signal});
 for(const button of levelButtons)button.addEventListener('click',()=>{level=level===button.dataset.articleLevel?'':button.dataset.articleLevel;for(const item of levelButtons)item.setAttribute('aria-pressed',String(item.dataset.articleLevel===level));apply();},{signal});
 for(const button of statusButtons)button.addEventListener('click',()=>{status=status===button.dataset.articleStatus?'':button.dataset.articleStatus;for(const item of statusButtons)item.setAttribute('aria-pressed',String(item.dataset.articleStatus===status));apply();},{signal});
 const controls=el('div',{class:'reading-article-filters'},search,topic,el('div',{class:'reading-article-filter-group'},levelButtons),el('div',{class:'reading-article-filter-group'},statusButtons));
 context.root.append(el('div',{'data-native-view':'reading-articles','data-route-usable':'reading-articles',class:'reading-articles'},controls,statusMessage,articles.length?grid:el('p',{class:'reading-articles-empty'},t.empty),empty));
 if(articles.length)void api.request('/api/reading/articles/progress',{signal}).then(result=>{if(signal.aborted)return;if(!Array.isArray(result.completed))throw Error('invalid_article_progress');completed=new Set(result.completed);for(const button of statusButtons)button.disabled=false;apply();}).catch(()=>{if(!signal.aborted)statusMessage.textContent=t.progressError;});
}
export function mountArticle(context){
 ensureStyles();const t=texts(context),id=context.url.pathname.split('/')[4];
 const article=articles.find(item=>encodeURIComponent(item.id)===id);
 if(!article){context.root.append(missing(context.dict));return;}
 if(article.exercise)return mountExercise(context,article,t);
 const page=el('div',{class:'reading-article-detail','data-native-view':'reading-article'});
 page.append(el('a',{class:'btn-ghost','href':'/app/reading/articles','data-reading-article-back':''},'← '+t.back),el('h1',{class:'reading-article-detail-title'},article.title),
  el('p',{class:'reading-article-meta'},`${article.level??''} · ${article.minutes} ${t.minute}`),
  el('div',{class:'reading-article-text'},(article.paragraphs??[]).map(paragraph=>el('p',{},paragraph))));
 const questions=article.questions??[];
 if(questions.length){
  const form=el('form',{class:'reading-article-questions'},el('h2',{},t.questionsTitle));
  const feedback=[];
  questions.forEach((question,index)=>{
   const result=el('p',{class:'reading-article-feedback','aria-live':'polite'});feedback.push(result);
   form.append(el('fieldset',{class:'reading-article-question'},el('legend',{},`${index+1}. ${question.prompt}`),
    question.options.map((option,optionIndex)=>el('label',{class:'reading-article-option'},el('input',{type:'radio',name:`question-${index}`,value:String(optionIndex)}),el('span',{},option))),result));
  });
  const result=el('p',{class:'reading-article-result',role:'status'});
  form.append(el('button',{class:'btn-primary',type:'submit'},t.check),result);
  form.addEventListener('submit',event=>{
   event.preventDefault();let score=0;
   questions.forEach((question,index)=>{
    const selected=form.querySelector(`input[name="question-${index}"]:checked`);
    const correct=selected&&Number(selected.value)===question.answerIndex;if(correct)score++;
    feedback[index].textContent=!selected?t.unanswered:correct?t.correct:`${t.incorrect}${question.explanation?' · '+question.explanation:''}`;
   });
   result.textContent=`${t.score}: ${score} / ${questions.length}`;
  },{signal:context.signal});
  page.append(form);
 }
 context.root.append(page);
}

function mountExercise(context,article,t){
 const uz=context.locale==='uz', signal=context.signal;
 const copy=uz?{close:'Yopish',words:'Maqola lug‘ati',all:'Barcha so‘zlarni qo‘shish',add:'Vocabularyga qo‘shish',folder:'Qaysi papkaga qo‘shilsin?',defaultFolder:'Maqola nomi bilan papka',save:'Qo‘shish',cancel:'Bekor qilish',loading:'Yuklanmoqda…',failed:'Saqlanmadi. Qayta urinib ko‘ring.',saved:'So‘zlar Vocabularyga qo‘shildi.'}:{close:'Close',words:'Article vocabulary',all:'Add all words',add:'Add to vocabulary',folder:'Choose a folder',defaultFolder:'Folder named after this article',save:'Add',cancel:'Cancel',loading:'Loading…',failed:'Could not save. Please try again.',saved:'Words added to Vocabulary.'};
 let saveStatus=null;
 async function chooseWords(words){
  if(signal.aborted)return;
  const dialog=el('dialog',{class:'reading-article-folder','aria-labelledby':'article-folder-title'}),form=el('form',{}),select=el('select',{class:'input','aria-label':copy.folder,'data-article-folder-select':''}),error=el('p',{role:'alert',class:'reading-article-feedback'}),cancel=el('button',{type:'button',class:'btn-secondary'},copy.cancel),save=el('button',{type:'submit',class:'btn-primary',disabled:true},copy.save);
  const close=()=>{dialog.close?.();dialog.remove();};
  form.append(el('h2',{id:'article-folder-title'},copy.folder),el('p',{},words.length===1?words[0].term:`${words.length} ${copy.words}`),select,error,el('div',{class:'reading-article-folder-actions'},cancel,save));dialog.append(form);document.body.append(dialog);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
  cancel.addEventListener('click',close,{signal});dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{signal});signal.addEventListener('abort',close,{once:true});
  select.append(el('option',{value:''},copy.defaultFolder));
  try{const result=await api.request('/api/vocabulary/folders',{signal});if(signal.aborted)return;if(!Array.isArray(result.folders))throw Error('invalid_folders');for(const folder of result.folders)select.append(el('option',{value:folder.id},folder.name));save.disabled=false;}
  catch{if(!signal.aborted)error.textContent=copy.failed;}
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(save.disabled)return;save.disabled=cancel.disabled=true;error.textContent='';
   try{
    const body={items:words,sourceType:'article',...(select.value?{folderId:select.value}:{folderName:article.title})};
    const result=await api.request('/api/vocabulary',{method:'POST',body,signal});
    if(!result.ok||result.needsDefinition?.length)throw Error('save_failed');
    if(signal.aborted)return;privateScope.invalidate('vocabulary:');if(saveStatus)saveStatus.textContent=copy.saved;close();
   }catch{if(!signal.aborted){error.textContent=copy.failed;save.disabled=cancel.disabled=false;}}
  },{signal});
 }
 const query=new URLSearchParams();if(context.session?.user?.id)query.set('user',context.session.user.id);
 const frame=el('iframe',{class:'reading-article-frame',title:article.title,src:article.exercise+(query.size?'?'+query:''),'data-article-exercise':''});
 frame.addEventListener('load',()=>{
  try{
   const win=frame.contentWindow,doc=frame.contentDocument;
   const syncTheme=()=>{
    const root=document.documentElement,style=doc.documentElement.style,parentStyles=document.defaultView.getComputedStyle(root);
    doc.documentElement.dataset.theme=root.dataset.theme==='night'?'dark':'light';
    const palette={'--bg-main':'--workspace-paper','--bg-surface':'--workspace-raised','--bg-secondary':'--workspace-sunken','--text-main':'--workspace-ink','--text-muted':'--workspace-muted','--border-color':'--workspace-line','--accent-color':'--workspace-accent-strong','--accent-soft':'--workspace-sunken','--article-header-bg':'--workspace-sunken'};
    for(const [target,source] of Object.entries(palette)){const value=parentStyles.getPropertyValue(source).trim();if(value)style.setProperty(target,`rgb(${value})`);else style.removeProperty(target);}
   };
   syncTheme();const themeObserver=new MutationObserver(syncTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});signal.addEventListener('abort',()=>themeObserver.disconnect(),{once:true});
   const checkButton=doc.getElementById('im-check-btn');
   if(checkButton){
    let completionSaved=false,completionPending=false;
    const progressMessage=doc.createElement('p');progressMessage.setAttribute('role','status');progressMessage.className='im-dict-meta';(doc.getElementById('im-score')??checkButton).after(progressMessage);
    checkButton.addEventListener('click',()=>{
     const questions=[...doc.querySelectorAll('.im-question')];
     const nav=[...doc.querySelectorAll('[data-im-question]')];
     if(completionSaved||completionPending||nav.length!==article.questionCount||nav.some(question=>!question.classList.contains('im-answered')))return;
     const answers=questions.map(question=>{
      const field=question.querySelector('input,textarea,select');
      return (field?.value||question.innerText||'').trim().slice(0,500);
     });
     completionPending=true;
     void api.request(`/api/reading/articles/${encodeURIComponent(article.id)}/complete`,{method:'POST',body:{answers},keepalive:true}).then(()=>{completionSaved=true;if(!signal.aborted)progressMessage.textContent='';}).catch(()=>{if(!signal.aborted)progressMessage.textContent=t.progressSaveError;}).finally(()=>{completionPending=false;});
    },{signal});
   }
   const titleRow=doc.querySelector('.im-dict-title-row'),wordsPanel=doc.querySelector('#im-dict-words');
   if(titleRow&&wordsPanel){
    const addOne=doc.createElement('button');addOne.type='button';addOne.className='im-dict-speak';addOne.textContent='+';addOne.setAttribute('aria-label',copy.add);addOne.title=copy.add;addOne.setAttribute('data-article-add-word','');
    addOne.addEventListener('click',()=>{
     const term=doc.querySelector('#im-dict-title')?.textContent.trim().toLocaleLowerCase();
     const word=article.vocabulary.find(item=>item.term.toLocaleLowerCase()===term);
     if(word)void chooseWords([word]);
    },{signal});titleRow.append(addOne);
    const addAll=doc.createElement('button');addAll.type='button';addAll.className='im-dict-speak';addAll.textContent='+ '+copy.all;addAll.setAttribute('data-article-add-all','');addAll.style.cssText='width:auto;padding:5px 10px;margin-top:10px;font-size:13px';addAll.addEventListener('click',()=>void chooseWords(article.vocabulary),{signal});wordsPanel.append(addAll);
    saveStatus=doc.createElement('p');saveStatus.setAttribute('role','status');saveStatus.className='im-dict-meta';wordsPanel.after(saveStatus);
   }
   win.addEventListener('learnersarea:article-back',event=>{event.preventDefault();void context.navigate('/app/reading/articles');},{signal});
  }catch{}
 },{signal});
 context.root.append(el('div',{class:'reading-article-exercise','data-native-view':'reading-article'},frame));
}
