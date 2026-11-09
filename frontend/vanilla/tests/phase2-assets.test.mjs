import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {JSDOM} from 'jsdom';import {dockIcon} from '../modules/shell/dock-icons.js';
test('every photograph-backed Dock icon resolves to a bounded WebP derivative with the original viewport',()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 try{let bytes=0;for(const key of ['dashboard','live-classes','assignments','mocks','video-lessons','listening','reading','writing','speaking','grammar','vocabulary','progress','management']){
  const svg=dockIcon(key),image=svg.querySelector('image'),href=image.getAttribute('href');
  assert.equal(svg.getAttribute('viewBox'),'434 109 541 555');assert(href.endsWith('.webp'));
  const data=fs.readFileSync(new URL('../'+href.slice(1),import.meta.url));assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');bytes+=data.byteLength;
  assert(fs.existsSync(new URL('../'+href.slice(1).replace('.webp','.jpg'),import.meta.url)));
 }assert(bytes<512*1024,`Dock derivatives exceeded the 512 KiB aggregate budget: ${bytes}`);
 }finally{dom.window.close();}
});
