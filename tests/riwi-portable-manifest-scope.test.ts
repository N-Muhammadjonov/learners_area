import test from "node:test";
import assert from "node:assert/strict";
import { exportPortableArchive, importPortableArchive, sha256, stableJson, verifyManifest } from "../src/lib/portability/archive";
import type { PortableManifest } from "../src/lib/portability/types";

test("even rehashed manifests cannot smuggle private objects, unknown modes or invalid row metadata past import preflight",async()=>{
  const manifest=await exportPortableArchive({scope:'riwi',objectMode:'keep-r2',sourceFingerprint:'scope-proof',source:{async *rows(){},async *objects(){}},sink:{async beginFile(){},async write(){},async endFile(){}}});
  const rehash=(change:Record<string,unknown>)=>{
    const {manifestSha256:_,...unsigned}={...manifest,...change};
    return {...unsigned,manifestSha256:sha256(stableJson(unsigned))} as PortableManifest;
  };
  const object={objectClass:'riwi-knowledge-source',sourceKey:'source.pdf',destinationKey:null,ownerId:null,scope:'global',retentionState:'active',sha256:sha256('pdf'),byteLength:3,mimeType:'application/pdf'};
  for(const change of [{objectClass:'speaking-audio'},{scope:'user'},{ownerId:'private-user'},{scope:'invented'}]) {
    const bad=rehash({objects:[{...object,...change}]});let called=false;
    await assert.rejects(importPortableArchive({manifest:bad,dryRun:true,archive:{async *readRows(){},async readObject(){return new Uint8Array();}},destination:{async transaction(){called=true;throw new Error('Must not start');}}}),/private_object|object_invalid/);
    assert.equal(called,false);
  }
  assert.throws(()=>verifyManifest(rehash({scope:'invented',tables:[]})),/mode_invalid/);
  assert.throws(()=>verifyManifest(rehash({objectMode:'invented'})),/mode_invalid/);
  assert.throws(()=>verifyManifest(rehash({tables:manifest.tables.map((t,i)=>i===0?{...t,rowCount:-1}:t)})),/table_invalid/);
  assert.throws(()=>verifyManifest(rehash({tables:manifest.tables.map((t,i)=>i===0?{...t,file:'../private'}:t)})),/table_invalid/);
  verifyManifest(rehash({objects:[object]}));
});
