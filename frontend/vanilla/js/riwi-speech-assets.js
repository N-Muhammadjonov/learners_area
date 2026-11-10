/** ASR can fetch only versioned public assets. It cannot POST audio or contact a vendor. */
export function createSpeechAssetFetch({root,manifest,fetch:read,crypto:hashes=globalThis.crypto,onProgress}={}){
 const base=new URL(root),partsBase=new URL(manifest.partsBase??'./',base),pending=new Map(),completed=new Set();let loaded=0;
 if(partsBase.origin!==base.origin)throw Error('asr_network_forbidden');
 const digest=async bytes=>[...new Uint8Array(await hashes.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 async function assemble(asset){
  if(!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>100_000_000)throw Error('asr_asset_invalid');
  const result=new Uint8Array(asset.bytes);let at=0;
  for(const part of asset.parts){
   if(!/^parts\/[a-f0-9]{16}-\d{3}\.bin$/.test(part.path)||part.bytes>2*1024*1024)throw Error('asr_asset_invalid');
   const url=new URL(part.path,partsBase),options={method:'GET',credentials:'same-origin',cache:'force-cache',redirect:'error'};
   let response=await read(url,options);
   // A Preview may have cached a missing part before its static files arrived.
   // Retry that bounded GET once without reusing the negative browser cache.
   if(response.status===404)response=await read(url,{...options,cache:'reload'});
   if(!response.ok)throw Error('asr_asset_unavailable');const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length!==part.bytes||at+bytes.length>result.length||await digest(bytes)!==part.sha256)throw Error('asr_asset_integrity');
   result.set(bytes,at);at+=bytes.length;
   if(!completed.has(part.path)){completed.add(part.path);loaded+=bytes.length;onProgress?.(Math.min(.99,loaded/manifest.totalBinaryBytes));}
  }
  if(at!==result.length||await digest(result)!==asset.sha256)throw Error('asr_asset_integrity');
  return result;
 }
 const fetchAsset=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,base);
  const method=options.method??input?.method??'GET';
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||method.toUpperCase()!=='GET'||options.body!=null)throw Error('asr_network_forbidden');
  const name=decodeURIComponent(url.pathname.slice(base.pathname.length)),asset=manifest.assets[name];
  if(!asset)return new Response('',{status:404});
  if(!pending.has(name))pending.set(name,assemble(asset));
  return new Response(await pending.get(name),{headers:{'Content-Type':asset.mime,'Content-Length':String(asset.bytes)}});
 };
 fetchAsset.clear=()=>pending.clear();return fetchAsset;
}
