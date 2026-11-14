import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {paintedBridge} from '../modules/listening/authored-progressive.js';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

const root=new URL('../../../',import.meta.url);
const hash=text=>createHash('sha256').update(text).digest('hex');

function runtimeFor(number){
  const index=String(number).padStart(2,'0');
  const raw=readFileSync(new URL(`services/backend/assets/listening/test-${index}.json`,root),'utf8');
  const runtime=JSON.parse(raw);
  assert.equal(runtime.entryPath,'source.html',`Test ${number}: canonical entry`);
  const html=runtime.files[runtime.entryPath];
  assert.equal(typeof html,'string');
  const marker='const DATA=';
  const at=html.indexOf(marker);
  assert(at>=0,`Test ${number}: original DATA constant`);
  const begin=at+marker.length;
  let depth=0,quoted=false,escaped=false;
  for(let i=begin;i<html.length;i++){
    const char=html[i];
    if(quoted){
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char==='"')quoted=false;
      continue;
    }
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='[')depth++;
    if((char==='}'||char===']')&&--depth===0){
      return {html,runtime,raw,data:JSON.parse(html.slice(begin,i+1))};
    }
  }
  throw Error(`Test ${number}: incomplete original DATA`);
}

test('Listening Tests 12–16 retain all twenty real source transcripts and original graded activities',()=>{
  let parts=0,gaps=0;
  for(let number=12;number<=16;number++){
    const {data,html}=runtimeFor(number);
    assert.match(html,/function renderScript\(/,`Test ${number}: Script Completion unavailable`);
    assert.match(html,/activityShell\('script'/,`Test ${number}: Script activity hidden`);
    assert.equal(Object.keys(data.transcript).length,4,`Test ${number}: source part count`);
    for(let part=1;part<=4;part++){
      const source=data.transcript[String(part)];
      assert.equal(typeof source,'string');
      assert(source.length>1500,`Test ${number} Part ${part}: incomplete source`);
      assert.doesNotMatch(source,/Full verbatim transcript is not present/i);
      const rows=data.script_completion.filter(gap=>gap.part===part);
      assert(rows.length>=6,`Test ${number} Part ${part}: graded gaps missing`);
      for(const row of rows){
        assert(source.toLowerCase().includes(String(row.match).toLowerCase()),
          `Test ${number} Part ${part}: missing source text for gap ${row.n}`);
      }
      gaps+=rows.length;
      parts++;
    }
  }
  assert.equal(parts,20);
  assert(gaps>=120);
});

test('Listening Tests 12–16 maintain canonical and runtime checksums independently',()=>{
  for(let number=12;number<=16;number++){
    const index=String(number).padStart(2,'0');
    const runtime=runtimeFor(number);
    const source=readFileSync(new URL('content/listening/academic/test-'+index+'/source.html',root),'utf8');
    const manifest=JSON.parse(readFileSync(new URL('content/listening/academic/test-'+index+'/manifest.json',root),'utf8'));
    const all=JSON.parse(readFileSync(new URL('services/backend/assets/listening/manifest.json',root),'utf8'));
    const record=all.entries['test-'+index];
    assert.equal(manifest.number,number);
    assert.equal(manifest.questionCount,40);
    assert.equal(manifest.sectionCount,4);
    assert.equal(hash(source),manifest.sourceSha256,'canonical checksum: '+number);
    assert.equal(hash(runtime.raw),record.runtimeSha256,'runtime checksum: '+number);
    assert.equal(Buffer.byteLength(runtime.raw),record.bytes,'runtime size: '+number);
    assert.equal(record.sourceSha256,manifest.sourceSha256);
    assert.match(runtime.html,/const DATA=/);
    assert.equal(manifest.audio.objectKey,'listening/academic/test-'+index+'/full.mp3');
  }
});

test('Listening 12–16 Script word lookup uses an exact source span and the existing Vocabulary save bridge',()=>{
  const bridge=paintedBridge('test-token',{},'Notes','test-storage',null,false,[]);
  assert.match(bridge,/mode:'script-context'/);
  assert.match(bridge,/startChar:begin,endChar:end/);
  assert.match(bridge,/occurrences\.filter/);
  assert.match(bridge,/matches\.length===0/);
  new Function(bridge);
  const script=originalScriptAccessibility('test-token');
  assert.match(script,/la-script-lexical-word/);
  assert.match(script,/lexicalSaved/);
  const parent=readFileSync(new URL('frontend/vanilla/modules/listening/authored.js',root),'utf8');
  assert.match(parent,/contextualScriptWord\(d\)/);
  assert.match(parent,/refreshScriptSaved\(\)/);
  assert.match(parent,/onSavedStatus:saved/);
  const server=readFileSync(new URL('services/backend/app/retention_meaning.py',root),'utf8');
  assert.match(server,/source_type='listening'/);
  assert.match(server,/resolution_status='resolved'/);
  assert.match(server,/js_slice\(body, row\['start_char'\], row\['end_char'\]\)/);
});
