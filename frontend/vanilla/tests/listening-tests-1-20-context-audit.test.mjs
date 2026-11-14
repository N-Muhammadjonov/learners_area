import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paintedBridge} from '../modules/listening/authored-progressive.js';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

function sourceData(number) {
  const path=new URL('../../../services/backend/assets/listening/test-'+String(number).padStart(2,'0')+'.json',import.meta.url);
  const runtime=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(runtime.entryPath,'source.html');
  const html=runtime.files[runtime.entryPath];
  assert.equal(typeof html,'string');
  const marker='const DATA=';
  const begin=html.indexOf(marker)+marker.length;
  assert(begin>=marker.length);
  let depth=0,quote=false,escape=false;
  for(let i=begin;i<html.length;i++){
    const c=html[i];
    if(quote){
      if(escape)escape=false;
      else if(c==='\\')escape=true;
      else if(c==='"')quote=false;
    }else{
      if(c==='"')quote=true;
      else if(c==='{'||c==='[')depth++;
      else if((c==='}'||c===']')&&--depth===0)return JSON.parse(html.slice(begin,i+1));
    }
  }
  throw Error('Incomplete source DATA: '+number);
}

test('Listening Tests 1–20 retain eighty original transcript sections',()=>{
  let sections=0;
  for(let n=1;n<=20;n++){
    const data=sourceData(n);
    for(let part=1;part<=4;part++){
      const transcript=data.transcript[String(part)];
      assert.equal(typeof transcript,'string','Test '+n+' Part '+part);
      assert(transcript.length>=1500,'Short transcript: Test '+n+' Part '+part);
      sections++;
    }
  }
  assert.equal(sections,80);
});

test('Listening 17–20 all retain 40 graded questions and source-exact Script Completion gaps',()=>{
  for(let n=17;n<=20;n++){
    const data=sourceData(n);
    const questions=data.questions;
    assert.equal(questions.length,40,'Test '+n+' question count');
    const gaps=data.script_completion;
    assert(Array.isArray(gaps)&&gaps.length>=20,'Test '+n+' Script gaps');
    for(const row of gaps){
      assert(Number.isInteger(row.part)&&row.part>=1&&row.part<=4);
      const body=data.transcript[String(row.part)];
      assert(body.toLowerCase().includes(String(row.match).toLowerCase()),
        'Missing exact Script gap text in Test '+n+' Part '+row.part);
    }
  }
});

test('Listening Script dictionary interactions preserve offsets and Vocabulary saved markers',()=>{
  const script=paintedBridge('fixture',{},'Notes','storage',null,false,[]);
  assert.match(script,/mode:'script-context'/);
  assert.match(script,/startChar:begin,endChar:end/);
  assert.match(script,/occurrences\.filter/);
  new Function(script);
  const accessibility=originalScriptAccessibility('fixture');
  assert.match(accessibility,/la-script-lexical-word/);
  assert.match(accessibility,/lexicalSaved/);
  const authored=readFileSync(new URL('../modules/listening/authored.js',import.meta.url),'utf8');
  assert.match(authored,/contextualScriptWord\(d\)/);
  assert.match(authored,/refreshScriptSaved\(\)/);
  assert.match(authored,/onSavedStatus:saved/);
});
