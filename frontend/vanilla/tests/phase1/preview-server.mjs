// GET-only fixture preview. Tests and fixture responses are excluded by the runtime builder.
import {createServer} from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {fixtureReply} from './fixture-projections.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseline=path.resolve(root,'../../../.phase1/baseline/frontend/vanilla');
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 res.setHeader('Cache-Control','no-store');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 if(url.pathname==='/__qa'){
  const width=Math.max(320,Math.min(1920,Number(url.searchParams.get('width')||1440))),height=Number(url.searchParams.get('height')||900),route=url.searchParams.get('route')||'/app/dashboard',theme=url.searchParams.get('theme')||'day';
  const target=new URL(route,'http://fixture.invalid');target.searchParams.set('qa_theme',theme);target.searchParams.set('qa_role',url.searchParams.get('role')||'owner');target.searchParams.set('qa_empty',url.searchParams.get('empty')||'0');
  target.searchParams.set('qa_stage',url.searchParams.get('stage')||'after');
  const src=target.pathname+target.search;
  res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated Phase 1 visual QA</title><style>body{margin:0;background:#dce3ed;font:13px system-ui;color:#132038}header{padding:12px 20px}iframe{border:0;display:block;background:white;transform-origin:top center}main{display:flex;justify-content:center;overflow:hidden}</style></head><body><header>ISOLATED UI FIXTURE · ${width} × ${height} · ${theme} · ${route}</header><main><iframe id="qa-frame" title="Learners Area isolated QA" width="${width}" height="${height}" src="${src.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe></main><script>const f=document.querySelector('iframe');function fit(){const s=Math.min(1,(innerWidth-16)/${width},(innerHeight-48)/${height});f.style.transform='scale('+s+')';f.parentElement.style.height=${height}*s+'px';f.style.flex='0 0 ${width}px';}fit();addEventListener('resize',fit);</script></body></html>`);return;
 }
 if(url.pathname.startsWith('/api/')){const data=fixtureReply(url,req.headers.cookie,req.headers.referer);res.writeHead(data===undefined?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(data??{error:'fixture_unavailable'}));return;}
 const old=url.pathname.startsWith('/__baseline/')||url.searchParams.get('qa_stage')==='before',base=old?baseline:root;
 const pathname=url.pathname.replace(/^\/__baseline/,'');
 let file=path.resolve(base,'.'+pathname);if(!file.startsWith(base)){res.writeHead(403);res.end();return;}
 if(!path.extname(pathname))file=path.join(base,'index.html');
 try{
  let bytes=await fs.readFile(file);
  if(old&&/\.(html|css|js|mjs)$/.test(file))bytes=Buffer.from(bytes.toString().replace(/(["'`(])\/(js|modules|css|fonts|brand|images|campus)\//g,'$1/__baseline/$2/'));
  if(file.endsWith('index.html')){let html=bytes.toString();html=html.replace('<head>','<head><script>const q=new URL(location.href).searchParams,prefs={la_theme:q.get("qa_theme")||"day",la_locale:q.get("qa_locale")||"en"},descriptor=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");Object.defineProperty(document,"cookie",{get(){return descriptor.get.call(this).split(";").filter(v=>!/^\\s*la_(theme|locale)=/.test(v)).concat(Object.entries(prefs).map(([k,v])=>k+"="+v)).join(";");},set(v){const [k,value]=v.split(";")[0].split("=");if(k in prefs)prefs[k]=value;descriptor.set.call(this,v);}});</script>');bytes=Buffer.from(html);}
  const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.argv[process.argv.indexOf('--port')+1]||process.env.PORT||4173),'0.0.0.0',()=>console.log('Isolated Phase 1 QA fixture ready'));
