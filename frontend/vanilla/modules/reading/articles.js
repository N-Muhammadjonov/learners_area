import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {privateScope} from '../../js/private-scope.js';
import {missing} from '../listening/catalogue-v9.js';
import {articles} from './articles-data.js';

const messages = {
 en: {empty:'Articles will appear here when they are published.', start:'Start reading', minute:'min read', questions:'questions', back:'Back to Articles', check:'Check answers', score:'Correct answers', correct:'Correct', incorrect:'Incorrect', unanswered:'Choose an answer', questionsTitle:'Questions'},
 uz: {empty:'Maqolalar qo‘shilgach shu yerda ko‘rinadi.', start:'O‘qishni boshlash', minute:'daqiqalik mutolaa', questions:'ta savol', back:'Articles bo‘limiga qaytish', check:'Javoblarni tekshirish', score:'To‘g‘ri javoblar', correct:'To‘g‘ri', incorrect:'Noto‘g‘ri', unanswered:'Javobni tanlang', questionsTitle:'Savollar'}
};

function texts(context){return messages[context.locale === 'uz' ? 'uz' : 'en'];}
function ensureStyles(){
 if(document.querySelector('link[data-reading-articles-css]'))return;
 const link=el('link',{rel:'stylesheet',href:'/modules/reading/articles.css','data-reading-articles-css':''});
 document.head.append(link);
}
function card(article,t){
 const image=article.image?el('img',{class:'reading-article-image',src:article.image,alt:'',loading:'lazy'}):el('div',{class:'reading-article-image reading-article-placeholder','aria-hidden':'true'},'Aa');
 const tags=el('div',{class:'reading-article-tags'},article.level?el('span',{class:'reading-article-level'},article.level):null,(article.topics??[]).map(topic=>el('span',{class:'reading-article-topic'},topic)));
 return el('article',{class:'reading-article-card','data-reading-article':article.id},image,
  el('div',{class:'reading-article-card-body'},tags,el('h2',{class:'reading-article-title'},article.title),
   el('p',{class:'reading-article-meta'},`Article · ${article.minutes} ${t.minute}`),
   el('p',{class:'reading-article-count'},`${article.questionCount??(article.questions??[]).length} ${t.questions}`),
   el('a',{class:'btn-primary reading-article-action',href:`/app/reading/articles/${encodeURIComponent(article.id)}`},`${t.start} →`)));
}
export function mountArticles(context){
 ensureStyles();const t=texts(context);
 context.root.append(el('div',{'data-native-view':'reading-articles','data-route-usable':'reading-articles',class:'reading-articles'},
  articles.length?el('div',{class:'reading-article-grid'},articles.map(article=>card(article,t))):el('p',{class:'reading-articles-empty'},t.empty)));
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
   const syncTheme=()=>{doc.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'dark':'light';};
   syncTheme();const themeObserver=new MutationObserver(syncTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});signal.addEventListener('abort',()=>themeObserver.disconnect(),{once:true});
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
