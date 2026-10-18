import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT} from 'jose';
import {eq} from 'drizzle-orm';
import {createTestDatabase} from './support/pglite';
import {users,authSessionRevocations} from '../src/db/schema';
import {createSessionToken,verifySessionToken} from '../src/lib/auth/session';
import {validateSessionAuthority,revokeSession,type SessionAuthorityInput} from '../src/lib/auth/session-authority';

process.env.AUTH_SECRET='isolated-auth-security-secret-never-used-in-production';
const payload=(id:string,authVersion=0)=>({sub:id,authVersion,role:'admin' as const,name:'Fixture',locale:'en',onboarded:true});
async function authority(token:string):Promise<SessionAuthorityInput>{
 const session=await verifySessionToken(token);assert.ok(session);
 return {userId:session.sub,authVersion:session.authVersion,sessionKey:session.sessionKey,expiresAt:session.expiresAt};
}
test('exact-session logout blocks replay while another device and a fresh sign-in stay active',async()=>{
 const d=await createTestDatabase();
 try{
  const [user,other]=await d.db.insert(users).values([{name:'Session learner',accountStatus:'active'},{name:'Other learner',accountStatus:'active'}]).returning();
  const first=await createSessionToken(payload(user!.id)),second=await createSessionToken(payload(user!.id));
  assert.notEqual(first,second,'same-second logins have distinct session ids');
  const a=await authority(first),b=await authority(second);
  assert.equal((await validateSessionAuthority(a,d.db))?.role,'student','cookie role never grants authority');
  await revokeSession(a,d.db);
  assert.equal(await validateSessionAuthority(a,d.db),null);
  assert.equal((await validateSessionAuthority(b,d.db))?.id,user!.id);
  const fresh=await authority(await createSessionToken(payload(user!.id)));
  assert.equal((await validateSessionAuthority(fresh,d.db))?.id,user!.id);
  const otherSession=await authority(await createSessionToken(payload(other!.id)));
  assert.equal((await validateSessionAuthority(otherSession,d.db))?.id,other!.id);
  const stored=await d.db.select().from(authSessionRevocations);
  assert.equal(stored.length,1);assert.equal(stored[0]!.tokenHash,a.sessionKey);
  assert.equal(JSON.stringify(stored).includes(first),false);
  await revokeSession(a,d.db);assert.equal((await d.db.select().from(authSessionRevocations)).length,1,'logout retry is idempotent');
 }finally{await d.close();}
});
test('legacy cookies survive additive rollout, then suspension/reactivation and downgrade irrevocably reject them',async()=>{
 const d=await createTestDatabase();
 try{
  const [user]=await d.db.insert(users).values({name:'Legacy learner',accountStatus:'active',role:'admin'}).returning();
  const {authVersion:_,...legacy}=payload(user!.id);
  const old=await new SignJWT(legacy).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('30d').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const a=await authority(old);assert.equal(a.authVersion,0);
  assert.equal((await validateSessionAuthority(a,d.db))?.role,'admin');
  await d.db.update(users).set({accountStatus:'suspended'}).where(eq(users.id,user!.id));
  assert.equal(await validateSessionAuthority(a,d.db),null);
  await d.db.update(users).set({accountStatus:'active'}).where(eq(users.id,user!.id));
  assert.equal(await validateSessionAuthority(a,d.db),null,'reactivation cannot revive old tokens');
  const [reactivated]=await d.db.select().from(users).where(eq(users.id,user!.id));
  assert.equal(reactivated!.authVersion,2);
  const active=await authority(await createSessionToken(payload(user!.id,reactivated!.authVersion)));
  assert.equal((await validateSessionAuthority(active,d.db))?.role,'admin');
  await d.db.update(users).set({role:'student'}).where(eq(users.id,user!.id));
  assert.equal(await validateSessionAuthority(active,d.db),null,'stale privileged session is terminated');
  const [changed]=await d.db.select().from(users).where(eq(users.id,user!.id));
  const current=await authority(await createSessionToken(payload(user!.id,changed!.authVersion)));
  assert.equal((await validateSessionAuthority(current,d.db))?.role,'student');
 }finally{await d.close();}
});
test('authority epoch changes atomically for every role/status write, never for ordinary profile changes',async()=>{
 const d=await createTestDatabase();
 try{
  const [user]=await d.db.insert(users).values({name:'Epoch learner',accountStatus:'active'}).returning();
  await d.db.update(users).set({name:'Changed name',locale:'en',accountStatus:'active',role:'student'}).where(eq(users.id,user!.id));
  assert.equal((await d.db.select().from(users))[0]!.authVersion,0);
  await assert.rejects(d.db.transaction(async tx=>{
   await tx.update(users).set({role:'teacher'}).where(eq(users.id,user!.id));throw Error('fixture_rollback');
  }),/fixture_rollback/);
  assert.equal((await d.db.select().from(users))[0]!.authVersion,0);
  await d.db.update(users).set({authVersion:1}).where(eq(users.id,user!.id));
  await assert.rejects(d.db.update(users).set({authVersion:0}).where(eq(users.id,user!.id)),/Failed query/);
  assert.equal((await d.db.select().from(users))[0]!.authVersion,1);
  await Promise.all([d.db.update(users).set({role:'teacher'}).where(eq(users.id,user!.id)),d.db.update(users).set({role:'admin'}).where(eq(users.id,user!.id))]);
  assert.equal((await d.db.select().from(users))[0]!.authVersion,3,'concurrent changes cannot lose an epoch');
  const table=await d.query<{enabled:boolean}>("select relrowsecurity as enabled from pg_class where relname='auth_session_revocations'");assert.equal(table[0]!.enabled,true);
 }finally{await d.close();}
});
test('expired or malformed session authority fails before a database read; unavailable identity store fails closed',async()=>{
 let queries=0;
 const unavailable={query:{users:{findFirst:async()=>{queries++;throw Error('isolated_db_failure');}}}} as unknown as Parameters<typeof validateSessionAuthority>[1];
 const input={userId:'00000000-0000-4000-8000-000000000001',authVersion:0,sessionKey:'a'.repeat(64),expiresAt:Math.floor(Date.now()/1000)+60};
 assert.equal(await validateSessionAuthority({...input,expiresAt:0},unavailable),null);
 assert.equal(await validateSessionAuthority({...input,sessionKey:'wrong'},unavailable),null);
 assert.equal(await validateSessionAuthority({...input,authVersion:-1},unavailable),null);
 assert.equal(queries,0);
 await assert.rejects(validateSessionAuthority(input,unavailable),/isolated_db_failure/);assert.equal(queries,1);
 const expired=await new SignJWT(payload(input.userId)).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
 assert.equal(await verifySessionToken(expired),null);
});
