/** Execute original main route handlers and canonical Python against separate test databases. */
import {PGlite} from '@electric-sql/pglite';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {AsyncLocalStorage} from 'node:async_hooks';
import pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.env.MAIN_REFERENCE_ROOT||resolve(root,'../work/main-reference'));
const python=resolve(root,process.env.BACKEND_PYTHON||'services/backend/.venv/bin/python');
const output=resolve(process.env.PARITY_REPORT||resolve(root,'../work/main-http-parity.json'));
const reference=JSON.parse(readFileSync(root+'/services/backend/contracts/main-reference.json','utf8'));
for(const file of reference.files){
 const bytes=readFileSync(resolve(source,file.path));
 const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(hash!==file.sha)throw Error('Main reference differs from pinned commit: '+file.path);
}
const scope=process.env.PARITY_SCOPE||'anonymous';
const secret='unit-test-only-main-parity-signing-secret';
process.env.AUTH_SECRET=secret;process.env.NODE_ENV='test';process.env.DATABASE_URL='postgresql://test:test@localhost/parity';
for(const key of Object.keys(process.env))if(/^(R2_|S3_|TELEGRAM_|GOOGLE_|AI_|AUTH_EVENTS_)/.test(key))delete process.env[key];
globalThis.AsyncLocalStorage=AsyncLocalStorage;
const {workAsyncStorage}=await import('next/dist/server/app-render/work-async-storage.external.js');
const {workUnitAsyncStorage}=await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const {RequestCookies}=await import('next/dist/compiled/@edge-runtime/cookies/index.js');
const {NextRequest}=await import('next/server.js');
const databases=[new PGlite(),new PGlite()];
const roles=['student','teacher','admin','owner','pending','suspended','rejected'];
const workflows=scope==='workflows'?JSON.parse(readFileSync(root+'/services/backend/tests/main-workflows.json','utf8')):null;
const users=roles.map((label,index)=>({label,role:index<4?label:'student',status:index<4?'active':label,id:`11111111-1111-4111-8111-11111111111${index}`}));
for(const db of databases){
 for(const file of readdirSync(root+'/drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync(root+'/drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(x=>x.trim()))await db.exec(sql);
 for(const user of users)await db.query("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,$2,$3,$4,$5,'uz')",[user.id,'Parity '+user.label,user.label+'@example.test',user.role,user.status]);
 if(workflows)for(const sql of workflows.seed)await db.exec(sql);
}
const [nodeDb,pythonDb]=databases;
function arrayText(value){return '{'+value.map(v=>v===null?'NULL':Array.isArray(v)?arrayText(v):'"'+String(v).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+'}';}
function wireText(value,oid){
 if(value===null)return null;
 if([114,3802].includes(oid))return JSON.stringify(value);
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return arrayText(value);
 if(typeof value==='boolean')return value?'t':'f';
 return String(value);
}
let nodeQueries=0,pythonQueries=0;
async function query(config,params=[]){
 nodeQueries++;
 const sql=typeof config==='string'?config:config.text;
 const result=await nodeDb.query(sql,params);
 const rows=result.rows.map(row=>{const values=result.fields.map(field=>{const value=wireText(row[field.name],field.dataTypeID);if(value===null)return null;return (config.types?.getTypeParser(field.dataTypeID,'text')||pg.types.getTypeParser(field.dataTypeID,'text'))(value);});return config.rowMode==='array'?values:Object.fromEntries(result.fields.map((f,i)=>[f.name,values[i]]));});
 return {...result,rows,rowCount:result.affectedRows??rows.length,command:/^\s*(\w+)/.exec(sql)?.[1].toUpperCase()||''};
}
globalThis.__learnersAreaPool={query,on(){},connect:async()=>({query,release(){}})};
const {createSessionToken}=await import(pathToFileURL(source+'/src/lib/auth/session.ts'));
for(const user of users)user.token=await createSessionToken({sub:user.id,role:user.role,name:'Parity '+user.role,locale:'uz',onboarded:false});
const types=new Map((await pythonDb.query('SELECT oid,typname FROM pg_type')).rows.map(r=>[r.oid,r.typname]));
class OfflineListener {on(){return this;}async connect(){throw Error('isolated test listener offline');}async end(){}}
pg.Client=OfflineListener;
const childEnv={PATH:process.env.PATH,HOME:process.env.HOME,PYTHONPATH:'.',AUTH_SECRET:secret,NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@127.0.0.1:1/parity',PARITY_OFFLINE_LISTEN:'true',STORAGE_PROVIDER:'local',STORAGE_LOCAL_DIR:resolve(root,'../work/parity-storage')};
const child=spawn(python,['tests/parity_http_peer.py'],{cwd:root+'/services/backend',env:childEnv,stdio:['pipe','pipe','pipe']});
let awaiting;let stderr='';child.stderr.on('data',b=>{stderr+=b;});
child.on('exit',code=>{if(awaiting)awaiting.reject(Error('Python peer exited '+code+': '+stderr.slice(-1000)));});
const lines=createInterface({input:child.stdout});
lines.on('line',async line=>{
 let message;
 try{message=JSON.parse(line);if(message.event==='response'){awaiting?.resolve(message);awaiting=null;return;}
  let result;pythonQueries++;
  if(message.mode==='describe'){const info=await pythonDb.describeQuery(message.sql);result={params:info.queryParams.map(p=>({name:types.get(p.dataTypeID)})),fields:info.resultFields.map(f=>({name:f.name,dataTypeID:f.dataTypeID,typeName:types.get(f.dataTypeID)}))};}
  else if(message.mode==='exec')result=(await pythonDb.exec(message.sql))[0]||{rows:[],fields:[]};
  else result=await pythonDb.query(message.sql,message.values);
  const action=/^\s*(\w+)/.exec(message.sql)?.[1].toUpperCase();result.command=action+' '+(result.affectedRows??result.rows?.length??0);
  child.stdin.write(JSON.stringify(result,(_k,v)=>typeof v==='bigint'?String(v):v)+'\n');
 }catch(error){child.stdin.write(JSON.stringify({error:error.message,code:error.code})+'\n');}
});
async function pythonRequest(request){return new Promise((resolve,reject)=>{awaiting={resolve,reject};child.stdin.write(JSON.stringify(request)+'\n');});}
const modules=new Map();
async function nodeRequest(endpoint,request,params){
 try{
  let route=modules.get(endpoint.source);if(!route){route=await import(pathToFileURL(source+'/'+endpoint.source));modules.set(endpoint.source,route);}
  const headers=new Headers(request.headers);const cookieStore=new RequestCookies(headers);
  const req=new NextRequest('http://preview.test'+request.path,{method:request.method,headers,...(request.body?{body:request.body}: {})});
  const result=await workAsyncStorage.run({isStaticGeneration:false,route:request.path},()=>workUnitAsyncStorage.run({type:'request',phase:'render',cookies:cookieStore,headers},()=>route[endpoint.method](req,{params:Promise.resolve(params)})));
  const type=result.headers.get('content-type')||'';
  let body;if(type.includes('json'))body=await result.json();else if(type.startsWith('text/'))body=await result.text();else{body={binary:true};await result.body?.cancel();}
  return {status:result.status,body,headers:Object.fromEntries(result.headers)};
 }catch(error){return {status:599,body:{testDriverError:error.message}};}
}
const uuidMaps=[new Map(),new Map()];
const known=new Set(users.map(u=>u.id));
for(const sql of workflows?.seed||[])for(const match of sql.matchAll(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/ig))known.add(match[0]);
function normal(value,side=0){
 if(Array.isArray(value))return value.map(v=>normal(v,side));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normal(v,side)]));
 if(typeof value==='string'){
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:/.test(value))return '<timestamp>';
  return value.replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/ig,id=>{if(known.has(id))return id;const map=uuidMaps[side];if(!map.has(id))map.set(id,'<generated-id-'+(map.size+1)+'>');return map.get(id);});
 }
 return value;
}

const endpoints=JSON.parse(readFileSync(root+'/services/backend/PORT_STATUS.json','utf8')).endpoints;
const actors=scope==='anonymous'?[null]:scope==='all'?[null,...users]:users.filter(u=>u.role===scope);
const report={sourceCommit:reference.sourceCommit,verifiedSourceFiles:reference.files.length,scope,cases:[],differences:[]};
process.chdir(source);
try{
 if(!workflows)for(const actor of actors)for(const endpoint of endpoints){
  const params={};const path=endpoint.path.replace(/\{([^}:]+)(?::path)?\}/g,(_,key)=>{const value=['id','blockId','lexemeId','userId'].includes(key)?'99999999-9999-4999-8999-999999999999':key==='key'?'missing.txt':key==='action'?'unknown':key==='telegramUserId'?'99999999':'unknown';params[key]=endpoint.path.includes('{'+key+':path}')?value.split('/'):value;return value;});
  const request={method:endpoint.method,path,headers:{origin:'http://preview.test','content-type':'application/json',...(actor?{cookie:'la_session='+actor.token}:{})},...(!['GET','HEAD'].includes(endpoint.method)?{body:'{}'}:{})};
  const node=await nodeRequest(endpoint,request,params);const py=await pythonRequest(request);
  const equal=node.status===py.status&&(endpoint.method==='HEAD'||isDeepStrictEqual(normal(node.body,0),normal(py.body,1)));
  const entry={actor:actor?.label||'anonymous',method:endpoint.method,path: endpoint.path,equal};
  report.cases.push(entry);if(!equal)report.differences.push({...entry,node,python:py});
 }

 if(workflows){
  const variables=[{},{}];
  const fill=(value,side)=>typeof value==='string'?value.replace(/\$([A-Za-z]+)/g,(_,key)=>variables[side][key]||'<missing-'+key+'>'):Array.isArray(value)?value.map(v=>fill(v,side)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fill(v,side)])):value;
  const resolveEndpoint=(path,method)=>{
   const candidates=endpoints.filter(e=>e.method===method).sort((a,b)=>(a.path.match(/\{/g)||[]).length-(b.path.match(/\{/g)||[]).length);
   for(const endpoint of candidates){
    const names=[];const pattern=endpoint.path.replace(/\{([^}:]+)(?::path)?\}/g,(_all,key)=>{names.push(key);return '([^/]+)';});
    const match=new RegExp('^'+pattern+'$').exec(path.split('?')[0]);
    if(match)return [endpoint,Object.fromEntries(names.map((key,i)=>[key,match[i+1]]))];
   }
   throw Error('Scenario has no main endpoint: '+method+' '+path);
  };
  for(const item of workflows.cases){
   if(item.operation){
    let node;const data=fill(item.plan,0);
    try{
     const module=await import(pathToFileURL(source+'/src/lib/'+(item.operation==='context_bindings'?'dictionary/context-bindings.ts':'retention/source-revision.ts')));
     const result=item.operation==='context_bindings'?await module.applyContextBindings(data):await module.reviseRetentionWording(data,item.actorId);
     node={status:200,body:result};
    }catch(error){node={status:400,body:{error:error.message}};}
    const py=await pythonRequest({operation:item.operation,plan:fill(item.plan,1),actor:item.actorId});
    const equal=node.status===py.status&&isDeepStrictEqual(normal(node.body,0),normal(py.body,1));
    const record={name:item.name,operation:item.operation,equal};report.cases.push(record);if(!equal)report.differences.push({...record,node,python:py});
    continue;
   }

   const actor=users.find(u=>u.role===item.actor);
   const request=side=>({method:item.method,path:fill(item.path,side),headers:{origin:'http://preview.test','content-type':'application/json',cookie:'la_session='+actor.token},...(!['GET','HEAD'].includes(item.method)?{body:JSON.stringify(fill(item.body||{},side))}:{})});
   const beforeNode=nodeQueries,beforePython=pythonQueries;
   const nodeInput=request(0),pyInput=request(1);const [endpoint,params]=resolveEndpoint(nodeInput.path,item.method);
   const started=performance.now();const node=await nodeRequest(endpoint,nodeInput,params);const middle=performance.now();const py=await pythonRequest(pyInput);const finished=performance.now();
   if(item.save)for(const [key,path] of Object.entries(item.save))for(const [side,response] of [node,py].entries()){
    let value=response.body;for(const part of path.split('.'))value=value?.[part];if(value)variables[side][key]=value;
   }
   const equal=node.status!==599&&node.status===py.status&&(!item.expectStatus||item.expectStatus.includes(node.status))&&isDeepStrictEqual(normal(node.body,0),normal(py.body,1));
   const entry={name:item.name,actor:item.actor,method:item.method,path:item.path,status:node.status,equal,queries:{main:nodeQueries-beforeNode,python:pythonQueries-beforePython},elapsedMs:{main:middle-started,python:finished-middle}};report.cases.push(entry);if(!equal)report.differences.push({...entry,node,python:py});
  }
  report.state=[];
  for(const sql of workflows.stateQueries){
   const snapshots=[];for(const db of databases)snapshots.push((await db.query(sql)).rows);
   const equal=isDeepStrictEqual(normal(snapshots[0],0),normal(snapshots[1],1));report.state.push({sql,equal});
   if(!equal)report.differences.push({databaseState:true,sql,node:snapshots[0],python:snapshots[1]});
  }
  // Reading snapshots contain independently generated canonical row IDs. Compare
  // their structural identity above; validate each actual hash against main too.
  const versions=await import(pathToFileURL(source+'/src/lib/content/versions.ts'));
  for(const [side,db] of databases.entries()){
   const rows=(await db.query("SELECT module,content_type,content_snapshot,content_hash,semantic_hash,answer_key_hash FROM content_versions WHERE source_ref LIKE 'parity-author-%'")).rows;
   const equal=rows.every(r=>versions.contentHashOf(r.module,r.content_type,r.content_snapshot)===r.content_hash&&versions.semanticHashOf(r.module,r.content_type,r.content_snapshot)===r.semantic_hash&&versions.answerKeyHashOf(r.content_snapshot)===r.answer_key_hash);
   report.state.push({hashIntegrity:side===0?'main':'python',rows:rows.length,equal});
   if(!equal)report.differences.push({hashIntegrity:side===0?'main':'python'});
  }
 }
 const summary={total:report.cases.length,matched:report.cases.filter(c=>c.equal).length,stateChecks:report.state?.length||0,matchedStateChecks:report.state?.filter(c=>c.equal).length||0,differences:report.differences.length};
 writeFileSync(output,JSON.stringify({...report,summary},null,2)+'\n');
 console.log(JSON.stringify({...summary,report:output}));
 if(report.differences.length)process.exitCode=1;
}finally{writeFileSync(output+'.stderr.log',stderr);child.stdin.write(JSON.stringify({event:'close'})+'\n');await new Promise(r=>child.once('exit',r));await Promise.all(databases.map(d=>d.close()));}
