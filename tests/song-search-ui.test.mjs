import {test} from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from './helpers/browser.mjs';
import {createSettingsFixture} from './helpers/settings-fixture.mjs';
import {navigate,selectPlaylist} from '../scripts/browser-ui.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {verifySearchPlayback}=await import(pathToFileURL(resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server/search-playback.js')));

test('desktop song search includes artists while manual text and mobile requests keep their existing behavior',{timeout:60000},async t=>{
  const song={title:'恋人',artists:['李荣浩']};
  const entry={ref:{provider:'bilibili',kind:'video',id:'BV1d1bnzVErx',part:'900'},resourceId:'lover',title:'李荣浩《恋人》',url:'https://www.bilibili.com/video/BV1d1bnzVErx',durationSeconds:8};
  const fixture=await createSettingsFixture(undefined,{strictMatch:true});
  Object.assign(fixture.state,{searchItems:[entry],chartItems:[{rank:1,...song}]});
  const library=fixture.libraryFixture.library;
  const saved=library.execute(library.read().revision,[{type:'create-song',id:'lover',...song},{type:'favorite',songId:'lover'}],new AbortController().signal);
  fixture.state.snapshot=saved.snapshot;
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),requests=[],errors=[];
    page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(['/api/search/resolve','/api/song-library/playback'].some(path=>request.url().endsWith(path)))requests.push(request.postDataJSON());});
    await page.goto(fixture.base);await page.locator('.app').waitFor();await navigate(page,'音乐榜单');
    const before=fixture.state.searchQueries.length;
    await page.locator('.chart-song-search').first().click();
    const search=page.getByRole(width===1440?'dialog':'main',{name:'搜索音乐',exact:true});await search.locator('.search-filter-notice').waitFor();
    assert.equal(fixture.state.searchQueries[before].request.query,width===1440?'恋人 李荣浩':'恋人');
    assert.equal(await search.getByLabel(width===1440?'弹窗搜索关键词':'搜索关键词').inputValue(),width===1440?'恋人 李荣浩':'');
    await search.getByLabel(width===1440?'弹窗搜索关键词':'搜索关键词').fill('恋人 现场');
    const manual=page.waitForResponse(response=>response.url().endsWith('/api/search'));
    await search.getByRole('button',{name:'搜索',exact:true}).click();await manual;
    assert.equal(fixture.state.searchQueries.at(-1).request.query,'恋人 现场');
    await search.getByRole('button',{name:width===1440?'关闭':'关闭搜索',exact:true}).click();
    const resolved=page.waitForResponse(response=>response.url().endsWith('/api/song-library/playback'));
    await page.getByRole('button',{name:'直接播放 恋人',exact:true}).click();assert.equal((await resolved).status(),200);
    assert.equal(requests.at(-1).searchMode,width===1440?'title-artists':undefined);
    assert.equal(requests.at(-1).selection.kind,'chart');assert.equal(requests.at(-1).selection.context.title,song.title);assert.deepEqual(requests.at(-1).selection.context.artists,song.artists);
    await page.waitForFunction(()=>document.querySelector('.now-playing strong')?.textContent==='恋人'&&!document.querySelector('audio').paused);
    await navigate(page,'歌单');
    if(width===390)await selectPlaylist(page,'我的收藏');
    const playback=page.waitForResponse(response=>response.url().endsWith('/api/song-library/playback'));
    await page.locator('.song-library-row .track-name').click();assert.equal((await playback).status(),200);
    const {audioSupport,...songRequest}=requests.at(-1);
    assert.deepEqual(songRequest,{selection:{kind:'song',songId:'lover'},...(width===1440?{searchMode:'title-artists'}:{})});
    if(width===1440)assert(audioSupport.some(type=>type.includes('mp4a')));else assert.equal(audioSupport,undefined);
    if(width===1440){
      await page.getByRole('button',{name:'更多操作 恋人',exact:true}).click();
      await page.locator('.song-row-menu [popover]:popover-open').getByRole('button',{name:'编辑歌曲 恋人',exact:true}).click();
      await page.getByRole('button',{name:'搜索并添加版本',exact:true}).click();const adding=page.getByRole('dialog',{name:'添加播放版本',exact:true});await adding.locator('.search-filter-notice').waitFor();
      assert.equal(await adding.getByLabel('弹窗搜索关键词').inputValue(),'恋人 李荣浩');
      assert.equal(fixture.state.searchQueries.at(-1).request.query,'恋人 李荣浩');
    }
    assert.deepEqual(errors,[]);await context.close();
  }
});

test('desktop chart single and full playback reuse the readable rendition instead of rejecting a searchable song',{timeout:60000},async t=>{
  const song={title:'雨爱',artists:['杨丞琳']},entry={ref:{provider:'bilibili',kind:'video',id:'BV118411B7XU',part:'900'},resourceId:'rain',title:'杨丞琳《雨爱》',url:'https://www.bilibili.com/video/BV118411B7XU',durationSeconds:8};
  const aac={id:'30280',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4'},flac={id:'30251',codec:'fLaC',mimeType:'audio/mp4',container:'mp4'},reads=[];
  const fixture=await createSettingsFixture(undefined,{strictMatch:true,verifyPlayback:(candidate,signal,support)=>verifySearchPlayback({
    capabilities:()=>({operations:['formats','prepare']}),formats:async()=>[aac,flac],prepare:async request=>({entry:candidate,resourceId:candidate.resourceId,format:[aac,flac].find(format=>format.id===request.formatId),delivery:{url:'https://test.bilivideo.com/'+request.formatId,requiresHost:true}})
  },{now:Date.now,fetch:async url=>{
    const id=new URL(url).pathname.slice(1);reads.push(id);return fixture.state.rejectedAudioFormats.includes(id)?new Response(null,{status:403}):new Response(mp4Prefix(),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}});
  }},candidate.ref,{signal},support)});
  Object.assign(fixture.state,{searchItems:[entry],chartItems:[{rank:1,...song}],audioFormats:[aac,flac],rejectedAudioFormats:[aac.id]});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
  await page.goto(fixture.base);await page.locator('.app').waitFor();await navigate(page,'音乐榜单');
  // The ordinary search can actually play this exact candidate despite AAC rejection.
  await page.locator('.chart-song-search').first().click();const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});
  await search.getByText(entry.title,{exact:true}).waitFor();await search.getByRole('button',{name:'播放 '+entry.title,exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.2&&!document.querySelector('audio').paused);
  assert.equal(fixture.state.prepareRequests.at(-1).formatId,flac.id);
  if(await search.isVisible())await search.getByRole('button',{name:'关闭',exact:true}).click();
  for(const rejected of [flac.id,aac.id]){
    fixture.state.rejectedAudioFormats=[rejected];const expected=rejected===flac.id?aac:flac;
    for(const full of [false,true]){
      reads.length=0;const resolved=page.waitForResponse(response=>response.url().endsWith('/api/song-library/playback'));
      if(full)await page.locator('.chart-play-all').click();else await page.getByRole('button',{name:'直接播放 雨爱',exact:true}).click();
      const response=await resolved;assert.equal(response.status(),200);const result=await response.json();
      assert.equal(result.entry.verifiedAudio.format.id,expected.id);
      await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.2&&!document.querySelector('audio').paused);
      assert.equal(fixture.state.prepareRequests.at(-1).formatId,expected.id);
      assert.deepEqual(fixture.state.prepareRequests.at(-1).codecs,[expected.codec]);
      assert.deepEqual(reads,rejected===flac.id?[flac.id,aac.id]:[flac.id]);assert.equal(await page.locator('.chart-playback-failures').count(),0);
    }
  }
  const queue=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  assert(!JSON.stringify(queue).includes('verifiedAudio'),'a checked rendition must not become a permanent queue preference');
});
test('desktop chart single and full playback pass a rejected CDN candidate and play the next matching version',{timeout:60000},async t=>{
  const song={title:'雨爱',artists:['杨丞琳']},blocked={ref:{provider:'bilibili',kind:'video',id:'BV118411B7XU',part:'900'},resourceId:'blocked-rain',title:'杨丞琳《雨爱》分享',url:'https://www.bilibili.com/video/BV118411B7XU',durationSeconds:8};
  const good={...blocked,ref:{...blocked.ref,id:'BV1uG41137nH'},resourceId:'good-rain',title:'杨丞琳《雨爱》MV'},reads=[];
  const fixture=await createSettingsFixture(undefined,{strictMatch:true,verifyPlayback:(entry,signal)=>verifySearchPlayback({prepare:async()=>({resourceId:entry.resourceId,entry,format:{id:'aac',codec:'mp4a',mimeType:'audio/mp4',container:'mp4'},delivery:{url:'https://test.bilivideo.com/'+entry.ref.id,requiresHost:true}})},{now:Date.now,fetch:async url=>{
    const id=new URL(url).pathname.slice(1);reads.push(id);return id===blocked.ref.id?new Response(null,{status:403}):new Response(mp4Prefix(),{status:206,headers:{'Content-Range':'bytes 0-1023/2048','Content-Length':'1024'}});
  }},entry.ref,{signal})});
  Object.assign(fixture.state,{searchItems:[blocked,good],chartItems:[{rank:20,...song}]});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
  await page.goto(fixture.base);await page.locator('.app').waitFor();await navigate(page,'音乐榜单');
  await page.getByRole('button',{name:'直接播放 雨爱',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.2);
  assert.deepEqual(reads,[blocked.ref.id,good.ref.id]);assert.equal(fixture.state.preparations.at(-1).id,good.ref.id);
  await page.locator('.chart-play-all').click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.2);
  assert.equal(fixture.state.preparations.at(-1).id,good.ref.id);
  assert.equal(await page.locator('.chart-playback-failures').count(),0);
  const queue=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  assert.equal(queue.items.length,1);assert.equal(queue.items[0].selection.kind,'chart');
});
import {mp4Prefix} from './fixtures/audio-prefix.mjs';
