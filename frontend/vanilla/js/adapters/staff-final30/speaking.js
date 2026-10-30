import {bad,isObj,str,int,bool,oneOf,arr,staffData,rawJson,UUID} from './core.js';
/** Teacher/admin speaking materials. Reads PROPOSED; writes = existing /api/speaking/materials[/:id] (POST/PATCH/DELETE). */
export const CATEGORIES=Object.freeze(['part1','part2','part3','general','top_structures']);
export const BLOCK_TYPES=['text','link','image','audio','file'];
/** A read URL must be a same-origin path or https; never javascript:/data:/http:. */
export function safeUrl(v){if(v==null||v==='')return null;if(typeof v!=='string')throw bad();if(v.startsWith('/')&&!v.startsWith('//'))return v;try{const u=new URL(v);if(u.protocol==='https:')return v;}catch{}throw bad();}
const linkUrl=v=>{if(v==null||v==='')return null;if(typeof v!=='string')throw bad();try{const u=new URL(v);if(['http:','https:'].includes(u.protocol))return v;}catch{}throw bad();};
export function validateManage(d){
 return {rows:arr(d.rows,5000).map(r=>{const m=r.material;if(!isObj(r)||!isObj(m)||!UUID.test(m.id))throw bad();
  return {material:{id:m.id,category:str(m.category,{max:40}),title:str(m.title,{max:300}),isActive:bool(m.isActive),primaryType:m.primaryType==null?null:str(m.primaryType,{max:20}),primaryUrl:linkUrl(m.primaryUrl),primaryObjectKey:m.primaryObjectKey==null?null:str(m.primaryObjectKey,{max:400}),primaryOriginalName:m.primaryOriginalName==null?null:str(m.primaryOriginalName,{max:300}),primaryMimeType:m.primaryMimeType==null?null:str(m.primaryMimeType,{max:150}),primarySize:m.primarySize==null?null:int(m.primarySize)},
   authorName:str(r.authorName,{max:300}),canManage:bool(r.canManage),
   blocks:arr(r.blocks??[],200).map(b=>{if(!isObj(b)||typeof b.id!=='string')throw bad();return {id:b.id,type:oneOf(b.type,BLOCK_TYPES),position:int(b.position),textContent:b.textContent==null?null:str(b.textContent,{max:20000}),linkUrl:linkUrl(b.linkUrl),objectKey:b.objectKey==null?null:str(b.objectKey,{max:400}),objectUrl:safeUrl(b.objectUrl),originalName:b.originalName==null?null:str(b.originalName,{max:300}),mimeType:b.mimeType==null?null:str(b.mimeType,{max:150}),size:b.size==null?null:int(b.size)};})};}),
  canCompose:d.canCompose===true,canCreate:d.canCreate===true,prompts:validatePrompts(d.prompts)};
}
const word=w=>{if(!isObj(w))throw bad();return {term:str(w.term,{max:120}),definitionEn:str(w.definitionEn,{max:500}),translationUz:str(w.translationUz??'',{max:500}),partOfSpeech:str(w.partOfSpeech??'',{max:30}),exampleSentence:str(w.exampleSentence??'',{max:500})};};
/** studySupportSchema (zod) with its defaults. */
export function studySupport(v){const o=isObj(v)?v:{};return {vocabularyHtml:str(o.vocabularyHtml??'',{max:100000}),modelAnswerHtml:str(o.modelAnswerHtml??'',{max:100000}),ideasHtml:str(o.ideasHtml??'',{max:100000}),vocabulary:arr(o.vocabulary??[],100).map(word)};}
export const blankSupport=()=>studySupport({});
export const sharedSpeakingChannels=ch=>[...new Set(ch.some(c=>c==='practice_alone'||c==='live_partner')?[...ch,'practice_alone','live_partner']:ch)];
export const usesSharedSpeakingBank=ch=>ch.includes('practice_alone')||ch.includes('live_partner');
export function validatePrompts(list){return arr(list??[],20000).map(p=>{if(!isObj(p)||!UUID.test(p.id))throw bad();return {id:p.id,part:oneOf(p.part,['part1','part2','part3','general']),topic:p.topic==null?null:str(p.topic,{max:200}),promptText:str(p.promptText,{max:200}),cueCard:p.cueCard==null?null:str(p.cueCard,{max:12000}),followUps:arr(p.followUps??[],20).map(x=>str(x,{max:2000})),availableIn:arr(p.availableIn??[],3).map(x=>oneOf(x,['practice_alone','live_partner','ai'])),publicationState:oneOf(p.publicationState,['draft','scheduled','published','archived']),studySupport:studySupport(p.studySupport)};});}
export const manage=signal=>staffData('speaking-manage',{},signal).then(validateManage);
const fail=r=>Object.assign(new Error('speaking'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
/** Source NewMaterialForm body: {category,title(trimmed),primary:{mode:'link'|'upload',primaryType,primaryUrl|ref:{uploadId}},blocks:[…]}. */
export function blocksPayload(drafts,{requireComplete}){
 return drafts.filter(b=>b.type!=='text'||b.textContent.trim()).filter(b=>b.type!=='link'||b.linkUrl.trim()).map(b=>{
  if(b.type==='text')return {type:'text',textContent:b.textContent};if(b.type==='link')return {type:'link',linkUrl:b.linkUrl};
  if(requireComplete&&(b.state!=='complete'||!b.objectKey))return null;return {type:b.type,ref:{uploadId:b.uploadId,objectKey:b.objectKey}};}).filter(Boolean);
}
export function primaryPayload(p,{create}){
 if(p.mode==='link'){if(!create&&!p.primaryUrl.startsWith('http'))return null;return {mode:'link',primaryType:'link',primaryUrl:p.primaryUrl};}
 if(p.mode==='upload'&&(create||p.state==='complete'))return {mode:'upload',primaryType:'file',ref:create?{uploadId:p.uploadId}:{uploadId:p.uploadId,objectKey:p.objectKey}};
 return null;
}
export async function createMaterial({category,title,primary,blocks},signal){
 if(!CATEGORIES.includes(category)||!title.trim())throw new TypeError('invalid');
 const r=await rawJson('POST','/api/speaking/materials',{category,title:title.trim(),primary,blocks},signal,{timeout:25000});if(!r.ok)throw fail(r);return r.data;
}
export async function patchMaterial(id,body,signal){if(!UUID.test(id))throw new TypeError('invalid');const r=await rawJson('PATCH',`/api/speaking/materials/${id}`,body,signal,{timeout:25000});if(!r.ok)throw fail(r);return r.data;}
export async function deleteMaterial(id,signal){if(!UUID.test(id))throw new TypeError('invalid');const r=await rawJson('DELETE',`/api/speaking/materials/${id}`,undefined,signal,{timeout:25000});if(!r.ok)throw fail(r);}
/* ---- embed resolver (lib/embed.ts) ---- */
function youTubeId(u){const h=u.hostname.replace(/^www\./,'');if(h==='youtu.be')return u.pathname.slice(1).split('/')[0]||null;if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(h)){if(u.pathname==='/watch')return u.searchParams.get('v');const m=/^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(u.pathname);return m?m[1]:null;}return null;}
export function resolveEmbedSource(raw,primaryType){
 let url;try{url=new URL(raw);}catch{return {kind:'external',url:raw};}
 const yt=youTubeId(url);if(yt&&/^[\w-]{6,}$/.test(yt))return {kind:'iframe',embedUrl:`https://www.youtube-nocookie.com/embed/${yt}`};
 const v=/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url.pathname),a=/\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(url.pathname);
 if(primaryType==='video'&&v)return {kind:'video',src:raw};if(primaryType==='audio'&&a)return {kind:'audio',src:raw};if(v)return {kind:'video',src:raw};if(a)return {kind:'audio',src:raw};
 return {kind:'external',url:raw};
}
/** POST/DELETE /api/speaking/topics (administrator only on the server). 409 topic_conflict = someone else changed the topic. */
export async function saveTopic(body,archive,signal){
 const r=await rawJson(archive?'DELETE':'POST','/api/speaking/topics',body,signal,{timeout:25000});
 if(!r.ok)throw Object.assign(new Error('topic'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
 if(archive)return {};const saved=validatePrompts(r.data?.prompts);if(!saved[0]||saved[0].part==='general')throw bad('invalid_response');return {prompts:saved};
}
