/** Local-only visual evidence. Store screenshots outside the repository. */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(new URL('../frontend/vanilla/package.json',import.meta.url));
const {chromium}=require('playwright-core');
const origin=process.env.VISUAL_ORIGIN??'http://127.0.0.1:8093';
const output=resolve(process.env.VISUAL_OUTPUT??'../visual-baseline');
const baseline=process.env.VISUAL_BASELINE?resolve(process.env.VISUAL_BASELINE):null;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const evidence=[];
async function pixelDifference(page,actual,expected){
 return page.evaluate(async({actual,expected})=>{
  const decode=value=>createImageBitmap(new Blob([Uint8Array.from(atob(value),letter=>letter.charCodeAt(0))],{type:'image/png'}));
  const [left,right]=await Promise.all([decode(actual),decode(expected)]);
  try{
   if(left.width!==right.width||left.height!==right.height)return {dimensionsMatch:false,actual:[left.width,left.height],expected:[right.width,right.height]};
   const canvas=document.createElement('canvas');canvas.width=left.width;canvas.height=left.height;
   const context=canvas.getContext('2d',{willReadFrequently:true});
   context.drawImage(left,0,0);const a=context.getImageData(0,0,canvas.width,canvas.height).data;
   context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(right,0,0);
   const b=context.getImageData(0,0,canvas.width,canvas.height).data;
   let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])changed++;
   return {dimensionsMatch:true,changedPixels:changed,totalPixels:canvas.width*canvas.height};
  }finally{left.close();right.close();}
 },{actual:actual.toString('base64'),expected:expected.toString('base64')});
}
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
  // Record real computed transitions before applying the same capture-only freeze.
  await frame.addStyleTag({content:'*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important}'});
  const label=(path==='/'?'home':path.slice(1))+'-'+width+'-'+reducedMotion;
  const screenshot=await page.screenshot({path:resolve(output,label+'.png'),fullPage:true});
  const reference=baseline?await readFile(resolve(baseline,(path==='/'?'home':path.slice(1))+'-'+width+'-no-preference.png')):null;
  const difference=reference?await pixelDifference(page,screenshot,reference):null;
  evidence.push({path,width,reducedMotion,requests,errors,animations,difference,landingBytes:await frame.evaluate(()=>document.documentElement.outerHTML.length)});
  await context.close();
 }
 await writeFile(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({output,captures:evidence.length}));
}finally{await browser.close();}
