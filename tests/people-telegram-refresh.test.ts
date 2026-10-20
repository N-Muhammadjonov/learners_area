import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {refreshPeopleUsernames} from '../src/lib/telegram/people-refresh';
test('Telegram refresh handles renamed/removed usernames, verifies numeric identity, throttles calls and preserves verified phone/login binding',async()=>{
 const e=await createTestDatabase();try{
 const [u]=await e.query<{id:string}>("insert into users(name,telegram_id) values('QA identity','991122333000') returning id");
 await e.query("insert into telegram_contacts(telegram_user_id,chat_id,linked_user_id,phone_number,phone_verified_at) values('991122333000','991122333000',$1,'+998000000000',now())",[u!.id]);
 let calls=0,body:Record<string,unknown>={},answer:Record<string,unknown>={id:991122333000,type:'private',username:'new_username'};
 const request:typeof fetch=async(_url,options)=>{calls++;body=JSON.parse(String(options?.body));return Response.json({ok:true,result:answer});};
 const now=Date.now(),deps={database:e.db,token:'123456:fixture-token-for-unit-tests-only',request,now};
 assert.equal((await refreshPeopleUsernames([u!.id],deps)).changed,true);assert.equal(body.chat_id,'991122333000');
 assert.equal((await refreshPeopleUsernames([u!.id],deps)).changed,false);assert.equal(calls,1,'one lookup per minute');
 answer={id:123,type:'private',username:'forged'};assert.equal((await refreshPeopleUsernames([u!.id],{...deps,now:now+61000})).changed,false);
 answer={id:991122333000,type:'private'};assert.equal((await refreshPeopleUsernames([u!.id],{...deps,now:now+122000})).changed,true);
 const [contact]=await e.query<{username:null;phone_number:string}>("select username,phone_number from telegram_contacts where linked_user_id=$1",[u!.id]);assert.equal(contact!.username,null);assert.equal(contact!.phone_number,'+998000000000');
 const [user]=await e.query<{telegram_id:string}>("select telegram_id from users where id=$1",[u!.id]);assert.equal(user!.telegram_id,'991122333000');
 }finally{await e.close();}
});
