/** File parsing stays on this device; only extracted text is sent with the question. */
export const FILE_ACCEPT='.png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.html,.htm,.csv,.json';
export const MAX_FILE_BYTES=20*1024*1024;
export const MAX_FILE_TEXT=60000;
export const MAX_SOURCE_BYTES=3000000;
const extension=name=>String(name).split('.').at(-1).toLowerCase();
const stopped=signal=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
const fail=code=>{throw Error(code);};
export function stageFile(file){
 const ext=extension(file.name),kind=({png:'image',jpg:'image',jpeg:'image',webp:'image',htm:'html'})[ext]??ext;
 if(!FILE_ACCEPT.split(',').includes('.'+ext))fail('unsupported_file');
 if(!file.size||file.size>MAX_FILE_BYTES)fail('file_size_limit');
 return {name:file.name,kind,file,text:null};
}
function ocrText(result){
 if(typeof result==='string')return result;
 if(!result||typeof result.text!=='string'||Number.isFinite(result.confidence)&&result.confidence<45)fail('file_no_text');
 return result.text;
}
const decode=bytes=>{
 if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
 if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
};
export function htmlText(source){
 const template=document.createElement('template');template.innerHTML=source;
 template.content.querySelectorAll('script,style,head,noscript,template,iframe,object,embed,link,meta,img,video,audio,source').forEach(n=>n.remove());
 template.content.querySelectorAll('p,div,section,article,li,h1,h2,h3,h4,tr,br').forEach(n=>n.append(document.createTextNode('\n')));
 return template.content.textContent.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

/** Read only selected OOXML entries, checking the directory before inflating anything. */
export async function docxText(bytes,signal){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)fail('invalid_docx');
 const count=view.getUint16(end+10,true);let at=view.getUint32(end+16,true),total=0;
 if(!count||count>2000||view.getUint16(end+4,true)||view.getUint16(end+6,true))fail('invalid_docx');
 const entries=[],names=new Set();
 for(let i=0;i<count;i++){
  if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)fail('invalid_docx');
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),packed=view.getUint32(at+20,true),size=view.getUint32(at+24,true);
  const n=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),local=view.getUint32(at+42,true);
  if(at+46+n+extra+comment>bytes.length)fail('invalid_docx');
  const name=decode(bytes.subarray(at+46,at+46+n));total+=size;
  if(names.has(name)||flags&1||total>40000000||size>12000000||/vbaproject/i.test(name))fail('invalid_docx');names.add(name);
  if(/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name))entries.push({name,method,packed,size,local});
  at+=46+n+extra+comment;
 }
 if(!names.has('[Content_Types].xml')||!entries.some(e=>e.name==='word/document.xml'))fail('invalid_docx');
 const texts=[];
 for(const e of entries){
  stopped(signal);
  if(e.local+30>bytes.length||view.getUint32(e.local,true)!==0x04034b50)fail('invalid_docx');
  const offset=e.local+30+view.getUint16(e.local+26,true)+view.getUint16(e.local+28,true);
  if(offset+e.packed>bytes.length||![0,8].includes(e.method))fail('invalid_docx');
  let content=bytes.subarray(offset,offset+e.packed);
  if(e.method===8){
   if(typeof DecompressionStream!=='function')fail('browser_file_reader_unavailable');
   const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let size=0;
   try{while(true){stopped(signal);const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>e.size)fail('invalid_docx');chunks.push(part.value);}}
   finally{await reader.cancel();reader.releaseLock();}
   content=new Uint8Array(size);let pos=0;for(const c of chunks){content.set(c,pos);pos+=c.length;}
  }
  if(content.length!==e.size)fail('invalid_docx');
  const xml=decode(content);if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('invalid_docx');
  const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))fail('invalid_docx');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  for(const p of doc.getElementsByTagNameNS(ns,'p')){
   let line='';for(const n of p.getElementsByTagNameNS(ns,'*')){if(n.localName==='t')line+=n.textContent;else if(n.localName==='tab')line+='\t';else if(['br','cr'].includes(n.localName))line+='\n';}texts.push(line);
  }
 }
 return texts.join('\n');
}

function bitmapCanvas(bitmap){
 if(bitmap.width*bitmap.height>32000000)fail('image_pixel_limit');
 const ratio=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(bitmap.width*ratio);canvas.height=Math.ceil(bitmap.height*ratio);
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas;
}
async function makeOCR(onProgress,signal){
 const root=new URL('./vendor/riwi-files/ocr/',import.meta.url);
 const module=await import(new URL('tesseract.esm.min.js',root).href);
 stopped(signal);
 const creating=module.default.createWorker('eng+uzb+uzb_cyrl',1,{workerPath:new URL('worker.min.js',root).href,corePath:root.href,
  langPath:new URL('lang/',root).href,workerBlobURL:false,cacheMethod:'none',gzip:true,legacyCore:false,
  logger:m=>onProgress?.({stage:'ocr',progress:m.progress??0})});
 let stopInit;const cancelled=new Promise((_,reject)=>{stopInit=()=>reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',stopInit,{once:true});});
 creating.then(w=>{if(signal?.aborted)void w.terminate();},()=>{});
 let worker;try{worker=await Promise.race([creating,cancelled]);}finally{signal?.removeEventListener('abort',stopInit);}
 const abort=()=>{void worker.terminate();};signal?.addEventListener('abort',abort,{once:true});
 return {async read(image){stopped(signal);const result=await worker.recognize(image);stopped(signal);return {text:result.data.text,confidence:result.data.confidence};},
  async close(){signal?.removeEventListener('abort',abort);await worker.terminate();}};
}

export async function readFile(file,{signal,onProgress,ocrFactory=makeOCR}={}){
 const {kind}=stageFile(file);
 stopped(signal);const bytes=new Uint8Array(await file.arrayBuffer());stopped(signal);let text='',ocr;
 const getOCR=async()=>ocr??=await ocrFactory(onProgress,signal);
 try{
  if(kind==='image'){
   const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpeg=bytes[0]===255&&bytes[1]===216;
   const webp=String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
   if(!png&&!jpeg&&!webp)fail('invalid_image');
   if(png&&bytes.length>=24){const v=new DataView(bytes.buffer);if(v.getUint32(16)*v.getUint32(20)>32000000)fail('image_pixel_limit');}
   const bitmap=await createImageBitmap(file);try{text=ocrText(await(await getOCR()).read(bitmapCanvas(bitmap)));}finally{bitmap.close();}
  }else if(kind==='pdf'){
   if(decode(bytes.subarray(0,5))!=='%PDF-')fail('invalid_pdf');
   const root=new URL('./vendor/riwi-files/pdf/',import.meta.url),pdfjs=await import(new URL('pdf.min.mjs',root).href);
   pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',root).href;
   const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('cmaps/',root).href,cMapPacked:true,
    standardFontDataUrl:new URL('standard_fonts/',root).href,wasmUrl:new URL('wasm/',root).href});
   const abort=()=>{void task.destroy();};signal?.addEventListener('abort',abort,{once:true});
   try{
    const pdf=await task.promise;if(pdf.numPages>60)fail('pdf_page_limit');const pages=[];
    for(let i=1;i<=pdf.numPages;i++){
     stopped(signal);onProgress?.({stage:'pdf',page:i,pages:pdf.numPages});const page=await pdf.getPage(i),data=await page.getTextContent();
     let pageText=data.items.filter(x=>'str'in x).map(x=>x.str+(x.hasEOL?'\n':' ')).join('');
     if(pageText.trim().length<8){
      const natural=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,2400/Math.max(natural.width,natural.height))});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;pageText=ocrText(await(await getOCR()).read(canvas));
     }
     pages.push(pageText);if(pages.join('\n\n').length>MAX_FILE_TEXT)fail('file_text_limit');page.cleanup();
    }
    text=pages.join('\n\n');
   }finally{signal?.removeEventListener('abort',abort);await task.destroy();}
  }else if(kind==='docx')text=await docxText(bytes,signal);
  else{const source=decode(bytes);if(/\x00|[\x01-\x08\x0e-\x1f]/.test(source))fail('invalid_text_file');text=kind==='html'?htmlText(source):source;}
 }finally{if(ocr)await ocr.close();}
 stopped(signal);if(ocr)text=text.replace(/^\s*\|(?=\s+(?:am|have|had|was|will|would|can|could|do|did)\b)/gm,'I');text=text.trim();if(!text)fail('file_no_text');if(text.length>MAX_FILE_TEXT)fail('file_text_limit');
 return {name:file.name,kind,text,file,ocrUsed:Boolean(ocr)};
}

export async function exportPayload(action,attachments=[]){
 const body={mode:action.mode,format:action.format};
 if(action.mode==='replace'){
  const file=attachments[action.attachmentIndex]?.file;if(!file||file.size>MAX_SOURCE_BYTES)fail('source_file_limit');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  Object.assign(body,{sourceBase64:btoa(binary),find:action.find,replacement:action.replacement});
 }else body.text=action.text;
 return body;
}

export function fileError(code,locale='uz'){
 const texts={
  unsupported_file:['PNG/JPG/WebP, PDF, DOCX, TXT, MD, HTML, CSV yoki JSON tanlang. ZIP qabul qilinmaydi.','Choose PNG/JPG/WebP, PDF, DOCX, TXT, MD, HTML, CSV or JSON. ZIP is not accepted.'],
  file_size_limit:['Har bir fayl 20 MB dan kichik bo‘lsin.','Each file must be under 20 MB.'],
  file_text_limit:['Fayl matni 60 000 belgidan oshdi. Kerakli qismini alohida yuboring.','File text exceeds 60,000 characters. Send the relevant part separately.'],
  file_no_text:['O‘qiladigan matn topilmadi. Rasmni tiniqroq yuboring yoki matnni yozing.','No readable text found. Use a clearer image or type the text.'],
  pdf_page_limit:['PDF 60 sahifadan oshmasin. Kerakli sahifalarni alohida yuboring.','Send up to 60 PDF pages at a time.'],
  pdf_layout_edit_unsupported:['Bu PDF bo‘lagini joylashuvini saqlab o‘zgartira olmadim. Matndan yangi nusxa yaratish mumkin.','This PDF span could not be edited while preserving layout. You can create a new copy from its text.'],
  source_file_limit:['Asl tuzilmani saqlab tahrirlash 3 MB gacha. Matndan yangi nusxa yaratish mumkin.','Preserving the original structure supports files up to 3 MB. You can create a new text-based copy.'],
  active_exam_lookup_forbidden:['Faol imtihon vaqtida fayl yordamidan foydalanib bo‘lmaydi.','Document assistance is unavailable during an active assessment.']};
 return (texts[code]??['Fayl o‘qilmadi yoki nusxa yaratilmadi. Formatini va matnini tekshiring.','The file could not be read or exported. Check its format and content.'])[locale==='en'?1:0];
}
