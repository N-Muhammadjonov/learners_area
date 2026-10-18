import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {AUTHORED_CSP,AUTHORED_SANDBOX} from '../src/lib/listening/authored-sandbox';
test('only the configured existing Worker can serve parent media and fetched PDF ranges; authored frames remain opaque and offline',()=>{
 const worker='https://learnersarea-media.owneruchunla.workers.dev';
 for(const configured of [worker,'https://attacker.invalid']){
  const script="import {buildCsp} from './src/lib/http/security-headers.ts';console.log(JSON.stringify(buildCsp({nonce:'fixture',secure:true,dev:false})));";
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,MEDIA_WORKER_URL:configured,R2_ENDPOINT:'',S3_ENDPOINT:'',AUTHORIZED_MEDIA_ORIGIN:'',CSP_CONNECT_SRC:''}});
  assert.equal(result.status,0,result.stderr);const csp=JSON.parse(result.stdout) as string;
  for(const directive of ['media-src','connect-src']){const value=csp.split(';').find(item=>item.trim().startsWith(directive))!;assert.equal(value.includes(worker),configured===worker);assert.equal(value.includes('attacker.invalid'),false);assert.equal(value.includes('*'),false);}
 }
 assert.equal(AUTHORED_SANDBOX,'allow-scripts');assert.match(AUTHORED_CSP,/connect-src 'none'/);assert.match(AUTHORED_CSP,/media-src data: blob:/);assert.doesNotMatch(AUTHORED_CSP,/workers.dev|allow-same-origin/);
});
