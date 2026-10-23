"""Focused source-correctness check, not live media/production acceptance."""
from pathlib import Path
import os,shutil
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]/'modules/speaking'
source=(root/'history.js').read_text()
bootstrap='''async source=>{
 const blob=s=>URL.createObjectURL(new Blob([s],{type:'text/javascript'}));
 const dom=blob(`export function el(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else n.setAttribute(k,v===true?'':String(v));}for(const c of children.flat(Infinity))if(c!=null)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;}export function listen(n,e,fn,s){n.addEventListener(e,fn,{signal:s});}`);
 const frontend=blob(`export async function viewData(){return window.__historyData;}`);
 const api=blob(`export const api={request:async(path,opts)=>{window.__apiCalls.push({path,body:opts.body});return{ok:true};}};`);
 const evaluation=blob(`export function evaluationView(){return document.createElement('div');}`);
 const presentation=blob(`export function BackLink({fallbackHref,label}){const a=document.createElement('a');a.href=fallbackHref;a.textContent=label;return a;}export function RegionFailureNotice({message}){const p=document.createElement('p');p.textContent=message;return p;}`);
 const moduleCode=source.replace("'../../js/dom.js'",JSON.stringify(dom)).replace("'../../js/adapters/frontend.js'",JSON.stringify(frontend)).replace("'../../js/api-client.js'",JSON.stringify(api)).replace("'./evaluation.js'",JSON.stringify(evaluation)).replace("'../shared/presentation.js'",JSON.stringify(presentation));
 window.__history=await import(blob(moduleCode));
 window.__apiCalls=[];
 window.__historyData={kind:'speaking_history',attempts:[{id:'a',part:'part1',status:'submitted',recordingObjectKey:'speaking/attempts/recording 1.webm',recordingOriginalName:'recording.webm',recordingDurationMs:5000,recordingSize:10000}],evaluations:{}};
 window.__ctrl=new AbortController();
 window.__history.mount({root:document.getElementById('root'),dict:{speakingPractice:{historyTitle:'History',historyEmpty:'Empty',openStudio:'Practice',part:{part1:'Part 1'},attemptStatus:{submitted:'Submitted',recording:'Recording'},noTranscript:'No transcript',noTranscriptBody:'Add one',noTranscriptNotice:'Text',manualTranscriptLabel:'Transcript',manualTranscriptHint:'Type',manualTranscriptSaved:'Saved'},common:{back:'Back',loading:'Loading',save:'Save',saving:'Saving',error:'Error'},coach:{checkedBy:'Checked',transcriptManual:'Manual',transcriptFromStt:'Automatic',noEvaluation:'Not graded'},errors:{unknown:'Failed'},errorPage:{retry:'Retry'}},signal:window.__ctrl.signal,url:new URL('http://localhost/app/speaking/history')});
}'''
with sync_playwright() as p:
 exe=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
 b=p.chromium.launch(headless=True,**({'executable_path':exe} if exe else {}),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank');page.set_content('<div id="root"></div>');page.evaluate(bootstrap,source)
 page.locator('audio').wait_for()
 src=page.locator('audio').get_attribute('src')
 assert src=='/api/resources/speaking/attempts/recording%201.webm',src
 print('PASS: catch-all media route preserves object-key path segments and encodes unsafe filename chars')
 page.locator('textarea').fill('This is my manually entered transcript')
 page.get_by_role('button',name='Save').click()
 page.wait_for_function('window.__apiCalls.length===1')
 call=page.evaluate('window.__apiCalls[0]')
 assert call['path']=='/api/speaking/attempts/a/transcript',call
 assert call['body']=={'manualTranscript':'This is my manually entered transcript'},call
 print('PASS: manual transcript POST sends original server-owned field')
 assert not errors,errors
 b.close()
