/** Source-bound HTTP integration on a fresh isolated embedded PostgreSQL engine.
 * Production-only Listening content backfills (0093+) are intentionally outside
 * this Reading schema fixture: they require the production transcript corpus.
 */
import {PGlite} from '@electric-sql/pglite';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),db=new PGlite();
try{
 let migrations=0;
 for(const file of readdirSync(resolve(root,'services/backend/migrations')).filter(file=>file.endsWith('.sql')&&Number.parseInt(file,10)<=92).sort()){
  for(const sql of readFileSync(resolve(root,'services/backend/migrations',file),'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await db.exec(sql);
  migrations++;
 }
 const child=spawn(process.env.BACKEND_PYTHON??'python3',['tests/reading_context_postgres_probe.py'],{cwd:resolve(root,'services/backend'),env:{...process.env,PYTHONPATH:'.'},stdio:['pipe','pipe','pipe']});
 let report,errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
 createInterface({input:child.stdout}).on('line',async line=>{
  try{
   const message=JSON.parse(line);if(message.event==='done'){report=message;return;}
   const result=message.mode==='exec'?(await db.exec(message.sql))[0]:await db.query(message.sql,message.values);
   child.stdin.write(JSON.stringify(result??{rows:[],fields:[]})+'\n');
  }catch(error){child.stdin.write(JSON.stringify({error:error.message,code:error.code})+'\n');}
 });
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 if(code!==0||!report)throw Error(errors||'Reading PostgreSQL probe failed');
 console.log(JSON.stringify({result:'passed',database:'PGlite embedded PostgreSQL',schemaMigrations:migrations,httpChecks:report.checks,saveFlowFailures:report.wire.saveFlowFailures,scope:'isolated synthetic learner; actual source-bound lookup/save handlers; production content migrations not executed'}));
}finally{await db.close();}
