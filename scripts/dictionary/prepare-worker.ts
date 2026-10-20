import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha,stableJson,type Entry} from '../../src/lib/dictionary/model';
import {bytesHash,encodeShard} from '../../src/lib/dictionary/shards';
import {buildSearchIndex,INDEX_VERSION} from '../../src/lib/dictionary/search-index';
import {expectedImport} from './hybrid-import';
const [prepared,out,resume]=process.argv.slice(2);if(!prepared||!out)throw Error('Usage: prepare-worker.ts VERIFIED-PREPARED NEW-DIRECTORY');
const source=JSON.parse(readFileSync(join(prepared,'release-plan.json'),'utf8'));
const release='rel-v1-'+sha(stableJson({source:source.expected.entryInventorySha,index:INDEX_VERSION,targetBytes:262144})).slice(0,24);
const entries:Entry[]=source.shards.flatMap((d:{shard:string})=>JSON.parse(gunzipSync(readFileSync(join(prepared,d.shard+'.json.gz'))).toString('utf8'))).map((e:Entry)=>({...e,release_id:release}));
if(entries.length!==source.expected.lexemes)throw Error('source_count_mismatch');
if(resume!=='--resume')mkdirSync(out);mkdirSync(join(out,'search'),{recursive:true});mkdirSync(join(out,'shards'),{recursive:true});
const groups=new Map<string,Entry[]>();for(const e of entries){const id=e.lexeme_id.slice(0,2),g=groups.get(id)??[];g.push(e);groups.set(id,g);}
const shards=[];for(const [id,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const file=join(out,'shards',id+'.json.gz');let encoded;if(resume==='--resume'&&existsSync(file)){const body=readFileSync(file),raw=gunzipSync(body);if(raw.toString('utf8')!==stableJson(group.toSorted((a,b)=>a.lexeme_id.localeCompare(b.lexeme_id))))throw Error('resume_shard_mismatch');encoded={body,descriptor:{shard:id,sha256:bytesHash(body),raw_sha256:bytesHash(raw),compressed_bytes:body.length,raw_bytes:raw.length,entries:group.length}};}else encoded=encodeShard(release,group);shards.push(encoded.descriptor);if(!existsSync(file))writeFileSync(file,encoded.body);}
const start=performance.now(),index=buildSearchIndex(entries,release);const buildMs=performance.now()-start;
for(const [name,body] of index.objects)writeFileSync(join(out,'search',name+'.json.gz'),body);
const plan={version:2,sourceCommit:source.sourceCommit,sourceRelease:source.expected.release,expected:expectedImport(entries),counts:source.counts,shards,search:{version:INDEX_VERSION,directory:index.descriptor,routes:index.routes,objects:[index.descriptor,...index.directory.objects,...Object.values(index.routes).filter(d=>d.name!=='directory')],logicalTerms:source.expected.searchTerms},release};
const raw=stableJson(plan);writeFileSync(join(out,'release-plan.json'),raw);
console.log(JSON.stringify({complete:true,release,planSha:sha(raw),entries:entries.length,searchBuildMs:buildMs,searchObjects:index.objects.size,searchCompressedBytes:index.compressedBytes,directoryRawBytes:index.descriptor.raw_bytes,directoryCompressedBytes:index.descriptor.compressed_bytes,leafPartitions:Object.keys(index.directory.leaves).length,precomputedBranches:Object.keys(index.directory.branches).length,sourceLogicalTerms:source.expected.searchTerms}));
