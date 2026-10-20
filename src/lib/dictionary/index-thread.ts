import 'server-only';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {workerIndexManifestSchema} from './worker-gateway';
import type {ShardDescriptor} from './shards';
/** Publication CPU and heap are isolated from Next.js request handling. */
export async function buildIndexThread(input:{release:string;order:string[];shards:ShardDescriptor[]},authority:()=>Promise<void>){
 const file=join(process.cwd(),'build/dictionary-index-worker.cjs');await access(file);const workdir=await mkdtemp(join(tmpdir(),'la-dictionary-index-'));
 return new Promise<import('./worker-gateway').WorkerIndexManifest>((resolve,reject)=>{
  const thread=new Worker(file,{workerData:{...input,workdir},resourceLimits:{maxOldGenerationSizeMb:160,maxYoungGenerationSizeMb:16}});let settled=false,checking=false;
  const finish=(error:Error|null,value?:import('./worker-gateway').WorkerIndexManifest)=>{if(settled)return;settled=true;clearInterval(timer);void thread.terminate().finally(()=>{if(error)reject(error);else resolve(value!);});};
  const timer=setInterval(()=>{if(checking)return;checking=true;void authority().catch(error=>finish(error instanceof Error?error:Error('dictionary_publish_authority_changed'))).finally(()=>{checking=false;});},2000);
  thread.on('message',(message:unknown)=>{try{const data=message as {ok?:boolean;manifest?:unknown};if(!data.ok)throw Error('dictionary_index_build_failed');finish(null,workerIndexManifestSchema.parse(data.manifest));}catch{finish(Error('dictionary_index_build_failed'));}});
  thread.on('error',()=>finish(Error('dictionary_index_build_failed')));thread.on('exit',()=>{if(!settled)finish(Error('dictionary_index_build_failed'));});
 }).finally(()=>rm(workdir,{recursive:true,force:true}));
}
