import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { verifiedSource, expectedImport, SOURCE_COMMIT } from "./hybrid-import";
import { encodeShard, bytesHash, shardId } from "../../src/lib/dictionary/shards";
import { stableJson, type Entry } from "../../src/lib/dictionary/model";
const [file,attributionFile,out]=process.argv.slice(2);
if(!file||!attributionFile||!out)throw Error("Usage: prepare-hybrid.ts source.gz approved-attribution.json NEW-output-directory");
const source=verifiedSource(file,attributionFile),directory=resolve(out);
mkdirSync(directory); // Never overwrite an existing release package.
const groups=new Map<string,Entry[]>();
for(const e of source.entries){const key=shardId(e.lexeme_id);const group=groups.get(key)??[];group.push(e);groups.set(key,group);}
const descriptors=[];
for(const [key,entries] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const {body,descriptor}=encodeShard(entries[0]!.release_id,entries);writeFileSync(join(directory,key+".json.gz"),body);descriptors.push(descriptor);}
const plan={version:1,sourceCommit:SOURCE_COMMIT,sourceGzipSha256:"5224b974f8bfc11213e265841087156c262cc0f5db78f489a5cab0997a0113b7",expected:expectedImport(source.entries),counts:source.counts,shards:descriptors};
const encoded=Buffer.from(stableJson(plan));writeFileSync(join(directory,"release-plan.json"),encoded);
console.log(JSON.stringify({prepared:true,planSha256:bytesHash(encoded),counts:source.counts,shards:descriptors.length,compressedBytes:descriptors.reduce((n,x)=>n+x.compressed_bytes,0),maxShardRawBytes:Math.max(...descriptors.map(x=>x.raw_bytes))}));
