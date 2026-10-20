import {parentPort,workerData} from 'node:worker_threads';
import {z} from 'zod';
import {buildIndexBounded} from '../../src/lib/dictionary/build-index';
import {dictionaryObjects} from '../../src/lib/dictionary/object-store';
import {decodeShard,shardKey,shardDescriptorSchema,releasePattern} from '../../src/lib/dictionary/shards';
import {indexKey} from '../../src/lib/dictionary/search-index';
const input=z.object({release:z.string().regex(releasePattern),workdir:z.string().min(1),order:z.array(z.string().uuid()).min(1).max(100000),shards:z.array(shardDescriptorSchema).min(1).max(256)}).strict().parse(workerData);
async function main(){if(!parentPort)throw Error('dictionary_index_worker_only');const objects=dictionaryObjects(),workdir=input.workdir;
 const manifest=await buildIndexBounded({release:input.release,order:new Map(input.order.map((id,i)=>[id,i])),workdir,groups:(async function*(){for(const d of input.shards)yield [...decodeShard(input.release,d,await objects.read(shardKey(input.release,d.shard),d.compressed_bytes)).values()];})(),async emit(name,body){await objects.putImmutable(indexKey(input.release,name),body);}});parentPort.postMessage({ok:true,manifest});}
main().catch(()=>{parentPort?.postMessage({ok:false,error:'dictionary_index_build_failed'});process.exitCode=1;});
