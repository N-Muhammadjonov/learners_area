import {el,listen} from '../../js/dom.js';import {mediaSource} from '../../js/adapters/media-v9.js';
/** Source MaterialPlayer branches, persistent native nodes and owned failure/retry disposal. */
export function materialPlayer(context,{url,type,classification,openLabel,emptyLabel}){
 const source=mediaSource(url,type,classification),{dict,signal}=context,host=el('div',{'data-material-player':source.kind});let media,frame;
 if(source.kind==='empty'){host.append(el('p',{class:'rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500','data-material-empty':''},emptyLabel));return host;}
 const link=()=>el('a',{href:source.url,target:'_blank',rel:'noreferrer noopener',class:'btn-secondary'},openLabel+' ↗');
 if(source.kind==='external'){host.append(link());return host;}
 const status=el('div',{hidden:true,'data-material-failure':''}),retry=el('button',{type:'button',class:'btn-secondary'},dict.globalDictionary.retry);status.append(el('p',{role:'alert',class:'text-sm text-band-bad'},dict.listening.speedAudioError),retry);if(!source.private)status.append(link());
 if(source.kind==='iframe'){frame=el('iframe',{src:source.url,title:openLabel,class:'h-full w-full',sandbox:'allow-scripts',allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',allowfullscreen:true,referrerpolicy:'strict-origin-when-cross-origin'});host.append(el('div',{class:'aspect-video w-full overflow-hidden rounded-md bg-ink-950'},frame),link());listen(frame,'error',()=>status.hidden=false,signal);}
 else{media=el(source.kind,{controls:true,preload:'none',class:source.kind==='video'?'w-full rounded-md bg-ink-950':'w-full',src:source.url});host.append(media);listen(media,'error',()=>status.hidden=false,signal);listen(media,'canplay',()=>status.hidden=true,signal);}
 host.append(status);listen(retry,'click',()=>{if(signal.aborted)return;status.hidden=true;if(media){const position=media.currentTime;media.load();media.addEventListener('loadedmetadata',()=>{if(Number.isFinite(position))media.currentTime=position;},{signal,once:true});}else{frame.removeAttribute('src');frame.src=source.url;}},signal);
 signal.addEventListener('abort',()=>{if(media){media.pause();media.removeAttribute('src');media.load();}if(frame){frame.removeAttribute('src');frame.remove();}host.replaceChildren();},{once:true});return host;
}
