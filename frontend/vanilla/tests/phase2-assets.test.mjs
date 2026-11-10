import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {dockIcon} from '../modules/shell/dock-icons.js';

test('Dock photographs share one bounded WebP atlas with the expected tile layout',()=>{
 const dom=new JSDOM('<main></main>');
 globalThis.document=dom.window.document;
 try{
  const keys=['dashboard','live-classes','assignments','mocks','video-lessons','listening','reading','writing','speaking','grammar','vocabulary','progress','management'];
  const icons=keys.map(dockIcon);
  const atlas=icons[0].querySelector('image').getAttribute('href');
  const prefix='data:image/webp;base64,';
  assert(atlas.startsWith(prefix));
  const data=Buffer.from(atlas.slice(prefix.length),'base64');
  assert.equal(data.toString('ascii',0,4),'RIFF');
  assert.equal(data.toString('ascii',8,12),'WEBP');
  assert(data.byteLength<100*1024,`Dock atlas exceeded the 100 KiB budget: ${data.byteLength}`);
  for(const [index,icon] of icons.entries()){
   const image=icon.querySelector('image');
   assert.equal(icon.getAttribute('data-dock-artwork'),keys[index]);
   assert.equal(icon.getAttribute('viewBox'),'0 0 192 197');
   assert.equal(image.getAttribute('href'),atlas);
   assert.equal(Number(image.getAttribute('x')),0-(index%4)*192);
   assert.equal(Number(image.getAttribute('y')),0-Math.floor(index/4)*197);
  }
 }finally{dom.window.close();}
});
