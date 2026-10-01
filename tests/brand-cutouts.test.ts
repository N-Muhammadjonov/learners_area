import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {BRAND_MARK} from '../src/lib/config/brand';
test('Runtime theme cutouts are compact real transparent PNGs with reserved intrinsic size',async()=>{
 for(const theme of ['day','night'] as const){
  assert.equal(BRAND_MARK[theme].width,48); assert.equal(BRAND_MARK[theme].height,48);
  for(const [file,size] of [[BRAND_MARK[theme].src,96],[BRAND_MARK[theme].src2x,192]] as const){
   const {data,info}=await sharp(`public${file}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   assert.equal(info.width,size);assert.equal(info.height,size);
   assert.equal(data[3],0,'corner is transparent, not a white/navy background');
   let visible=0,transparent=0;for(let i=3;i<data.length;i+=4){if(data[i]>128)visible++;if(data[i]===0)transparent++;}
   assert.ok(visible>size*size*.15);assert.ok(transparent>size*size*.15);
  }
 }
 assert.notEqual(BRAND_MARK.day.src,BRAND_MARK.night.src);
});
