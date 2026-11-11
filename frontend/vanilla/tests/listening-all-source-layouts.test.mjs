import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,ID} from './staff-final30/harness.mjs';
import {authoredCdView} from '../modules/listening/cd-view.js';

function sourceConstant(html,name){
 const match=new RegExp('\\bconst '+name+'\\s*=\\s*').exec(html);
 assert(match,'Missing source '+name);
 const start=match.index+match[0].length;
 let depth=0,quoted=false,escaped=false;
 for(let index=start;index<html.length;index++){
  const char=html[index];
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;continue;}
  if(char==='{'||char==='[')depth++;
  if((char==='}'||char===']')&&--depth===0)return JSON.parse(html.slice(start,index+1));
 }
 assert.fail('Incomplete source '+name);
}

for(let number=1;number<=32;number++)test('Listening '+number+' preserves all four original papers inside its own style boundary',()=>{
 const runtime=JSON.parse(fs.readFileSync(new URL('../../../services/backend/assets/listening/test-'+String(number).padStart(2,'0')+'.json',import.meta.url)));
 const html=runtime.files[runtime.entryPath],data=sourceConstant(html,'DATA'),parts=sourceConstant(html,'PARTS');
 const shell=html.match(/<div class="exam-root\b[^>]*id="examRoot".*?<\/div><\/div>(?=`\))/s)?.[0];
 const style=html.match(/<style>(.*?)<\/style>/s)?.[1];
 assert(shell&&style);
 const questions=Object.values(data.questions).map(q=>({id:ID(q.q),number:q.q,section:q.part,text:q.prompt,
  options:(q.options??[]).map(option=>option.code+') '+option.text),input:'text'}));
 const h=setup({path:'/app/listening/tests/'+ID(number),theme:'night'});
 try{
  const view=authoredCdView({shell,style,parts:[1,2,3,4].map(part=>parts[part]),sections:data.sections},
   {questions,imageUrl:null,notes:'',saveWorkspace(){},signal:h.ctx.signal});
  h.ctx.root.append(view.surface);
  const root=view.surface.shadowRoot;
  assert(root);
  assert.equal(view.surface.querySelector('style'),null);
  assert.equal(view.surface.querySelector('input'),null);
  assert.match(root.querySelector('style').textContent,/:host\{all:initial;/);
  assert.match(root.querySelector('style').textContent,/\.la-listening-source\{margin:0;min-height:100%;font-family:Sora/);
  const model={answers:{},position:0,duration:1800,started:true,entered:true,preparing:false,playing:true,
   loading:false,busy:false,conflict:false,error:'',saved:'',audio:{volume:1},
   change:(id,value)=>{model.answers={...model.answers,[id]:value};view.paintAnswers(model.answers);},play(){},submit(){}};
  view.update(model);
  for(let part=1;part<=4;part++){
   h.click(root.querySelector('[data-part="'+part+'"]'));
   const paper=root.getElementById('examQuestionHost');
   const original=document.createElement('template');original.innerHTML=parts[part];
   assert.equal(paper.childElementCount,original.content.childElementCount,'Original paper replaced by generated question rows');
   assert.equal(root.querySelectorAll('[data-qnav]').length,40);
   assert.equal(root.querySelectorAll('[data-qgroup]:not(.hidden) [data-qnav]').length,10);
   assert.equal(root.getElementById('examPartTitle').textContent,'SECTION '+part);
   const control=paper.querySelector('input[type="text"],input:not([type])');
   if(control){
    const id=ID(Number(control.dataset.listeningSourceQuestion));
    h.input(control,'saved '+part);
    assert.equal(model.answers[id],'saved '+part);
    h.click(root.querySelector('[data-part="'+(part===4?1:part+1)+'"]'));
    h.click(root.querySelector('[data-part="'+part+'"]'));
    assert.equal(root.getElementById('examQuestionHost').querySelector('[data-listening-source-question="'+Number(control.dataset.listeningSourceQuestion)+'"]').value,'saved '+part);
   }
  }
 }finally{h.dispose();}
});
