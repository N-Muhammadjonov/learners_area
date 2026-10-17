import 'server-only';
import {readFile} from 'node:fs/promises';
import catalogue from './original-listening-catalogue.json';
import {adaptOriginalListening} from './original-test-one-hooks';
import {ORIGINAL_TEST_ONE_STORAGE,originalTestOneRuntime,usesOriginalTestOne} from './original-test-one';

export type OriginalListeningDefinition={number:number;storageKey:string;durationSeconds:number;activityCount:number;media:{path:string;objectKey:string;contentType:string;bytes:number;sha256:string;durationSeconds:number}[]};
const entries:Record<string,OriginalListeningDefinition>=catalogue;
/** Explicit owner batch ordinals from versioned manifests, never display titles. */
export const originalListeningBatchSequence=Object.entries(entries).map(([sourceId,definition])=>[sourceId,definition.number] as const);
export function originalListeningDefinition(id:string,sourceId:string):OriginalListeningDefinition|null {
 if(usesOriginalTestOne(id,sourceId))return {number:1,storageKey:ORIGINAL_TEST_ONE_STORAGE,durationSeconds:1645.061224,activityCount:9,media:[{path:'audio/full.mp3',objectKey:'listening/academic/test-01/full.mp3',contentType:'audio/mpeg',bytes:16450918,sha256:'c8d072e719dd00f53df9cc8fa916f35343d21ddffb0336c768e2a3f33aa1b34f',durationSeconds:1645.061224}]};
 return /^[0-9a-f-]{36}$/i.test(id)&&Object.hasOwn(entries,sourceId)?entries[sourceId]!:null;
}
export const hasOriginalListeningRuntime=(id:string,sourceId:string)=>!!originalListeningDefinition(id,sourceId);
export const originalListeningStorageKey=(sourceId:string)=>entries[sourceId]?.storageKey??ORIGINAL_TEST_ONE_STORAGE;
export async function originalListeningRuntime(id:string,sourceId:string) {
 const definition=originalListeningDefinition(id,sourceId);if(!definition)throw Error('Unknown original source');
 if(definition.number===1)return originalTestOneRuntime();
 const html=await readFile(process.cwd()+`/content/listening/academic/test-${String(definition.number).padStart(2,'0')}/source.html`,'utf8');
 return {entryPath:'source.html',files:{'source.html':adaptOriginalListening(html,definition)}};
}
