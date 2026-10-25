/** Fixture-only callback gate. Never included in application runtime or original files. */
export const recoveryOrderProbe=`<script>(()=>{
 const native=setTimeout;window.__v29order=[];
 const log=(event)=>{const box=document.querySelector('.score-box'),modal=document.getElementById('globalModal');window.__v29order.push({event,at:performance.now(),score:box?.querySelector('b')?.textContent,modalHidden:modal?.classList.contains('hidden'),active:document.querySelector('.activity.active')?.id,busy:document.getElementById('hub')?.getAttribute('aria-busy')});};
 window.setTimeout=function(fn,ms,...args){if(ms===50&&typeof fn==='function'&&fn.toString().includes('openActivity(hash)')){log('original-hash-callback-held');window.__v29releaseHash=()=>{log('before-native-hash-navigation');fn(...args);log('after-native-hash-navigation');};return 0;}return native(fn,ms,...args);};
 document.addEventListener('DOMContentLoaded',()=>queueMicrotask(()=>{for(const name of ['showResults','showModal','closeModal','openActivity']){const fn=window[name];if(typeof fn!=='function')continue;window[name]=function(...args){log('before-'+name);const result=fn.apply(this,args);log('after-'+name);return result;};}}));
})();<\/script>`;
