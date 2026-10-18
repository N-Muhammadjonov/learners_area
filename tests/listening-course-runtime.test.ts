import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {adaptOriginalListening,adaptOriginalTestOne} from '../src/lib/listening/original-test-one-hooks';
import {originalListeningDefinition} from '../src/lib/listening/original-listening';
import {ORIGINAL_TEST_ONE_ID} from '../src/lib/listening/original-test-one';
import {originalCourseSpec,readCourseWork,mergeCourseAnswers,courseStatus} from '../src/lib/listening/course-progress';

for(let n=1;n<=32;n++)test(`Test ${n}: actual activity checks cover every required exercise without a Submit test button`,()=>{
 const source=readFileSync(`content/listening/academic/test-${String(n).padStart(2,'0')}/source.html`,'utf8');
 const definition=originalListeningDefinition(n===1?ORIGINAL_TEST_ONE_ID:'11111111-1111-4111-8111-111111111111',`listening-test-${n}`)!;
 const spec=originalCourseSpec('listening-test-'+n)!;
 let work={...readCourseWork({},spec),exam:true,retry:Array.from({length:40},(_,i)=>String(i+1))};
 const errors:string[]=[];
 const dom=new JSDOM(n===1?adaptOriginalTestOne(source):adaptOriginalListening(source,definition),{runScripts:'dangerously',url:'https://fixture.invalid',virtualConsole:new VirtualConsole(),beforeParse(w){w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.addEventListener('error',e=>errors.push(String(e.error)));(w as unknown as {laCourseWork:(activity:string,answers:Record<string,string>)=>void}).laCourseWork=(activity,answers)=>{try{work=mergeCourseAnswers(spec,work,activity,answers);}catch(error){errors.push(activity+': '+String(error)+' '+JSON.stringify(answers));}};}});
 const w=dom.window,d=w.document;
 const click=(selector:string)=>{const button=d.querySelector<HTMLElement>(selector);assert.ok(button,selector);button.click();};
 const fill=(el:HTMLInputElement|HTMLTextAreaElement)=>{el.value='fixture answer';el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 try{
  for(const [activity,required]of Object.entries(spec.activities)){
   if(activity==='exam')continue;
   w.eval(`openActivity('${activity}')`);
   if(activity==='review'){
    for(let part=1;part<=4;part++){
     click(`[data-rpart="${part}"]`);
     d.querySelectorAll<HTMLInputElement>('[data-review-input]').forEach(fill);
     const groups=new Set([...d.querySelectorAll<HTMLInputElement>('[data-review-radio]')].map(el=>el.dataset.reviewRadio!));for(const q of groups){const options=[...d.querySelectorAll<HTMLInputElement>(`[data-review-radio="${q}"]`)];options[Number(q)%options.length]!.click();}
     click('#checkReviewPart');
    }
   }else if(activity==='script'){
    for(let part=1;part<=4;part++){w.eval(`scriptPart=${part};renderScript()`);d.querySelectorAll<HTMLInputElement>('[data-gap]').forEach(fill);d.querySelector<HTMLElement>('#checkScriptPart,#checkScript')?.click();}
   }else if(activity==='vocab'){
    click('#vPracticeBtn');for(let i=0;i<required.minimum;i++)click('[data-vopt]');
   }else if(activity==='retry'){
    w.eval('state.results=Array.from({length:40},(_,i)=>({q:i+1,user:"fixture",ok:false}));renderRetry()');
    for(let q=1;q<=40;q++){click(`[data-retryq="${q}"]`);const choice=d.querySelector<HTMLElement>('[data-rchoice]');if(choice)choice.click();else if(d.querySelector('[data-retry-multi]')){[...d.querySelectorAll<HTMLInputElement>('[data-retry-multi]')].slice(0,2).forEach(el=>el.click());click('#retryMultiCheck');}else{fill(d.querySelector<HTMLInputElement>('#retryInput')!);click('#retryCheck');}}
   }else for(let i=0;i<required.minimum;i++){
    if(activity==='mcq'){fill(d.querySelector<HTMLTextAreaElement>('#mcqPrediction')!);click('#revealMcq');click('[data-mcqopt]');click('#checkMcq');}
    if(activity==='map')click('[data-mapopt]');
    if(activity==='matching')click('[data-matchopt]');
    if(activity==='completion'){fill(d.querySelector<HTMLInputElement>('#completionAnswer')!);click('#completionCheck');}
    if(activity==='multi'){
     const check=d.querySelector<HTMLButtonElement>('#checkMulti,#multiCheck')!;
     const options=[...d.querySelectorAll<HTMLElement>('[data-multiopt],[data-multi-practice]')];
     for(let j=0;j<options.length;j++){options[j]!.click();if(j>=1&&!check.disabled)break;}
     check.click();
    }
    const next:Record<string,string>={mcq:'mcqNext',map:'mapNext',matching:'matchNext',multi:'multiNext',completion:'compNext'};
    d.getElementById(next[activity]!)?.click();
   }
   const status=courseStatus(spec,work).activities[activity]!;
   assert.equal(status.complete,true,activity+': '+JSON.stringify(status)+' '+errors.join('\n'));
  }
  assert.equal(courseStatus(spec,work).complete,true);
  assert.deepEqual(errors,[]);
  assert.equal([...d.querySelectorAll('#hub button')].filter(button=>/Submit test/i.test(button.textContent??'')).length,0);
 }finally{w.close();}
});
