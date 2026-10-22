import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createPlayingArtworkFixture} from './helpers/playing-artwork-fixture.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';
test('desktop can preview progressive lyrics while another provider waits; playback and conflict drafts survive', {timeout:45000},async t=>{
  const document={provider:'lrclib',id:'123',title:'渐进歌词',artists:['歌手'],synced:true,lines:[{startMs:1000,text:'第一句'}]};
  let pending,closed=false,selections=0;
  const fixture=await createPlayingArtworkFixture({handleRequest:async({url,request,response,json})=>{
    if(url.pathname==='/api/lyrics/state'){json({revision:'r1',offsetMs:500,document});return true;}
    if(url.pathname==='/api/lyrics/search-progress'){
      response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});response.write(JSON.stringify({candidates:[document],issues:[],complete:false})+'\n');pending=response;response.on('close',()=>closed=true);return true;
    }
    if(url.pathname==='/api/lyrics/document'){json(document);return true;}
    if(url.pathname==='/api/lyrics/select'){selections++;json({error:{code:'conflict',currentRevision:'peer'}},409);return true;}
    return false;
  }});
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});t.after(async()=>{pending?.end();await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  await page.goto(fixture.base);await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);const source=await page.locator('audio').getAttribute('src');
  await page.getByRole('button',{name:'更多播放选项',exact:true}).click();await page.getByRole('button',{name:'歌词管理',exact:true}).click();await page.getByRole('button',{name:'更换或导入歌词',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'版本与歌词',exact:true});await dialog.getByLabel('歌词歌名').fill('渐进歌词');await dialog.getByRole('button',{name:'查找歌词',exact:true}).click();
  await dialog.getByText('正在搜索歌词…',{exact:true}).waitFor();const preview=dialog.getByRole('button',{name:'预览 LRCLIB 渐进歌词 123',exact:true});await preview.waitFor();assert.equal(await preview.isEnabled(),true);assert.equal(closed,false);
  await preview.click();await dialog.getByRole('region',{name:'歌词预览',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.lyrics-feedback [role="status"]'));
  assert.equal(await page.locator('audio').getAttribute('src'),source);assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  await dialog.getByRole('button',{name:'使用这份歌词',exact:true}).click();await dialog.getByText(/这个版本的歌词已被另一页面修改/).waitFor();assert.equal(await dialog.getByLabel('歌词歌名').inputValue(),'渐进歌词');assert.equal(selections,1);assert.deepEqual(errors,[]);
});
