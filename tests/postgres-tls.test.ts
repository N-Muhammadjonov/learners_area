import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import pg from 'pg';
import {postgresConnectionOptions} from '../src/db/postgres-connection';
import {SUPABASE_ROOT_CA} from '../src/db/supabase-root-ca';

test('Supabase pooler/direct connections verify the pinned CA and actual hostname even with URL SSL overrides',()=>{
 for(const host of ['aws-0-ap-southeast-1.pooler.supabase.com','db.fixture.supabase.co']){
  for(const mode of ['disable','require','no-verify']){
   const options=postgresConnectionOptions(`postgresql://fixture:fixture@${host}:5432/postgres?sslmode=${mode}&sslrootcert=missing&application_name=fixture`);
   assert.equal(new URL(options.connectionString!).searchParams.has('sslmode'),false);
   assert.equal(new URL(options.connectionString!).searchParams.get('application_name'),'fixture');
   const client=new pg.Client(options),ssl=client.ssl as unknown as {ca:string;rejectUnauthorized:boolean;servername:string};
   assert.equal(ssl.rejectUnauthorized,true);assert.equal(ssl.servername,host);assert.equal(ssl.ca,SUPABASE_ROOT_CA);
  }
 }
});
test('native loopback fixtures and other providers retain their established SSL behavior; lookalike hosts never receive this CA',()=>{
 for(const url of ['postgres://fixture@127.0.0.1:5432/fixture','postgres://fixture@localhost:5432/fixture','postgres://fixture@[::1]:5432/fixture','postgres://fixture@postgres.internal/fixture?sslmode=verify-full','postgres://fixture@pooler.supabase.com.attacker.invalid/fixture'])assert.deepEqual(postgresConnectionOptions(url),{connectionString:url});
 assert.deepEqual(postgresConnectionOptions(undefined),{connectionString:undefined});
});
test('the bundled certificate is the public provider CA, with the audited fingerprint and no private key',()=>{
 const cert=new X509Certificate(SUPABASE_ROOT_CA);
 assert.equal(cert.ca,true);assert.equal(cert.fingerprint256.replaceAll(':','').toLowerCase(),'807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa');
 assert.equal(cert.verify(cert.publicKey),true);assert.ok(new Date(cert.validTo)>new Date());assert.doesNotMatch(SUPABASE_ROOT_CA,/PRIVATE KEY/);
});
