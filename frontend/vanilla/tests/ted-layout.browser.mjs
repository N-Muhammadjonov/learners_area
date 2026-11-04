import test from 'node:test';
import assert from 'node:assert/strict';
import {withDockBrowser,frames,tedFixture,tedPath} from './helpers/dock-browser.mjs';

test('TED title is the video name and the desktop player fits vertically with its aspect ratio preserved',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const [width,height]of [[1366,768],[1440,900],[1920,1080],[390,844],[768,1024]]){
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
   try{
    await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated player fixture</title>'}));
    await page.goto(origin+tedPath);await page.locator('[data-module-section-heading="video-lessons:detail"]').waitFor();await page.locator('[data-video-frame]').waitFor();await frames(page);
    assert.deepEqual(await page.locator('h1:visible').allTextContents(),['How to Make Stress Your Friend']);
    assert.equal(await page.locator('[data-video-detail-meta]').textContent(),'14 min');assert(await page.locator('[data-module-dock]').isHidden());
    const box=await page.locator('[data-video-frame]').boundingBox();assert(Math.abs(box.width/box.height-16/9)<.01);
    if(width>=1100){assert(box.y+box.height<=height-16,`${width}x${height}: player bottom ${box.y+box.height}`);assert(box.height<=height*.69);}
    else{const stage=await page.locator('[data-video-stage]').boundingBox();assert(Math.abs(stage.width-box.width)<=4,'phone/tablet video retains full available width');}
    await page.evaluate(()=>window.originalPlayer=document.querySelector('[data-video-frame]'));
    await page.locator('[data-video-tab="ownNotes"]').click();await page.locator('[data-video-own-notes-input]').fill('Preserve this note');
    await page.locator('[data-video-tab="description"]').click();await page.locator('[data-video-tab="ownNotes"]').click();
    assert.equal(await page.locator('[data-video-own-notes-input]').inputValue(),'Preserve this note');assert(await page.evaluate(()=>originalPlayer===document.querySelector('[data-video-frame]')));
   }finally{await context.close();}
  }
 },{[tedPath]:tedFixture});
});
