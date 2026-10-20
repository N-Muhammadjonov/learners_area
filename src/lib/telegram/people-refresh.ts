import "server-only";
import { and,eq,inArray,isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts,users } from "@/db/schema";
const checked=new Map<string,number>();
/** Read-only Telegram getChat; refresh visible identities without blocking the directory.
 * Never reads phones from Telegram or changes the numeric login binding. */
export async function refreshPeopleUsernames(ids:string[],deps:{database?:typeof db;token?:string;request?:typeof fetch;now?:number}={}){
 const token=deps.token??process.env.TELEGRAM_BOT_TOKEN;
 if(!token||!/^\d+:[\w-]{20,}$/.test(token))return {configured:false,changed:false};
 const database=deps.database??db,request=deps.request??fetch,now=deps.now??Date.now();
 const rows=await database.select({telegramId:users.telegramId,username:telegramContacts.username}).from(users).innerJoin(telegramContacts,eq(telegramContacts.telegramUserId,users.telegramId)).where(inArray(users.id,ids.slice(0,25)));
 let changed=false;
 for(let start=0;start<rows.length;start+=5)await Promise.all(rows.slice(start,start+5).map(async row=>{
  const id=row.telegramId;if(!id||now-(checked.get(id)??0)<60_000)return;
  if(checked.size>=1000)for(const [key,at]of checked)if(now-at>60_000)checked.delete(key);
  if(checked.size>=1000)checked.delete(checked.keys().next().value!);
  checked.set(id,now);
  try{
   const r=await request('https://api.telegram.org/bot'+token+'/getChat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:id}),cache:'no-store',signal:AbortSignal.timeout(2000)});
   if(!r.ok)return;const body=await r.json() as {ok?:boolean;result?:{id?:number|string;type?:string;username?:string}};
   if(!body.ok||String(body.result?.id)!==id||body.result?.type!=='private')return;
   const username=typeof body.result.username==='string'?body.result.username.slice(0,120):null;
   if(username!==row.username){await database.update(telegramContacts).set({username,updatedAt:new Date(now)}).where(and(eq(telegramContacts.telegramUserId,id),row.username===null?isNull(telegramContacts.username):eq(telegramContacts.username,row.username)));changed=true;}
  }catch{/* Keep the last authoritative identity on timeout/blocked/unavailable. */}
 }));
 return {configured:true,changed};
}
