/** Compile immutable browser assets; production serves these without Node. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const reference=resolve(process.env.MAIN_REFERENCE_ROOT||resolve(root,'../work/main-reference'));
const contract=JSON.parse(readFileSync(root+'/services/backend/contracts/main-listening-sources.json','utf8'));
for(const item of contract.files){
 const body=readFileSync(reference+'/'+item.path);
 const sha=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+body.length+'\0'),body])).digest('hex');
 if(sha!==item.sha)throw Error('Pinned main source changed: '+item.path);
}
const {adaptOriginalTestOne,adaptOriginalListening}=await import(pathToFileURL(reference+'/src/lib/listening/original-test-one-hooks.ts'));
const target=resolve(root,'services/backend/assets/listening');mkdirSync(target,{recursive:true});
const catalogue=JSON.parse(readFileSync(reference+'/src/lib/listening/original-listening-catalogue.json','utf8'));
const definitions=[{number:1},...Object.values(catalogue)];
const manifest={sourceCommit:contract.sourceCommit,format:1,entries:{}};
for(const definition of definitions){
 const key='test-'+String(definition.number).padStart(2,'0');
 const html=readFileSync(reference+'/content/listening/academic/'+key+'/source.html','utf8');
 const adapted=definition.number===1?adaptOriginalTestOne(html):adaptOriginalListening(html,definition);
 const output=JSON.stringify({entryPath:'source.html',files:{'source.html':adapted}})+'\n';
 writeFileSync(target+'/'+key+'.json',output);
 manifest.entries[key]={sourceSha256:createHash('sha256').update(html).digest('hex'),runtimeSha256:createHash('sha256').update(output).digest('hex'),bytes:Buffer.byteLength(output)};
}
writeFileSync(target+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:contract.sourceCommit,runtimes:definitions.length,checksums:'verified'}));
