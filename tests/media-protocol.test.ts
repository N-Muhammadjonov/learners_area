import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createMediaCapability,verifyMediaCapability,createMediaAuthorizationProof,verifyMediaAuthorizationProof,mediaCapabilityUrl,decodeMediaKey,parseMediaRange} from '../src/lib/media/protocol';
const secret='fixture-only-shared-secret-32-characters';
const scope={uid:'11111111-1111-4111-8111-111111111111',authVersion:2,sessionKey:'a'.repeat(64),sessionExpiresAt:2000,key:'listening/academic/test-01/full.mp3'};
test('Node HMAC and shared WebCrypto agree on exact versioned bytes; resource claims cannot be substituted',async()=>{
 const {token,claims}=await createMediaCapability(secret,scope,{now:1000});const [payload,signature]=token.split('.');
 assert.equal(signature,createHmac('sha256',secret).update('la-media-read-v1\n'+payload).digest('base64url'));
 assert.deepEqual(await verifyMediaCapability(secret,token,scope.key,1000),claims);
 assert.equal(await verifyMediaCapability(secret,token,scope.key,1120),null);
 assert.equal(await verifyMediaCapability(secret,token,scope.key+'x',1000),null);
 for(const malformed of ['',token+'=',token+'.x',token.slice(0,-1)+'!',token.replace(payload!,payload!.slice(1)),token.replace(signature!,signature!.slice(1)),token.replace('.', '..')])assert.equal(await verifyMediaCapability(secret,malformed,scope.key,1000),null);
 assert.equal(await verifyMediaCapability(secret+'wrong',token,scope.key,1000),null);
 const url=new URL(mediaCapabilityUrl('https://worker.fixture',scope.key,token));assert.equal(decodeMediaKey(url.pathname.split('/').pop()!),scope.key);
 assert.equal(decodeMediaKey('Li4vYQ'),null);
});
test('session expiry clamps transport life; invalid identity and traversal fail before signing',async()=>{
 const {claims}=await createMediaCapability(secret,{...scope,sessionExpiresAt:1050},{now:1000,ttlSeconds:9999});assert.equal(claims.exp,1050);
 for(const invalid of [{key:'../a'},{key:'/a'},{key:'a//b'},{key:'a/./b'},{key:'a?b'},{uid:'unverified'},{sessionKey:'raw-jwt'},{authVersion:-1},{sessionExpiresAt:999}])await assert.rejects(createMediaCapability(secret,{...scope,...invalid},{now:1000}));
 await assert.rejects(createMediaCapability('short',scope,{now:1000}));
});
test('backchannel proof is purpose/method/token/time bound and cannot be a public read signature',async()=>{
 const {token}=await createMediaCapability(secret,scope,{now:1000});const input={method:'GET' as const,token,timestamp:1000};const proof=await createMediaAuthorizationProof(secret,input);
 assert.equal(proof,createHmac('sha256',secret).update(JSON.stringify(['la-media-backchannel-v1','GET',token,1000])).digest('base64url'));
 assert.equal(await verifyMediaAuthorizationProof(secret,{...input,proof},1000),true);
 for(const changed of [{method:'HEAD' as const},{token:token+'x'},{timestamp:1001},{proof:token.split('.')[1]!}])assert.equal(await verifyMediaAuthorizationProof(secret,{...input,proof,...changed},1000),false);
 assert.equal(await verifyMediaAuthorizationProof(secret,{...input,proof},1031),false);
});
test('byte ranges handle open/suffix/clamp and reject multipart, empty/unsafe/unsatisfiable',()=>{
 assert.deepEqual(parseMediaRange('bytes=2-5',10),{start:2,end:5});assert.deepEqual(parseMediaRange('bytes=2-',10),{start:2,end:9});assert.deepEqual(parseMediaRange('bytes=-3',10),{start:7,end:9});assert.deepEqual(parseMediaRange('bytes=-30',10),{start:0,end:9});assert.deepEqual(parseMediaRange('bytes=2-100',10),{start:2,end:9});
 for(const value of ['bytes=-0','bytes=-','bytes=10-','bytes=5-2','bytes=1-3,5-7','items=0-1','bytes=9007199254740992-','bytes=1-9007199254740992'])assert.equal(parseMediaRange(value,10),null,value);
 assert.equal(parseMediaRange('bytes=0-',0),null);
});
