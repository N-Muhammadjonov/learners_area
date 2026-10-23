import {el} from '../../js/dom.js';
/** Source: src/lib/embed.ts, src/components/speaking/MaterialPlayer.tsx and BlockRenderer.tsx.
 * URL parsing is presentation only; backend authorisation of media remains mandatory. */
function allowedURL(raw) {
  try { const u=new URL(raw,location.origin); return ['http:','https:'].includes(u.protocol)?u:null; }
  catch {return null;}
}
export function materialPlayer({url,type,openLabel,emptyLabel}) {
  if (!url) return el('p',{class:'rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500','data-material-empty':''},emptyLabel);
  const u=allowedURL(url);
  if (!u) return el('p',{class:'text-sm text-ink-500','data-material-empty':''},emptyLabel);
  const host=u.hostname.toLowerCase();
  let videoId=null;
  if (host==='youtu.be'||host==='www.youtu.be') videoId=u.pathname.slice(1);
  if (host==='youtube.com'||host==='www.youtube.com') {
    if(u.pathname==='/watch')videoId=u.searchParams.get('v');
    else if(u.pathname.startsWith('/embed/'))videoId=u.pathname.slice(7).split('/')[0];
    else if(u.pathname.startsWith('/shorts/'))videoId=u.pathname.slice(8).split('/')[0];
  }
  if (videoId&&/^[A-Za-z0-9_-]{11}$/.test(videoId))return el('div',{class:'aspect-video w-full overflow-hidden rounded-md bg-ink-950'},
    el('iframe',{src:`https://www.youtube-nocookie.com/embed/${videoId}`,class:'h-full w-full',allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',allowfullscreen:'',title:openLabel,loading:'lazy'}));
  const path=u.pathname;
  if(/\.(mp4|webm|ogg|mov)$/i.test(path))return el('video',{controls:'',preload:'metadata',playsinline:'',src:u.href,class:'w-full rounded-md bg-ink-950'});
  if(/\.(mp3|wav|m4a|ogg)$/i.test(path))return el('audio',{controls:'',preload:'none',src:u.href,class:'w-full'});
  return el('a',{href:u.href,target:'_blank',rel:'noreferrer noopener',class:'btn-secondary'},`${openLabel} ↗`);
}
function readableBytes(n){if(!Number.isFinite(n)||n<=0)return '';return n<1048576?`${Math.round(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;}
export function blockRenderer(block,dict){
  const t=dict.speaking;
  if(!block||typeof block!=='object')return null;
  switch(block.type){
   case 'text': return el('p',{class:'whitespace-pre-line text-sm text-ink-700'},block.textContent??'');
   case 'image': return block.objectUrl&&allowedURL(block.objectUrl)?el('img',{src:block.objectUrl,alt:block.originalName??'',loading:'lazy',class:'max-h-96 w-full rounded-md object-contain'}):null;
   case 'audio': return materialPlayer({url:block.objectUrl,type:'audio',openLabel:t.openMaterial,emptyLabel:t.noFileYet});
   case 'link': return materialPlayer({url:block.linkUrl,type:'link',openLabel:t.openMaterial,emptyLabel:t.noFileYet});
   case 'file': return block.objectUrl&&allowedURL(block.objectUrl)?el('a',{href:block.objectUrl,target:'_blank',rel:'noreferrer noopener',class:'flex items-center gap-2 rounded-sm border border-ink-100 bg-paper-sunken px-3 py-2 text-sm'},
       el('span',{'aria-hidden':'true'},'📄'),el('span',{class:'flex-1 truncate text-ink-900'},block.originalName??'File'),el('span',{class:'text-xs text-ink-300'},readableBytes(block.size))):null;
   default:return null;
  }
}
export function stopMedia(node){for(const item of node.querySelectorAll('audio,video')) {item.pause();item.removeAttribute('src');item.querySelector('source')?.removeAttribute('src');item.load();}
 for(const frame of node.querySelectorAll('iframe'))frame.removeAttribute('src');}
