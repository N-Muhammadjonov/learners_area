/** Scoped diagnostic for installed Playwright1.51.1, not website code. */
import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(import.meta.url);
export function observeFrameHandles(){
 const {CRPage}=require(path.resolve(import.meta.dirname,'../node_modules/playwright-core/lib/server/chromium/crPage.js'));const original=CRPage.prototype.getFrameElement,rows=[];
 CRPage.prototype.getFrameElement=async function(...args){const h=await original.apply(this,args);rows.push({ref:new WeakRef(h),id:h._objectId,client:h._context.delegate._client,stack:new Error().stack});return h;};
 return {metadata:()=>rows.map(r=>({id:r.id,serverHandleLive:!!r.ref.deref(),disposed:r.ref.deref()?._disposed,stack:r.stack})),async release(){for(const r of rows){r.ref.deref()?.dispose();await r.client.send('Runtime.releaseObject',{objectId:r.id}).catch(()=>{});}},restore(){CRPage.prototype.getFrameElement=original;}};
}
