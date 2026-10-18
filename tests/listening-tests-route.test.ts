import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import en from '../src/lib/i18n/en';
import uz from '../src/lib/i18n/uz';
import {breadcrumbsFor} from '../src/lib/nav/routes';

const id='e44e3d4b-3af6-41a9-b465-7d4bc21e1019';

test('legacy Listening catalogue and deep bookmarks redirect to the same canonical test identity',()=>{
 // next/navigation also exports client contexts, so load its public entry outside
 // the unit runner's react-server condition, as in the built Next runtime.
 const script=`
 import Catalogue from './src/app/app/(shell)/listening/academic/page.tsx';
 import Test from './src/app/app/(shell)/listening/academic/[testId]/page.tsx';
 const results=[];
 for(const run of [()=>Catalogue(),()=>Test({params:Promise.resolve({testId:'${id}'})}),()=>Test({params:Promise.resolve({testId:'not-a-uuid'})})]){
  try{await run();results.push('no_navigation');}catch(error){results.push(error.digest);}
 }
 console.log(JSON.stringify(results));`;
 const actual=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8'}));
 assert.deepEqual(actual,['NEXT_REDIRECT;replace;/app/listening/tests;307;',`NEXT_REDIRECT;replace;/app/listening/tests/${id};307;`,'NEXT_HTTP_ERROR_FALLBACK;404']);
});

test('both languages show Listening Tests in the catalogue, library and legacy breadcrumbs',()=>{
 for(const dict of [en,uz]){
  assert.equal(dict.listening.academic.title,'Listening Tests');
  assert.equal(dict.fullListeningHub.library.academic,'🎧 Listening Tests');
  for(const path of ['/app/listening/tests',`/app/listening/tests/${id}`,`/app/listening/academic/${id}`]){
   const parent=breadcrumbsFor(path,dict).at(-1);
   assert.deepEqual(parent,{label:'Listening Tests',href:'/app/listening/tests'});
  }
  assert.equal(dict.readingV4.products.academic.title,'Academic Reading');
 }
});
