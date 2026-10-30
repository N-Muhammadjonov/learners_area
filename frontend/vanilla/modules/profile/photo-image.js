/** Original centered circular 256px PNG crop. Decode without blob: CSP changes. */
export async function profilePng(file,{signal,document:doc=document,bitmapDecode=globalThis.createImageBitmap}={}){
 if(!file?.type?.startsWith('image/')||!file.size||file.size>20*1024*1024)throw Error('invalid_image');
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');let image,reader,closed=false;
 const close=bitmap=>{if(!closed&&bitmap){closed=true;bitmap.close?.();}};
 const abort=()=>{if(reader?.readyState===1)reader.abort();image?.removeAttribute?.('src');close(image);};signal?.addEventListener('abort',abort,{once:true});
 const wait=p=>new Promise((resolve,reject)=>{const cancel=()=>reject(new DOMException('Aborted','AbortError'));if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});Promise.resolve(p).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',cancel));});
 try{
  if(typeof bitmapDecode==='function'){const decoded=Promise.resolve(bitmapDecode(file));decoded.then(bitmap=>{if(signal?.aborted)close(bitmap);},()=>{});image=await wait(decoded);}
  else{reader=new FileReader();const data=await wait(new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=()=>reject(Error('invalid_image'));reader.readAsDataURL(file);}));if(signal?.aborted)throw new DOMException('Aborted','AbortError');image=doc.createElement('img');image.src=data;await wait(image.decode());}
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  const canvas=doc.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');if(!ctx||!width||!height)throw Error('invalid_image');
  const side=Math.min(width,height);ctx.beginPath();ctx.arc(128,128,128,0,Math.PI*2);ctx.clip();ctx.drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,256,256);
  const blob=await wait(new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('invalid_image')),'image/png')));if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(blob.size>307200)throw Error('invalid_image');return blob;
 }finally{signal?.removeEventListener('abort',abort);if(reader?.readyState===1)reader.abort();image?.removeAttribute?.('src');close(image);}
}
