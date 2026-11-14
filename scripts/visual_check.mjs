/** Local-only visual evidence. Store screenshots outside the repository. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(new URL('../frontend/vanilla/package.json',import.meta.url));
const {chromium}=require('playwright-core');
const origin=process.env.VISUAL_ORIGIN??'http://127.0.0.1:8093';
const output=resolve(process.env.VISUAL_OUTPUT??'../visual-baseline');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const evidence=[];
try{
 for(const path of ['/','/login','/register'])for(const width of [390,768,1440])for(const reducedMotion of ['reduce','no-preference']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion,locale:'uz-UZ',colorScheme:'dark'});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('response',response=>{if(/javascript/.test(response.headers()['content-type']??''))requests.push(response.url());});
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(origin+path,{waitUntil:'networkidle'});
  if(path==='/')await page.locator('iframe[data-inline-landing]').waitFor({timeout:15000});
  const frame=path==='/'?await page.locator('iframe[data-inline-landing]').elementHandle().then(el=>el.contentFrame()):page.mainFrame();
  await frame.waitForLoadState('load');
  await frame.addStyleTag({content:'*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important}'});
  await frame.evaluate(async()=>{await document.fonts.ready;document.querySelectorAll('.rv').forEach(el=>el.classList.add('in'));});
  await page.waitForTimeout(500);
  const animations=await frame.locator('.bl,.pn,.mq div,.wv i,.tk i,.ch path,.tl,.hn i').evaluateAll(nodes=>nodes.map(node=>({selector:node.className?.baseVal??node.className,animation:getComputedStyle(node).animationName,transition:getComputedStyle(node).transitionDuration})));
  const label=(path==='/'?'home':path.slice(1))+'-'+width+'-'+reducedMotion;
  await page.screenshot({path:resolve(output,label+'.png'),fullPage:true});
  evidence.push({path,width,reducedMotion,requests,errors,animations,landingBytes:await frame.evaluate(()=>document.documentElement.outerHTML.length)});
  await context.close();
 }
 await writeFile(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({output,captures:evidence.length}));
}finally{await browser.close();}
