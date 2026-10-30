const canonical='https://learnersarea.uz/';
const title='Learners Area | IELTS platformasi — Uzbekistan';
const description='Learners Area — O‘zbekistonda IELTS tayyorgarligi uchun platforma. Listening, Reading, Writing, Speaking, grammatika va lug‘at mashqlari bir joyda.';
function meta(key,value,attribute='name'){
 let node=document.head.querySelector(`meta[${attribute}="${key}"]`);
 if(!node){node=document.createElement('meta');node.setAttribute(attribute,key);document.head.append(node);}
 node.content=value;
}
export function applyPageMetadata(path){
 const home=path==='/';
 document.title=home?title:'Learners Area';
 meta('robots',home?'index,follow':'noindex,nofollow,noarchive');
 if(!home){
  document.head.querySelectorAll('link[rel="canonical"],meta[name="description"],meta[property^="og:"],script[type="application/ld+json"]').forEach(node=>node.remove());
  return;
 }
 meta('description',description);
 let link=document.head.querySelector('link[rel="canonical"]');
 if(!link){link=document.createElement('link');link.rel='canonical';document.head.append(link);}
 link.href=canonical;
 for(const [key,value] of Object.entries({type:'website',site_name:'Learners Area',title,description:'IELTS tayyorgarligi: Listening, Reading, Writing, Speaking, grammatika va lug‘at mashqlari.',url:canonical,image:canonical+'brand/learners-area-logo-horizontal-dark.png','image:alt':'Learners Area'}))meta('og:'+key,value,'property');
 if(!document.head.querySelector('script[type="application/ld+json"]')){
  const data=document.createElement('script');data.type='application/ld+json';data.nonce=document.querySelector('script[nonce]')?.nonce||'';
  data.textContent=JSON.stringify({'@context':'https://schema.org','@type':'WebSite',name:'Learners Area',alternateName:['LearnersArea','Learners Area Uzbekistan','learnersarea.uz','learnersareauz','Learner Area','LearnerArea'],url:canonical,inLanguage:['uz','en'],description:'O‘zbekistonda IELTS tayyorgarligi uchun o‘quv platformasi.'});
  document.head.append(data);
 }
}
