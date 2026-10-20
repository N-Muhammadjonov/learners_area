import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {decodeIndex,directorySchema,encodeRoutingDirectories} from '../../src/lib/dictionary/search-index';
import {sha,stableJson} from '../../src/lib/dictionary/model';
const [dir]=process.argv.slice(2);if(!dir)throw Error('Usage: add-routing.ts UNAPPROVED-PREPARED');
const file=join(dir,'release-plan.json'),plan=JSON.parse(readFileSync(file,'utf8'));if(plan.search.routes)throw Error('routing_already_prepared');
const directory=directorySchema.parse(decodeIndex(plan.search.directory,readFileSync(join(dir,'search/directory.json.gz')))),routing=encodeRoutingDirectories(directory);plan.search.routes={};
for(const item of routing.objects){const file=join(dir,'search',item.descriptor.name+'.json.gz');if(existsSync(file)){if(!readFileSync(file).equals(item.body))throw Error('immutable_prepared_object_conflict');}else writeFileSync(file,item.body);plan.search.routes[item.initial]=item.descriptor;plan.search.objects.push(item.descriptor);}
for(const key of routing.fallbacks)plan.search.routes[key]=plan.search.directory;
const raw=stableJson(plan);writeFileSync(file,raw);console.log(JSON.stringify({release:plan.release,planSha:sha(raw),routingObjects:routing.objects.length,largestRoutingRaw:Math.max(...routing.objects.map(x=>x.descriptor.raw_bytes)),largestRoutingCompressed:Math.max(...routing.objects.map(x=>x.descriptor.compressed_bytes))}));
