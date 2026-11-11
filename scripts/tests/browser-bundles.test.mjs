import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {buildBrowser} from '../bundle_browser.mjs';

const fixture=()=>{
 const root=mkdtempSync(resolve(tmpdir(),'la-bundles-')),project=resolve(root,'source'),outDir=resolve(root,'output');
 const files={
  'js/main.js':`import routes from './routes.js';globalThis.routeNames=routes.map(r=>r.name);export const open=name=>routes.find(r=>r.name===name).load();`,
  'js/routes.js':`import shared from './shared.js';export default [{name:shared,load:()=>import('../modules/listening/entry.js')},{name:'reading',load:()=>import('../modules/reading/entry.js')}];`,
  'js/shared.js':`export default 'listening';`,
  'modules/listening/entry.js':`import routes from '../../js/routes.js';import {label} from '../campus/return.js';export const names=routes.map(r=>r.name);export const value=label;export async function preload(){const file=true?'./lesson.js':'./test.js';return import(file);}`,
  'modules/listening/lesson.js':`export const ready='lesson';`,
  'modules/listening/test.js':`export const ready='test';`,
  'modules/reading/entry.js':`import {label} from '../campus/return.js';export const value=label;export const asset=new URL('../../js/vendor/model.wasm',import.meta.url).href;`,
  'modules/campus/return.js':`import routes from '../../js/routes.js';export const label=routes.map(r=>r.name).join(',');`,
 };
 for(const [name,content] of Object.entries(files)){mkdirSync(dirname(resolve(project,name)),{recursive:true});writeFileSync(resolve(project,name),content);}
 return {root,project,outDir,files};
};

test('feature grouping preserves lazy startup, shared imports, finite imports and original resource anchors',async()=>{
 const f=fixture();try{
  const report=await buildBrowser(f);
  assert(!report.startup.some(name=>/listening|reading/.test(name)));
  for(const feature of ['listening','reading']) assert.equal(report.chunks.filter(c=>c.path.includes('/'+feature+'-')).length,1);
  assert.deepEqual(report.dynamicImports[0].candidates,['./lesson.js','./test.js']);
  assert(report.resourceAnchors.includes('/modules/reading/entry.js'));
  for(const [name,content] of Object.entries(f.files))assert.equal(readFileSync(resolve(f.project,name),'utf8'),content);
  // Execute exactly the emitted ESM graph. This catches the original routes.map
  // startup-order regression, which a successful Rollup build never detected.
  const {pathToFileURL}=await import('node:url');
  await import(pathToFileURL(resolve(f.outDir,'js/main.js')).href);
  assert.deepEqual(globalThis.routeNames,['listening','reading']);
  for(const row of report.chunks.filter(c=>/\/listening-/.test(c.path))) {
   const module=await import(pathToFileURL(resolve(f.outDir,row.path)).href);
   assert(Object.keys(module).length>0);
  }
 }finally{rmSync(f.root,{recursive:true,force:true});delete globalThis.routeNames;}
});

test('unbounded local dynamic import fails the build instead of silently escaping into raw modules',async()=>{
 const f=fixture();try{
  writeFileSync(resolve(f.project,'js/main.js'),`export const load=path=>import(path);`);
  await assert.rejects(buildBrowser(f),/Unbounded dynamic import/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
