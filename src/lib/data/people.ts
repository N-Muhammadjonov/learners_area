import "server-only";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, telegramContacts, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import type { AccountStatus } from "@/lib/auth/account-status";
export type PersonRow={id:string;name:string;email:string|null;role:Role;accountStatus:AccountStatus;statusReason:string|null;createdAt:Date;lastActiveAt:Date;telegramLinked:boolean;username?:string|null;phoneNumber?:string|null;online?:boolean;seenAt?:string|null;visitSeconds?:number|null;totalSeconds?:number|null};
export type PeopleFilters={q?:string;role?:Role;status?:AccountStatus;page?:number;online?:boolean};
export const PEOPLE_PAGE_SIZE=25;
const online=sql<boolean>`${activityEvents.createdAt}>now()-interval '90 seconds' and ${users.accountStatus}='active'`;
const presenceJoin=sql`${activityEvents.id}=md5('site-presence:'||${users.id}::text)::uuid and ${activityEvents.type}='SITE_PRESENCE'`;
const contactJoin=and(eq(telegramContacts.telegramUserId,users.telegramId),or(sql`${telegramContacts.linkedUserId} is null`,eq(telegramContacts.linkedUserId,users.id)));
const pattern=(s:string)=>`%${s.replace(/[%_\\]/g,c=>`\\${c}`)}%`;
const query=(s?:string)=>(s??'').trim().slice(0,100);
export function buildPeopleWhere(filters:PeopleFilters={},includePhone=false){
 const q=query(filters.q).replace(/^@/,'');
 return and(filters.role?eq(users.role,filters.role):undefined,filters.status?eq(users.accountStatus,filters.status):ne(users.accountStatus,'rejected'),filters.online?online:undefined,q?or(ilike(users.name,pattern(q)),ilike(telegramContacts.username,pattern(q)),includePhone?sql`regexp_replace(coalesce(${telegramContacts.phoneNumber},''),'[^0-9]','','g') like ${pattern(q.replace(/\D/g,''))} and ${telegramContacts.phoneVerifiedAt} is not null and ${q.replace(/\D/g,'').length>0}`:undefined):undefined);
}
function columns(includePhone:boolean){return {id:users.id,name:users.name,email:users.email,role:users.role,accountStatus:users.accountStatus,statusReason:users.statusReason,createdAt:users.createdAt,lastActiveAt:users.lastActiveAt,telegramId:users.telegramId,username:telegramContacts.username,phoneNumber:includePhone?sql<string|null>`case when ${telegramContacts.phoneVerifiedAt} is not null then ${telegramContacts.phoneNumber} end`:sql<string|null>`null::text`,online:sql<boolean>`coalesce(${online},false)`,seenAt:sql<string|null>`${activityEvents.createdAt}::text`,visitSeconds:sql<number|null>`(${activityEvents.payload}->>'visitSeconds')::int`,totalSeconds:sql<number|null>`(${activityEvents.payload}->>'totalSeconds')::bigint`};}
export function buildPeopleListQuery(filters:PeopleFilters={},page=1,executor:typeof db=db,includePhone=false){
 return executor.select(columns(includePhone)).from(users).leftJoin(telegramContacts,contactJoin).leftJoin(activityEvents,presenceJoin).where(buildPeopleWhere(filters,includePhone)).orderBy(sql`case ${users.role} when 'owner' then 0 when 'teacher' then 1 when 'admin' then 2 else 3 end`,sql`coalesce(${online},false) desc`,sql`coalesce(${activityEvents.createdAt},${users.lastActiveAt}) desc`,desc(users.id)).limit(PEOPLE_PAGE_SIZE).offset((Math.min(100000,Math.max(1,Math.floor(page)||1))-1)*PEOPLE_PAGE_SIZE);
}
export function buildPeopleCountQuery(filters:PeopleFilters={},executor:typeof db=db,includePhone=false){return executor.select({total:sql<number>`count(*)::int`}).from(users).leftJoin(telegramContacts,contactJoin).leftJoin(activityEvents,presenceJoin).where(buildPeopleWhere(filters,includePhone));}
export async function listPeople(filters:PeopleFilters={},executor:typeof db=db,includePhone=false){
 const normalizedFilters={q:query(filters.q),role:filters.role,status:filters.status,online:filters.online};
 const [[countRow],[onlineRow]]=await Promise.all([buildPeopleCountQuery(normalizedFilters,executor,includePhone),buildPeopleCountQuery({online:true},executor)]);
 const total=countRow?.total??0,totalPages=Math.max(1,Math.ceil(total/PEOPLE_PAGE_SIZE)),page=Math.min(totalPages,Math.max(1,Math.floor(filters.page??1)||1));
 const people=(await buildPeopleListQuery(normalizedFilters,page,executor,includePhone)).map(({telegramId,...rest})=>({...rest,telegramLinked:!!telegramId}));
 return{people,filters:normalizedFilters,page,pageSize:PEOPLE_PAGE_SIZE,total,totalPages,onlineCount:onlineRow?.total??0};
}
export async function countPeople(){return db.select({role:users.role,status:users.accountStatus,count:sql<number>`count(*)::int`}).from(users).groupBy(users.role,users.accountStatus);}
export async function findPerson(id:string):Promise<PersonRow|null>{const [row]=await db.select(columns(false)).from(users).leftJoin(telegramContacts,contactJoin).leftJoin(activityEvents,presenceJoin).where(eq(users.id,id));if(!row)return null;const{telegramId,...rest}=row;return{...rest,telegramLinked:!!telegramId};}
