from pathlib import Path
import re, json, shutil, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]/'modules/writing'
modules={p.stem:p.read_text() for p in root.glob('*.js')}
modules['domstub']='''export function el(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')n.className=v;else if(k==='style')Object.assign(n.style,v);else n.setAttribute(k,v===true?'':String(v));}for(const c of children.flat(Infinity))if(c!=null)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;}export function listen(n,e,f,s){n.addEventListener(e,f,{signal:s});}'''
modules['frontendstub']='''export async function viewData(route){return window.__fixture[route]??window.__fixture.default??{};}'''
modules['presentationstub']='''export function BackLink({fallbackHref,label}){const a=document.createElement('a');a.href=fallbackHref;a.textContent=label;return a;}export function RegionFailureNotice({region,message,retryLabel,refresh}){const d=document.createElement('div');d.textContent=message;const b=document.createElement('button');b.textContent=retryLabel;b.addEventListener('click',refresh);d.append(b);return d;}'''
bootstrap='''async(sources)=>{
 const urls={};
 const make=code=>URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
 for(const name of ['domstub','frontendstub','presentationstub']) urls[name]=make(sources[name]);
 sources.shared=sources.shared.replace("'../../js/dom.js'",JSON.stringify(urls.domstub)).replace("'../../js/adapters/frontend.js'",JSON.stringify(urls.frontendstub)).replace("'../shared/presentation.js'",JSON.stringify(urls.presentationstub));
 urls.shared=make(sources.shared);
 for(const name of ['grade','translation','typing','topic','activation','lessons','submissions','stealing','exam']){
  urls[name]=make(sources[name].replace("'./shared.js'",JSON.stringify(urls.shared)));
 }
 let home=sources.home.replace("'./shared.js'",JSON.stringify(urls.shared));
 for(const name of ['lessons','exam','translation','typing','topic','grade','activation','stealing'])home=home.replaceAll("'./"+name+".js'",JSON.stringify(urls[name]));
 urls.home=make(home);
 let index=sources.index.replace("'./shared.js'",JSON.stringify(urls.shared));
 for(const name of ['home','lessons','exam','translation','grade','submissions','stealing'])index=index.replaceAll("'./"+name+".js'",JSON.stringify(urls[name]));
 urls.index=make(index);
 document.body.innerHTML='<div id="root"></div>';
 window.__writing=await import(urls.index);
 window.__mount=async(url,fixture,dict)=>{window.__controller?.abort();window.__controller=new AbortController();window.__fixture={default:fixture};window.__navigation=[];const root=document.querySelector('#root');root.replaceChildren();const ctx={root,url:new URL(url,'http://example.invalid'),dict,locale:'en',signal:window.__controller.signal,navigate:p=>window.__navigation.push(p),refresh:()=>window.__refreshed=(window.__refreshed??0)+1};await window.__writing.mount(ctx);};
 window.__calls=[];window.fetch=async(path,opts={})=>{const data=opts.body?JSON.parse(opts.body):null;window.__calls.push([path,data]);let r={ok:true};const id='f71884d4-8e36-4b72-9d70-cff8b3c213ab';if(path==='/api/writing/grade')r={ok:false,id,status:'failed'};
 if(path==='/api/writing/typing/prepare'){const n=window.__calls.filter(([p])=>p==='/api/writing/typing/prepare').length;r={token:'prep',text:{id,title:'Demo',words:[n===1?'hi':'ok'],wordCount:1}};}
 if(path==='/api/writing/typing/start')r={runToken:'run-token'};
 if(path==='/api/writing/typing/finish')r={run:{wpm:35,rawWpm:36,accuracy:95,consistency:90,correct:2,incorrect:0,extra:0,missed:0,durationMs:1100,presetSeconds:30},summary:{},history:[]};
 return new Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}});};
}'''
def d():
 return {'writingWorkspace':{
 'grade':{'title':'Grade','eyebrow':'Grade','body':'Write','newSubmission':'New','myEssays':'My essays','step1':'Task','step2':'Question','step3':'Essay','submit':'Grade my work','task':{'task1':'Task 1','task2':'Task 2'},'wordCount':'{n} words of {target}','errors':{'question':'Question needed','tooShort':'Write {n}','generic':'error','network':'network'}},'gradeExtra':{'ownQuestion':'My question','published':'Published'},
 'typing':{'title':'Typing','duration':'Duration','remaining':'Remaining','pause':'Pause','resume':'Resume','next':'Next','repeat':'Repeat','typeHint':'Type','s30':'30s','m1':'1m','m2':'2m','m3':'3m','presetFull':'Full','loading':'Loading','saving':'Saving','summary':'WPM {wpm} Acc {acc} Sec {sec}','error':'Typing failed','wpm':'WPM','accuracy':'Accuracy','rawWpm':'Raw WPM','characters':'Characters','time':'Time','graph':'Typing graph','duration':'Duration'},
 'translation':{'title':'Translation','resultTitle':'Result','overall':'Overall','meaning':'Meaning','grammar':'Grammar','vocabulary':'Vocabulary','bandWords':'Band words','notChecked':'Not checked','checkedOf':'Checked {n} of {total}','estimate':'Estimate','topFixes':'Top fixes','noFixes':'No fixes','yours':'Yours','model':'Model','improved':'Improved','note':'Note','newAttempt':'New','done':'Done','verdict':{'correct':'Correct','unchecked':'Unchecked'},'band':'Band'},
 'topicVocab':{'title':'Topic','body':'Vocabulary','topic':'Topic','task':'Task','fn':'Function','allTopics':'All','allTasks':'All','allFunctions':'All','fns':{},'sections':{'words':'Words','collocations':'Collocations','powerPhrases':'Power phrases','frames':'Frames'},'save':'Save','saved':'Saved','saveError':'Failed','savePattern':'Save','patternSaved':'Saved','activate':'Activate','practice':'Practice','noPatterns':'No patterns','empty':'Empty'},
 },'writing':{'task1':'Task 1','task2':'Task 2'},'common':{'back':'Back','words':'words','error':'Error'},'errorPage':{'retry':'Retry'}}
id='f71884d4-8e36-4b72-9d70-cff8b3c213ab'
with sync_playwright() as p:
 executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
 b=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('about:blank')
 page.evaluate(bootstrap,modules)
 page.evaluate("Object.defineProperty(crypto, 'randomUUID', {value: () => 'f71884d4-8e36-4b72-9d70-cff8b3c213ab', configurable: true})")
 page.evaluate('(a)=>window.__mount("/app/writing?tab=grade",{task1Prompts:[]},a)',d())
 page.locator('[data-grade-question]').fill('Describe the difference between two cities')
 page.locator('[data-grade-essay]').fill(' '.join(['writing']*55))
 page.locator('[data-grade-submit]').click();page.wait_for_function('window.__navigation.length>0')
 assert page.evaluate('window.__navigation[0]')==f'/app/writing/grade/{id}'
 print('PASS 1: saved-but-ungraded essay remains accessible')
 page.evaluate('(a)=>window.__mount("/app/writing?tab=typing",{},a)',d());page.wait_for_function('document.querySelector("[data-typing-phase]")?.dataset.typingPhase==="ready"')
 page.locator('[data-typing-input]').fill('hi');page.wait_for_function('document.querySelector("[data-typing-phase]")?.dataset.typingPhase==="result"')
 page.locator('[data-typing-next-result]').click();page.wait_for_function('document.querySelector("[data-typing-phase]")?.dataset.typingPhase==="ready"')
 page.locator('[data-typing-input]').fill('ok');page.wait_for_function('document.querySelector("[data-typing-phase]")?.dataset.typingPhase==="result"')
 assert page.evaluate('window.__calls.filter(([p])=>p==="/api/writing/typing/start").length')==2
 assert page.locator('svg.typing-graph').count()==1
 print('PASS 2: typing next creates a fresh run; graph rendered')
 view={'attemptId':id,'status':'completed','total':1,'set':{'title':'Demo'},'finished':[{'position':1,'uzbek':'Salom','yours':'Hello','model':'Hi','verdict':'correct','notes':['Accurate']}], 'result':{'overall':7.0,'meaning':90,'grammar':7.5,'vocabulary':6.5,'bandWords':{'used':['however'],'total':1},'checked':1,'topFixes':[{'position':1,'text':'Prefer concise answers'}]}}
 page.evaluate('([a,i,v])=>window.__mount("/app/writing/translation/"+i,{view:v},a)',[d(),id,view])
 page.locator('[data-translation-overall]').wait_for()
 assert page.locator('[data-translation-overall]').inner_text()=='7.0'
 assert 'Prefer concise' in page.locator('[data-translation-fixes]').inner_text()
 print('PASS 3: translation finished report contains scores and fixes')
 fixture={'topicVocabulary':{'topics':[],'words':[],'patterns':[{'id':'a','fn':'collocation','pattern':'make a decision','example':'x','taskType':'task2'},{'id':'b','fn':'cohesion','pattern':'furthermore','example':'y','taskType':'task2'},{'id':'c','fn':'sentence_frame','pattern':'it is clear that','example':'z','taskType':'task2'}]}}
 page.evaluate('([a,f])=>window.__mount("/app/writing?tab=topic-vocabulary",f,a)',[d(),fixture])
 page.locator('[data-topic-patterns]').first.wait_for()
 assert all(page.locator(f'[data-topic-patterns="{k}"] li').count()==1 for k in ['collocations','powerPhrases','frames'])
 print('PASS 4: three original topic pattern sections')

 # Finalized full exam uses original double-weighted Task 2 band.
 ed=d();ed['writingWorkspace']['exam']={'finishedTitle':'Finished','modeLabel':{'task1':'Task 1','task2':'Task 2'},'words':'words','wordsOf':'of {n}','belowMin':'Below minimum','reason':{'submitted':'Submitted'},'combined':'Combined','viewGrade':'View grade','gradeWithAi':'Grade with AI','gradeFailed':'Grade failed'}
 paper={'id':id,'mode':'full','finalizedAt':'2026-10-01T12:00:00Z','finalizeReason':'submitted','entries':[{'position':1,'taskType':'task1','promptId':id,'prompt':'Describe the graph','content':' '.join(['one']*150)},{'position':2,'taskType':'task2','promptId':id,'prompt':'Discuss this issue','content':' '.join(['two']*250)}]}
 exam={'paper':paper,'grades':{'1':{'requestId':id,'status':'evaluated','overall':6.0},'2':{'requestId':id,'status':'evaluated','overall':7.0}},'aiReady':True}
 page.evaluate('([a,i,v])=>window.__mount("/app/writing/exam/"+i,v,a)',[ed,id,exam])
 page.locator('[data-exam-combined]').wait_for()
 assert '6.5' in page.locator('[data-exam-combined]').inner_text()
 print('PASS 5: finalized Full Writing score gives Task 2 double weight')
 # Regression: an in-flight autosave must not mark a later edit as persisted.
 ed=d();ed['writingWorkspace']['exam']={'modeLabel':{'task1':'Task 1','task2':'Task 2'},'words':'words','saving':'Saving','saved':'Saved','saveFailed':'Retry save','retryNow':'Retry','submit':'Submit','leave':'Leave','submitConfirm':'Submit?','leaveConfirm':'Leave?','timeUp':'Time up'}
 editable={'id':id,'mode':'task1','remainingSeconds':300,'entries':[{'position':1,'taskType':'task1','prompt':'Explain it','content':'','revision':0}]}
 page.evaluate("""() => {const original=window.fetch;window.__draftCalls=[];window.__draftReplies=[];window.fetch=(path,opts={})=>{if(path.endsWith('/draft')){window.__draftCalls.push(JSON.parse(opts.body));return new Promise(resolve=>window.__draftReplies.push(()=>resolve(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}))));}return original(path,opts);};}""")
 page.evaluate('([a,i,v])=>window.__mount("/app/writing/exam/"+i,{paper:v},a)',[ed,id,editable])
 page.locator('[data-exam-editor]').fill('first revision')
 page.wait_for_function('window.__draftCalls.length===1',timeout=6000)
 page.locator('[data-exam-editor]').fill('second revision')
 page.evaluate('window.__draftReplies.shift()()')
 page.wait_for_function('window.__draftCalls.length===2',timeout=6000)
 calls=page.evaluate('window.__draftCalls')
 assert [(x['revision'],x['content']) for x in calls]==[(1,'first revision'),(2,'second revision')], calls
 page.evaluate('window.__draftReplies.shift()()')
 print('PASS 6: concurrent exam edit is saved with its own revision')
 assert not errors, errors
 b.close()
print('6/6 browser checks passed using synthetic in-memory fixtures and no external server')
