/** Browser -> real ASGI handlers -> isolated PostgreSQL -> UI/save assertions. */
import fs from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const {chromium,webkit}=await import(process.env.READING_PLAYWRIGHT_MODULE??'../frontend/vanilla/node_modules/playwright-core/index.mjs');
const root=resolve(import.meta.dirname,'..'),db=new PGlite();
let child,browser,page,errors='';
const pageErrors=[],requests=[];
try{
 for(const file of fs.readdirSync(resolve(root,'services/backend/migrations')).filter(file=>file.endsWith('.sql')&&Number.parseInt(file,10)<=92).sort()){
  for(const sql of fs.readFileSync(resolve(root,'services/backend/migrations',file),'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await db.exec(sql);
 }
 child=spawn(process.env.BACKEND_PYTHON??'python3',['tests/reading_browser_server.py'],{cwd:resolve(root,'services/backend'),env:{...process.env,PYTHONPATH:'.',READING_BROWSER_FIXTURE:'isolated-local-only'},stdio:['pipe','pipe','pipe']});
 child.stderr.on('data',chunk=>{errors+=chunk;});
 createInterface({input:child.stdout}).on('line',async line=>{
  try{const message=JSON.parse(line);const result=message.mode==='exec'?(await db.exec(message.sql))[0]:await db.query(message.sql,message.values);child.stdin.write(JSON.stringify(result??{rows:[],fields:[]})+'\n');}
  catch(error){child.stdin.write(JSON.stringify({error:error.message,code:error.code})+'\n');}
 });
 const base='http://127.0.0.1:4199';
 for(let attempt=0;attempt<100;attempt++){
  if(child.exitCode!==null)throw Error(errors);
  try{if((await fetch(base+'/healthz')).ok)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const engine=process.env.READING_BROWSER_ENGINE==='webkit'?webkit:chromium;
 browser=await engine.launch({headless:true,...(process.env.READING_BROWSER_EXECUTABLE?{executablePath:process.env.READING_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1360,height:1000}});page=await context.newPage();
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors+='Browser: '+message.text()+'\n';});
 page.on('requestfailed',request=>{errors+='Request failed: '+request.url()+' '+JSON.stringify(request.failure())+'\n';});
 page.on('response',async response=>{if(response.url().includes('/api/')||response.status()>=400)requests.push({url:response.url(),status:response.status(),...(response.status()>=400?{body:(await response.text().catch(()=>'')).slice(0,1200)}:{})});});
 const responses=[];page.on('response',response=>{if(response.url().includes('/api/vocabulary'))responses.push({url:response.url(),status:response.status()});});
 await page.goto(base+'/app/reading/general/33333333-3333-4333-8333-333333333333?passage=1');
 await page.locator('[data-word="find"]').first().waitFor({timeout:20000});
 assert.equal(await page.locator('[data-word="They"]').count(),0);
 assert.equal(await page.locator('[data-word="find"]').count(),2);
 await page.locator('[data-word="find"]').last().dblclick();
 const popup=page.locator('[data-word-popover]');await popup.waitFor();
 assert.equal(await popup.getAttribute('aria-label'),'find out');
 await page.getByText('bilib olmoq',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-context-alternative]').count(),0);
 await popup.locator('[data-word-save]').click();
 await popup.locator('[data-word-saved]').waitFor();
 const saved=(await db.query('SELECT u.*,f.name AS folder_name FROM user_vocabulary u JOIN vocab_folders f ON f.id=u.folder_id')).rows;
 assert.equal(saved.length,1);assert.equal(saved[0].folder_name,'Browser passage title');
 assert.equal(saved[0].lexeme_id,'44444444-4444-4444-8444-444444444444');
 assert.equal(saved[0].source_snapshot.occurrenceId,'55555555-5555-4555-8555-555555555555');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{
  const first=document.querySelector('[data-word="find"]'),last=document.querySelector('[data-word="out"]'),range=document.createRange();
  range.setStart(first.firstChild,0);range.setEnd(last.firstChild,last.textContent.length);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  first.closest('[data-clickable-text]').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 });
 const swatches=page.locator('[data-highlight-color-option]');assert.equal(await swatches.count(),3);
 assert.deepEqual(await swatches.allTextContents(),['','','']);
 await page.locator('[data-highlight-color-option="yellow"]').click();
 assert.equal((await page.locator('mark').allTextContents()).join(''),'find out');
 assert.equal(await page.locator('strong em mark[data-highlight-color="yellow"]').count(),1);
 assert.deepEqual(pageErrors,[]);
 assert(responses.every(response=>response.status<400),JSON.stringify(responses));
 const output=process.env.READING_BROWSER_OUTPUT??resolve(root,'../reading-browser-verification.json');
 const report={result:'passed',engine:process.env.READING_BROWSER_ENGINE??'chromium',scope:'real browser + actual local ASGI + isolated PostgreSQL; synthetic learner; not production acceptance',saveFlowFailures:0,sourceSensePreserved:true,defaultFolder:saved[0].folder_name,phraseAcrossMarkup:true,threeUnlabeledSwatches:true,pageErrors};
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 if(process.env.READING_BROWSER_SCREENSHOT)await page.screenshot({path:process.env.READING_BROWSER_SCREENSHOT,fullPage:true});
 console.log(JSON.stringify(report));
}catch(error){console.error(errors);if(page)console.error(JSON.stringify({url:page.url(),text:(await page.locator('body').innerText()).slice(0,6000),pageErrors,requests}));throw error;}
finally{await browser?.close();if(child&&!child.killed)child.kill('SIGTERM');await db.close();}
