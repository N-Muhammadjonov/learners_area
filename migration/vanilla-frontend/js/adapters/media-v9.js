import {ApiError} from '../api-client.js';
import {resource} from './listening-v7.js';
/** Stored public links are distinct from private uploads. Never accept signed storage URLs. */
export function mediaSource(raw,type,classification){
 if(!['audio','video','file','link'].includes(type))throw new ApiError(502,'invalid_media_type');
 if(raw===null)return {kind:'empty'};
 if(resource(raw)){if(raw.split('?')[0].slice('/api/resources/'.length).split('/').some(s=>!s||s==='.'||s==='..'))throw new ApiError(502,'invalid_private_media');if(classification!=null&&classification!=='private')throw new ApiError(502,'invalid_media_classification');return {kind:type==='video'?'video':type==='audio'?'audio':/\.(mp4|webm|mov)(?:\?|$)/i.test(raw)?'video':/\.(mp3|wav|m4a|ogg)(?:\?|$)/i.test(raw)?'audio':'external',url:raw,private:true};}
 if(classification!=='external'||typeof raw!=='string'||raw.length>4000)throw new ApiError(502,'invalid_public_media');
 let u;try{u=new URL(raw);}catch{throw new ApiError(502,'invalid_public_media');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/[\u0000-\u0020\\]/.test(raw)||/\.(r2\.dev|r2\.cloudflarestorage\.com)$/i.test(u.hostname)||[...u.searchParams.keys()].some(k=>/signature|credential|token|x-amz|expires/i.test(k)))throw new ApiError(502,'invalid_public_media');
 let yt=null;if(['youtu.be','www.youtu.be'].includes(u.hostname))yt=u.pathname.slice(1);else if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)){yt=u.pathname==='/watch'?u.searchParams.get('v'): /^\/(?:embed|shorts)\/([^/]+)$/.exec(u.pathname)?.[1];}
 if(yt&&/^[A-Za-z0-9_-]{6,64}$/.test(yt))return {kind:'iframe',url:'https://www.youtube-nocookie.com/embed/'+yt,private:false};
 if(u.protocol==='https:'){const video=/\.(mp4|webm|ogg|mov)$/i.test(u.pathname),audio=/\.(mp3|wav|m4a|ogg)$/i.test(u.pathname);if(type==='video'&&video)return {kind:'video',url:raw,private:false};if(type==='audio'&&audio)return {kind:'audio',url:raw,private:false};if(video)return {kind:'video',url:raw,private:false};if(audio)return {kind:'audio',url:raw,private:false};}
 return {kind:'external',url:raw,private:false};
}
