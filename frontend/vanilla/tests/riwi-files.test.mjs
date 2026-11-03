import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {readFile,docxText,htmlText} from '../js/riwi-files.js';
import {mount,createRiwiWorkspaceController} from '../modules/riwi/index.js';
const bytes=s=>new TextEncoder().encode(s);
const file=(name,data)=>({name,size:data.length,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});
function archive(entries){
 let offset=0;const local=[],central=[];
 for(const [name,text]of Object.entries(entries)){
  const n=Buffer.from(name),raw=Buffer.from(text),data=deflateRawSync(raw),l=Buffer.alloc(30+n.length);
  l.writeUInt32LE(0x04034b50);l.writeUInt16LE(8,8);l.writeUInt32LE(data.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(n.length,26);n.copy(l,30);local.push(l,data);
  const c=Buffer.alloc(46+n.length);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);n.copy(c,46);central.push(c);offset+=l.length+data.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...local,...central,end]));
}

test('text formats retain Uzbek and reject ZIP or binary disguised as text',async()=>{
 const text='O‘zbekcha dars.\nI agree.';assert.equal((await readFile(file('lesson.txt',bytes(text)))).text,text);
 await assert.rejects(()=>readFile(file('lesson.zip',bytes('PK file'))),/unsupported_file/);
 await assert.rejects(()=>readFile(file('lesson.txt',new Uint8Array([0,255,1]))));
});

test('HTML extraction remains inert and removes scripts, images and embedded frames',()=>{
 const h=setup({path:'/app/riwi'});try{
  const result=htmlText('<h1>Lesson</h1><script>window.fileExecuted=true</script><img src="https://invalid.example/pixel"><iframe src="https://invalid.example"></iframe><p>Useful words.</p>');
  assert(result.includes('Lesson')&&result.includes('Useful words.'));assert(!result.includes('fileExecuted'));assert.equal(window.fileExecuted,undefined);assert.equal(document.querySelector('iframe,img'),null);
 }finally{h.dispose()}
});

test('compressed DOCX reads runs/tables and rejects an expanded-size bomb before inflating',async()=>{
 const h=setup({path:'/app/riwi'}),old=globalThis.DOMParser;globalThis.DOMParser=window.DOMParser;
 try{
  const data=archive({'[Content_Types].xml':'<Types/>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>I am </w:t></w:r><w:r><w:t>agree.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'});
  assert.equal(await docxText(data),'I am agree.\nTable cell');
  const bomb=data.slice(),v=new DataView(bomb.buffer);let at=0;while(v.getUint32(at,true)!==0x02014b50)at++;v.setUint32(at+24,100000000,true);
  await assert.rejects(()=>docxText(bomb),/invalid_docx/);
 }finally{globalThis.DOMParser=old;h.dispose()}
});

test('image pipeline uses local OCR and closes its worker after reading',async()=>{
 const h=setup({path:'/app/riwi'}),old=globalThis.createImageBitmap;let closed=0,bitmapClosed=0;
 globalThis.createImageBitmap=async()=>({width:100,height:100,close(){bitmapClosed++}});
 const get=h.dom.window.HTMLCanvasElement.prototype.getContext;h.dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
 try{
  const jpeg=new Uint8Array([255,216,255,217]);
  const result=await readFile(file('lesson.jpg',jpeg),{ocrFactory:async()=>({read:async()=>'| have finished.\nO‘zbekcha matn',close:async()=>{closed++}})});
  assert.equal(result.text,'I have finished.\nO‘zbekcha matn');assert.equal(closed,1);assert.equal(bitmapClosed,1);
 }finally{globalThis.createImageBitmap=old;h.dom.window.HTMLCanvasElement.prototype.getContext=get;h.dispose()}
});

test('controller sends extracted text without binary and forgets files on context reset',async()=>{
 const sent=[],exports=[];const c=createRiwiWorkspaceController({role:'owner',adapter:{
  sendChat:async payload=>{sent.push(payload);return {conversationId:ID(1),answer:'Prepared',documentAction:{mode:'create',format:'txt',text:'Edited text'}}},
  exportDocument:async payload=>{exports.push(payload);return {document:{name:'RIWI-document.txt',mime:'text/plain',base64:btoa(payload.text)}}}
 }});
 c.state.attachments=[{name:'lesson.txt',kind:'txt',text:'Private lesson text',file:{notSerialized:true}}];
 await c.sendMessage('TXT qilib ber');assert.deepEqual(sent[0].attachments,[{name:'lesson.txt',kind:'txt',text:'Private lesson text'}]);
 assert.equal(exports[0].text,'Edited text');assert(c.state.messages.at(-1).document);
 await c.sendMessage('/clear');assert.equal(c.state.attachments.length,0);assert.equal(c.state.conversationId,null);assert.equal(sent.length,1);
});

test('drop accepts text into chat, preserves it on sending and clears it with new chat',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  h.stub({'/api/riwi/chat':{ok:true,conversationId:ID(2),answer:'Read the file',citations:[]}});await mount(h.ctx);
  const drop=new window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[file('lesson.txt',bytes('A useful lesson'))],types:['Files']}});
  h.q('.riwi-workspace').dispatchEvent(drop);await tick(8);assert(drop.defaultPrevented);assert(h.q('.riwi-file-chip').textContent.includes('lesson.txt'));
  h.input(h.q('.riwi-chat-input'),'Fayl mazmunini ko‘rsat');h.submit(h.q('form'));await tick(7);
  assert.equal(h.calls.find(x=>x.path==='/api/riwi/chat').body.attachments[0].text,'A useful lesson');
  h.click(h.q('.riwi-clear'));await tick(2);assert.equal(h.q('.riwi-file-chip'),null);assert(h.q('.riwi-file-editor-panel').hidden);
 }finally{h.dispose()}
});

test('ZIP drop reports an unsupported format without a chat request',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});try{
  await mount(h.ctx);const drop=new window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[file('archive.zip',bytes('PK invalid'))],types:['Files']}});h.q('.riwi-workspace').dispatchEvent(drop);await tick(6);
  assert(h.q('.riwi-file-status').textContent.includes('ZIP'));assert.equal(h.q('.riwi-file-chip'),null);assert.equal(h.calls.length,0);
 }finally{h.dispose()}
});
