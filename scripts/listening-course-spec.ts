/** Rebuild coverage requirements from the versioned owner runtimes, never display titles. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {adaptOriginalListening,adaptOriginalTestOne} from '../src/lib/listening/original-test-one-hooks';
import {originalListeningDefinition} from '../src/lib/listening/original-listening';
import {ORIGINAL_TEST_ONE_ID} from '../src/lib/listening/original-test-one';

const specs:Record<string,unknown>={};
for(let n=1;n<=32;n++){
 const source=readFileSync(`content/listening/academic/test-${String(n).padStart(2,'0')}/source.html`,'utf8');
 const definition=originalListeningDefinition(n===1?ORIGINAL_TEST_ONE_ID:'11111111-1111-4111-8111-111111111111',`listening-test-${n}`)!;
 const errors:unknown[]=[];
 const dom=new JSDOM(n===1?adaptOriginalTestOne(source):adaptOriginalListening(source,definition),{runScripts:'dangerously',url:'https://fixture.invalid',virtualConsole:new VirtualConsole(),beforeParse(w){w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.addEventListener('error',e=>errors.push(e.error));}});
 try{
  const data=JSON.parse(String(dom.window.eval(`JSON.stringify({activities:ACTIVITIES.map(a=>a[0]),mcq:typeof MCQS==='undefined'?[]:MCQS.map(d=>d.q),map:typeof MAP_Q==='undefined'?[]:MAP_Q,matching:typeof MATCHING_Q==='undefined'?[]:MATCHING_Q,multi:typeof MULTI_GROUPS==='undefined'?[]:MULTI_GROUPS,completion:typeof COMPLETION_Q==='undefined'?[]:COMPLETION_Q,vocabulary:DATA.vocabulary.length})`)));
  const activities:Record<string,{units:string[];minimum:number;choices?:Record<string,number>}>={};
  for(const activity of data.activities){
   let units:string[]=[];const choices:Record<string,number>={};
   if(activity==='exam'||activity==='review'||activity==='retry')units=Array.from({length:40},(_,i)=>String(i+1));
   else if(activity==='vocab')units=JSON.parse(String(dom.window.eval("JSON.stringify(DATA.vocabulary.map(v=>String(v.headword||v.word||'').trim().slice(0,160)))")));
   else if(activity==='script'){
    dom.window.eval("openActivity('script')");
    for(let part=1;part<=4;part++){
     dom.window.eval(`scriptPart=${part};renderScript()`);
     for(const el of dom.window.document.querySelectorAll<HTMLInputElement>('[data-gap]'))units.push(part+':'+el.dataset.gap);
    }
   }else {
    dom.window.eval(`openActivity('${activity}')`);
    const nextIds:Record<string,string>={mcq:'mcqNext',map:'mapNext',matching:'matchNext',multi:'multiNext',completion:'compNext'};
    for(let step=0;step<50;step++){
     const unit=String(dom.window.eval('laCourseUnit()'));
     if(!unit||units.includes(unit))break;units.push(unit);
     if(activity==='multi'){
      const check=dom.window.document.querySelector<HTMLButtonElement>('#checkMulti,#multiCheck');
      let minimum=2;
      if(check?.disabled){const options=[...dom.window.document.querySelectorAll<HTMLElement>('[data-multiopt],[data-multi-practice]')];for(let i=0;i<options.length;i++){options[i]!.click();if(!check.disabled){minimum=i+1;break;}}}
      else {const range=/(?:Questions|Q)\s*(\d+)\s*[-–]\s*(\d+)/i.exec(unit);if(range)minimum=Number(range[2])-Number(range[1])+1;else if(/THREE/i.test(unit))minimum=3;}
      choices[unit]=minimum;
     }
     const next=dom.window.document.getElementById(nextIds[activity]!);if(!next)break;next.click();
    }
   }
   units=[...new Set(units)];
   activities[activity]={units,minimum:activity==='vocab'?Math.min(10,units.length):units.length,...(activity==='multi'?{choices}:{})};
  }
  if(errors.length)throw Error('Runtime error in Test '+n+': '+String(errors[0]));
  specs['listening-test-'+n]={version:createHash('sha256').update(source+JSON.stringify(activities)).digest('hex'),activities};
  console.log(n,Object.entries(activities).map(([key,v])=>`${key}:${v.minimum}`).join(' '));
 }finally{dom.window.close();}
}
writeFileSync('src/lib/listening/original-listening-course.json',JSON.stringify(specs,null,2)+'\n');
