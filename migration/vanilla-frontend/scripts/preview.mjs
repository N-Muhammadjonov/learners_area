import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../build');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.mp4':'video/mp4','.woff2':'font/woff2'};
if(!fs.existsSync(path.join(root,'index.html')))throw Error('Run npm run build first');
http.createServer((req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
 let url;try{url=decodeURIComponent(new URL(req.url,'http://preview').pathname);}catch{res.writeHead(400);res.end();return;}
 if(url.split('/').some(segment=>segment.startsWith('.'))){res.writeHead(404);res.end();return;}
 if(url.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'backend_not_connected'}));return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let target=path.resolve(root,'.'+url);if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end();return;}
 if(!fs.existsSync(target)||fs.statSync(target).isDirectory()){
  // Dotted static paths are real 404s, never HTML masquerading as JS/media.
  if(path.extname(url)){res.writeHead(404);res.end();return;}
  target=path.join(root,'index.html');
 }
 const size=fs.statSync(target).size;const ext=path.extname(target);res.setHeader('Content-Type',types[ext]??'application/octet-stream');
 let start=0,end=size-1;
 if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}start=Number(m[1]);end=m[2]?Number(m[2]):end;if(start>end||end>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);}
 res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);if(req.method==='HEAD'){res.end();return;}fs.createReadStream(target,{start,end}).pipe(res);
}).listen(Number(process.env.PORT??4173),'0.0.0.0',()=>console.log('Standalone migration candidate preview; APIs intentionally return 503. Port '+(process.env.PORT??4173)));
