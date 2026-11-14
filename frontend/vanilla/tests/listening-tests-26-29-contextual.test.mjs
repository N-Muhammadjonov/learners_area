import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paintedBridge} from '../modules/listening/authored-progressive.js';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

const root=new URL('../../../',import.meta.url);

function sourceFor(testNumber){
  const code=String(testNumber).padStart(2,'0');
  const source=JSON.parse(readFileSync(new URL('services/backend/assets/listening/test-'+code+'.json',root),'utf8'));
  assert.equal(source.entryPath,'source.html');
  const html=source.files[source.entryPath];
  assert.equal(typeof html,'string');
  const marker='const DATA=';
  const begin=html.indexOf(marker)+marker.length;
  assert(begin>=marker.length);
  let depth=0,quoted=false,escaped=false;
  for(let i=begin;i<html.length;i++){
    const ch=html[i];
    if(quoted){
      if(escaped)escaped=false;
      else if(ch==='\\')escaped=true;
      else if(ch==='"')quoted=false;
      continue;
    }
    if(ch==='"'){quoted=true;continue;}
    if(ch==='{'||ch==='[')depth++;
    if((ch==='}'||ch===']')&&--depth===0){
      return {html,data:JSON.parse(html.slice(begin,i+1))};
    }
  }
  throw Error('Missing original DATA in '+testNumber);
}

test('Listening 26–29 keep 16 real transcript sections and 160 IELTS questions',()=>{
  let parts=0,questions=0;
  for(let number=26;number<=29;number++){
    const {html,data}=sourceFor(number);
    assert.match(html,/function renderScript\(/);
    assert.equal(Object.keys(data.transcript).length,4);
    assert.equal(data.questions.length,40);
    questions+=data.questions.length;
    for(let part=1;part<=4;part++){
      const body=data.transcript[String(part)];
      assert.equal(typeof body,'string');
      assert(body.length>=1300,'Incomplete transcript in Test '+number+' Part '+part);
      assert.doesNotMatch(body,/Full verbatim transcript is not present/i);
      parts++;
    }
  }
  assert.equal(parts,16);
  assert.equal(questions,160);
});

test('Listening 26–29 keep source-exact Script Completion, unmodified audio manifests',()=>{
  for(let number=26;number<=29;number++){
    const code=String(number).padStart(2,'0');
    const {data}=sourceFor(number);
    const manifest=JSON.parse(readFileSync(new URL('content/listening/academic/test-'+code+'/manifest.json',root),'utf8'));
    assert.equal(manifest.number,number);
    assert.equal(manifest.sectionCount,4);
    assert.equal(manifest.questionCount,40);
    assert.equal(manifest.audio.objectKey,'listening/academic/test-'+code+'/full.mp3');
    assert(Array.isArray(data.script_completion));
    for(const gap of data.script_completion){
      assert(Number.isInteger(gap.part)&&gap.part>=1&&gap.part<=4);
      assert(data.transcript[String(gap.part)].toLowerCase().includes(String(gap.match).toLowerCase()),
        'Script gap not present in Test '+number+' Part '+gap.part);
    }
  }
});

test('Listening 26–29 Script meanings preserve contextual span offsets and Vocabulary saving',()=>{
  const bridge=paintedBridge('fixture',{},'Notes','storage',null,false,[]);
  assert.match(bridge,/mode:'script'/);
  assert.doesNotMatch(bridge,/mode:'script-context'/);
  assert.match(bridge,/startChar:begin,endChar:end/);
  assert.match(bridge,/occurrences\.filter/);
  assert.match(bridge,/matches\.length===0/);
  new Function(bridge);
  const original=originalScriptAccessibility('fixture');
  assert.match(original,/la-script-lexical-word/);
  assert.match(original,/lexicalSaved/);
  const authored=readFileSync(new URL('frontend/vanilla/modules/listening/authored.js',root),'utf8');
  assert.match(authored,/contextualScriptWord\(d\)/);
  assert.match(authored,/refreshScriptSaved\(\)/);
  assert.match(authored,/onSavedStatus:saved/);
});
