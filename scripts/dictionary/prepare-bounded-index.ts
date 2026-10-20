import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildIndexBounded} from '../../src/lib/dictionary/build-index';
import {decodeShard,type ShardDescriptor} from '../../src/lib/dictionary/shards';
import {sha,stableJson} from '../../src/lib/dictionary/model';
const [preparedArg,verify]=process.argv.slice(2);if(!preparedArg)throw Error('Usage: prepare-bounded-index.ts PREPARED-DIRECTORY');
const prepared=preparedArg;
async function main(){const plan=JSON.parse(readFileSync(join(prepared,'release-plan.json'),'utf8'));const previous=plan.search;if(previous&&verify!=='--verify')throw Error('index_already_prepared');const order=new Map<string,number>((JSON.parse(gunzipSync(readFileSync(join(prepared,'sort-order.json.gz'))).toString()) as string[]).map((id,i)=>[id,i]));
 const workdir=mkdtempSync(join(tmpdir(),'la-index-prepare-')),start=performance.now();try{
  plan.search=await buildIndexBounded({release:plan.release,order,workdir,groups:(async function*(){for(const d of plan.shards as ShardDescriptor[])yield [...decodeShard(plan.release,d,readFileSync(join(prepared,'shards',d.shard+'.json.gz'))).values()];})(),async emit(name,body){if(verify==='--verify'){if(!body.equals(readFileSync(join(prepared,'search',name+'.json.gz'))))throw Error('index_rebuild_mismatch');}else writeFileSync(join(prepared,'search',name+'.json.gz'),body,{flag:'wx'});}});
  if(plan.search.logicalTerms!==plan.expected.searchTerms)throw Error('index_logical_terms_mismatch');
  if(previous&&stableJson(previous)!==stableJson(plan.search))throw Error('index_rebuild_mismatch');const raw=stableJson(plan);writeFileSync(join(prepared,'release-plan.json'),raw);console.log(JSON.stringify({complete:true,release:plan.release,planSha:sha(raw),searchObjects:plan.search.objects.length,searchBytes:plan.search.objects.reduce((n:number,d:{compressed_bytes:number})=>n+d.compressed_bytes,0),buildMs:performance.now()-start,maxRssKiB:process.resourceUsage().maxRSS}));
 }finally{rmSync(workdir,{recursive:true,force:true});}}
main().catch(error=>{console.error(error);process.exitCode=1;});
