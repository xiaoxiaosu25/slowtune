import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {fromMusicRef,queueRecord} from './helpers/song-fixture.mjs';
import {navigate,openSettingsPage,closeSettingsPage} from '../scripts/browser-ui.mjs';
import {installSearchFixture} from './helpers/search-fixture.mjs';

test('YouTube switch: live shared state, preserved library/queue, three displays and native mixed playback',{timeout:90000},async t=>{
  const build=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),artifacts=resolve('local/verification/youtube-switch');mkdirSync(artifacts,{recursive:true});
  const tracks=[
    {ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:'900'},resourceId:'first',title:'B站第一首',url:'https://www.bilibili.com/video/BV1tX4y1W7Xm',durationSeconds:8},
    {ref:{provider:'youtube',kind:'video',id:'kK0CRZ0wvvc'},resourceId:'youtube',title:'YouTube 已有歌曲',url:'https://www.youtube.com/watch?v=kK0CRZ0wvvc',durationSeconds:8},
    {ref:{provider:'bilibili',kind:'video',id:'BV1xx411c7mD',part:'901'},resourceId:'last',title:'B站第二首',url:'https://www.bilibili.com/video/BV1xx411c7mD',durationSeconds:8},
  ];
  let sources={revision:'initial',sequence:0,youtube:{enabled:false,disabledDisplay:'dim',available:false,checking:false}},revision=1,failSave=false,toolFailure=false;
  const snapshot={playlists:[{id:'p1',name:'混合歌单',createdAt:1,updatedAt:1,entries:tracks.map((track,index)=>({id:'e'+index,ref:fromMusicRef(track.ref),metadata:{title:track.title,durationSeconds:8},availability:{state:'unknown'},addedAt:1}))}],favorites:tracks.map(track=>({ref:fromMusicRef(track.ref),metadata:{title:track.title,durationSeconds:8},availability:{state:'unknown'},addedAt:1}))};
  const initial=structuredClone(snapshot),calls=[],streams=new Set(),errors=[],pendingSearch=new Map();let holdSearch=false;
  const emit=()=>{for(const stream of streams)stream.write('event: sources\ndata: '+JSON.stringify(sources)+'\n\n');};
  const update=patch=>{sources={revision:'s'+(++sources.sequence),sequence:sources.sequence,youtube:{...sources.youtube,...patch}};emit();};
  const audio=Buffer.alloc(44+16000*8*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  let base;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,base),json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const body=async()=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));};
    if(url.pathname==='/api/settings/sources/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});streams.add(res);res.write('event: sources\ndata: '+JSON.stringify(sources)+'\n\n');req.on('close',()=>streams.delete(res));return;}
    if(url.pathname==='/api/settings/sources'){
      if(req.method==='GET')return json(sources);const input=await body();
      if(failSave)return json({error:{code:'storage'}},503);
      if(input.revision!==sources.revision)return json({error:{code:'conflict'}},409);
      update({...input.youtube,available:input.youtube.enabled&&!toolFailure,checking:false,issue:toolFailure?'取源工具不可用':undefined});return json(sources);
    }
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status')return json({version:'fixture',node:process.version,sourceSettings:sources,providers:{bilibili:{available:true},youtube:sources.youtube},delivery:{leases:0,activeReads:0},tool:{active:0}});
    if(url.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(url.pathname==='/api/follows')return json({revision:'f1',creators:[]});
    if(url.pathname==='/api/discovery/bilibili')return json([]);
    if(url.pathname==='/api/recommendation/confirm')return json({accepted:true,count:0});
    if(url.pathname==='/api/youtube/music')return json({region:'HK',shelf:{id:'youtube-music-selection',title:'YouTube 音乐精选',kind:'recommendation',page:{items:[]}},sourceUrl:tracks[1].url,fetchedAt:1,catalogueUpdatedAt:1,playlists:[],warnings:[]});
    if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili',...(sources.youtube.available?['youtube']:[])].map(provider=>({provider,operations:['metadata','search','prepare','formats'],anonymous:true,limitations:[]}))});
    if(url.pathname.startsWith('/v1/call/')){
      const input=await body(),ref=input.ref??input.request?.ref,provider=ref?.provider??input.provider;calls.push({operation:url.pathname,provider});
      if(provider==='youtube'&&!sources.youtube.enabled)return json({protocol:2,error:{code:'unsupported',provider,retryable:false}},502);
      const track=tracks.find(track=>track.ref.id===ref?.id);
      if(url.pathname.endsWith('/search')){
        const reply=failed=>failed?json({protocol:2,error:{code:'cancelled',provider,retryable:false}},502):json({protocol:2,result:{items:tracks.filter(track=>track.ref.provider===provider)}});
        if(holdSearch){pendingSearch.set(provider,reply);return;}return reply(false);
      }
      if(url.pathname.endsWith('/metadata'))return json({protocol:2,result:track});
      if(url.pathname.endsWith('/formats'))return json({protocol:2,result:[{id:'aac',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'m4a',bitrate:256000}]});
      if(url.pathname.endsWith('/prepare'))return json({protocol:2,result:{entry:track,resourceId:track.resourceId,format:{id:'wav',codec:'pcm',mimeType:'audio/wav',container:'wav'},delivery:{url:base+'/media.wav',requiresHost:false}}});
    }
    if(url.pathname==='/media.wav'){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})});return res.end(audio.subarray(start,end+1));}
    try{const path=join(build,'dist/client',url.pathname==='/'?'index.html':url.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(readFileSync(path));}catch{res.writeHead(404);res.end();}
  });
  const {libraryFixture}=installSearchFixture(server,{youtubeAvailable:()=>sources.youtube.available,librarySeed:snapshot});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(record=>{if(!localStorage.getItem('slow-listening:playback:v3'))localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record));},queueRecord(tracks,{current:'first',volume:.4}));
  const page=await context.newPage(),other=await context.newPage();for(const tab of [page,other]){tab.setDefaultTimeout(10000);tab.on('pageerror',error=>errors.push(error.message));await tab.goto(base);await tab.locator('.app').waitFor();}
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const queueIds=(await saved()).items.map(track=>track.instanceId);
  assert.equal(await page.locator('[data-shelf-id="youtube-music-selection"]').count(),0);
  assert.equal(await page.locator('.source-tabs').count(),0);
  assert.equal(calls.filter(call=>call.provider==='youtube').length,0);
  await navigate(page,'歌单');const youtubeRow=page.locator('.main-content .song-library-row').filter({hasText:'YouTube 已有歌曲'});
  assert.equal(await page.locator('.source-tabs').count(),0);
  assert.equal(await youtubeRow.getByRole('button',{name:'播放 YouTube 已有歌曲',exact:true}).isDisabled(),true);assert.match(await youtubeRow.getAttribute('class'),/source-disabled/);
  await openSettingsPage(page,'音乐来源');await openSettingsPage(other,'音乐来源');const toggle=page.getByRole('switch',{name:'启用 YouTube'});
  assert.equal(await toggle.isChecked(),false);await page.getByLabel('关闭时已有歌曲的展示方式').selectOption('show');
  await other.waitForFunction(()=>document.querySelector('select[aria-label="关闭时已有歌曲的展示方式"]').value==='show');
  await closeSettingsPage(page);assert.doesNotMatch(await youtubeRow.getAttribute('class'),/source-disabled/);
  assert.equal(await page.locator('.source-tabs').count(),0);
  await navigate(page,'关注');assert.equal(await page.locator('.source-tabs').count(),0);
  await navigate(page,'发现');assert.equal(await page.locator('.source-tabs').count(),0);
  await page.screenshot({path:join(artifacts,'desktop-single-source.png'),fullPage:true});
  await navigate(page,'歌单');
  await openSettingsPage(page,'音乐来源');await page.getByLabel('关闭时已有歌曲的展示方式').selectOption('hide');await closeSettingsPage(page);
  assert.equal(await youtubeRow.count(),0);assert.equal(await page.locator('.queue-track').filter({hasText:'YouTube 已有歌曲'}).count(),0);
  assert.deepEqual((await saved()).items.map(track=>track.instanceId),queueIds);assert.deepEqual(snapshot,initial);
  await openSettingsPage(page,'音乐来源');await page.screenshot({path:join(artifacts,'desktop-settings.png'),fullPage:true});
  await toggle.check();await other.waitForFunction(()=>document.querySelector('input[aria-label="启用 YouTube"]').checked);
  await closeSettingsPage(page);assert.equal(await youtubeRow.count(),1);assert.equal(await youtubeRow.getByRole('button',{name:'播放 YouTube 已有歌曲',exact:true}).isEnabled(),true);
  assert.deepEqual(await page.locator('.source-tabs button').allTextContents(),['全部','B站','YouTube 视频']);
  for(const failed of [true,false]){
    await page.locator('.source-tabs').getByRole('button',{name:failed?'YouTube 视频':'B站',exact:true}).click();
    holdSearch=true;pendingSearch.clear();
    await page.getByLabel('搜索歌曲或视频',{exact:true}).fill('等待来源搜索');await page.getByRole('button',{name:'开始搜索',exact:true}).click();
    assert.deepEqual(await page.locator('.search-source-tabs button').allTextContents(),['全部','B站','YouTube 视频']);
    for(let attempt=0;pendingSearch.size<2&&attempt<100;attempt++)await new Promise(done=>setTimeout(done,20));assert.equal(pendingSearch.size,2);
    await other.getByRole('switch',{name:'启用 YouTube'}).uncheck();
    await page.waitForFunction(()=>!document.querySelector('.search-source-tabs')&&!document.querySelector('.source-tabs'));
    pendingSearch.get('youtube')(failed);pendingSearch.get('bilibili')(false);holdSearch=false;
    const dialog=page.getByRole('dialog',{name:'搜索音乐',exact:true});
    await dialog.getByRole('button',{name:'播放 B站第一首',exact:true}).waitFor();
    assert.equal(await dialog.locator('.section-heading h2').filter({hasText:'YouTube 视频'}).count(),0);assert.deepEqual(errors,[]);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    assert.equal(await youtubeRow.count(),0);
    await other.getByRole('switch',{name:'启用 YouTube'}).check();await page.waitForFunction(()=>!document.querySelector('.main-content .track-row.source-disabled'));
    assert.equal(await page.locator('.source-tabs button[aria-pressed="true"]').textContent(),'全部');
    assert.equal(await youtubeRow.getByRole('button',{name:'播放 YouTube 已有歌曲',exact:true}).isEnabled(),true);
  }
  await page.locator('.playlist-intro .play-all').click();await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.getByRole('button',{name:'播放队列歌曲 YouTube 已有歌曲',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio[data-product-media]')?.paused===false);
  assert(calls.some(call=>call.provider==='youtube'&&call.operation.endsWith('/formats')),'enable refreshes cached handshake capabilities');
  await openSettingsPage(other,'音乐来源');await other.getByRole('switch',{name:'启用 YouTube'}).uncheck();
  await page.waitForFunction(()=>document.querySelector('.playbar-now strong')?.textContent==='B站第二首').catch(async()=>assert.fail(JSON.stringify({sources,calls,view:await page.locator('.playbar').innerText(),feedback:await page.locator('.feedback').allTextContents(),queue:await saved()})));
  await page.waitForFunction(()=>document.querySelector('audio[data-product-media]')?.paused===false);
  const afterDisable=calls.filter(call=>call.provider==='youtube').length;
  await page.locator('.playbar').getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();
  await openSettingsPage(page,'音乐来源');await page.getByLabel('关闭时已有歌曲的展示方式').selectOption('dim');await closeSettingsPage(page);
  await page.locator('.playlist-intro .play-all').click();await page.waitForFunction(()=>document.querySelector('audio[data-product-media]')?.paused===false);
  await page.locator('.playbar').getByRole('button',{name:'下一首',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.playbar-now strong')?.textContent==='B站第二首').catch(async()=>assert.fail(JSON.stringify({calls,view:await page.locator('.playbar').innerText(),feedback:await page.locator('.feedback').allTextContents(),queue:await saved()})));
  await page.locator('.playbar').getByRole('button',{name:'上一首',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.playbar-now strong')?.textContent==='B站第一首');
  await page.evaluate(()=>{document.querySelector('audio[data-product-media]').currentTime=7.8;});await page.waitForFunction(()=>document.querySelector('.playbar-now strong')?.textContent==='B站第二首');
  assert.equal(calls.filter(call=>call.provider==='youtube').length,afterDisable,'disabled mixed playback never reads YouTube');
  await openSettingsPage(page,'音乐来源');failSave=true;await toggle.click();await page.getByText('资料保存失败',{exact:false}).waitFor();assert.equal(await toggle.isChecked(),false);failSave=false;
  toolFailure=true;await toggle.check();await page.getByText('YouTube 已开启，但当前不可用',{exact:false}).waitFor();assert.equal(await toggle.isChecked(),true);await toggle.uncheck();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'mobile-settings.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await closeSettingsPage(page);await navigate(page,'发现');assert.equal(await page.locator('.source-tabs').count(),0);await page.screenshot({path:join(artifacts,'mobile-single-source.png'),fullPage:true});
  assert.deepEqual(snapshot,initial);assert.deepEqual(errors,[]);
});
