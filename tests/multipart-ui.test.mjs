import {test} from 'node:test';
import {installSearchFixture} from './helpers/search-fixture.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {resourceId} from '@studio/music-sources';

test('multipart UI: shared actions, uninterrupted expansion, saved scopes and cover interactions',async t=>{
  const build=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),artifacts=resolve('local/verification/multipart-2026-10-14');mkdirSync(artifacts,{recursive:true});
  const makeParts=(id,title,count)=>Array.from({length:count},(_,index)=>{
    const ref={provider:'bilibili',kind:'video',id,part:String(9000+index+1)};
    return {ref,resourceId:resourceId(ref),title:count>1?title+' / 第'+(index+1)+'首':title,url:'https://www.bilibili.com/video/'+id,artwork:'https://images.example.test/coast.png',durationSeconds:40,uploader:{id:'101',name:'测试 UP'}};
  });
  const group=makeParts('BV0000000001','三首合集',3),raw=makeParts('BV0000000002','无默认 cid 合集',2),solo=makeParts('BV0000000003','独立歌曲',1),long=makeParts('BV0000000004','长分 P 歌单',24),huge=makeParts('BV0000000005','超长分 P 歌单',501);
  const cold=makeParts('BV0000000006','读取失败合集',2);
  const lookup=new Map([[group[0].ref.id,group],[raw[0].ref.id,raw],[solo[0].ref.id,solo],[long[0].ref.id,long],[huge[0].ref.id,huge],[cold[0].ref.id,cold]]);
  const parent=(parts,withCid=true)=>{const value={...parts[0],ref:{...parts[0].ref},title:parts[0].title.split(' / ')[0]};if(!withCid)delete value.ref.part;return value;};
  const discovery=[parent(group),parent(raw,false),parent(solo),parent(long)];
  const preparations=[],metadataReads=[],errors=[],writes=[];let failWrite=false,conflict=false,delayedId='',metadataFailure='';
  const metadata=async ref=>{
    metadataReads.push({id:ref.id,part:ref.part});if(ref.id===delayedId)await new Promise(resolve=>setTimeout(resolve,350));
    if(ref.id===metadataFailure)throw {code:'network'};
    const parts=lookup.get(ref.id),entry=parts?.find(part=>!ref.part||part.ref.part===ref.part);if(!entry)throw {code:'not-found'};
    return {...entry,parts};
  };
  const sampleRate=8000,wave=Buffer.alloc(44+sampleRate*40*2);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(sampleRate,24);wave.writeUInt32LE(sampleRate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),json=(value,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}},body=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
    try{
      if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
      if (url.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:false}},build:{stale:false},delivery:{leases:0},tool:{active:0}});
      if(url.pathname==='/api/bilibili/account')return json({state:'anonymous'});
      if(url.pathname==='/api/follows')return json({revision:'f1',creators:[]});
      if(url.pathname==='/api/discovery/bilibili')return json([{id:'music-recommendation',title:'音乐推荐',kind:'recommendation',page:{items:discovery}}]);
      if(url.pathname==='/api/identify'){
        const input=(await body()).input,id=input.match(/BV[a-zA-Z0-9]{10}/)?.[0],parts=lookup.get(id);let ordinal=1;try{ordinal=Number(new URL(input).searchParams.get('p')??1);}catch{}
        if(!parts?.[ordinal-1])throw {code:'invalid-input'};return json({entry:{...parts[ordinal-1],parts},parts});
      }
      if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','search','prepare'],anonymous:true,limitations:[]}]});
      if(url.pathname.startsWith('/v1/call/')){
        const input=await body(),op=url.pathname.split('/').at(-1),result=value=>json({protocol:2,result:value});
        if(op==='search')return result({items:input.request.query==='读取失败'?[parent(cold,false)]:discovery});
        const ref=input.ref??input.request?.ref;
        if(op==='metadata')return result(await metadata(ref));
        if(op==='prepare'){const entry=await metadata(ref);preparations.push({...entry.ref});return result({resourceId:entry.resourceId,entry,format:{id:'fixture',mimeType:'audio/wav',codec:'pcm',container:'wav'},delivery:{url:'http://127.0.0.1:'+server.address().port+'/fixture.wav?part='+ref.part,requiresHost:false}});}
        throw {code:'unsupported'};
      }
      if(url.pathname==='/fixture.wav'){
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),wave.length-1):wave.length-1;
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${wave.length}`}:{})});return res.end(wave.subarray(start,end+1));
      }
      if(url.pathname.startsWith('/api/'))return json({ok:true});
      const file=join(build,'dist/client',url.pathname==='/'?'index.html':url.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
    }catch(issue){if(url.pathname.startsWith('/v1/'))return json({protocol:2,error:{code:issue.code??'upstream',retryable:true}},400);if(url.pathname.startsWith('/api/'))return json({error:{code:issue.code??'upstream'}},400);res.writeHead(404);res.end();}
  });
  const {libraryFixture}=installSearchFixture(server,{librarySeed:{playlists:[{id:'A',name:'歌单 A',entries:[group[2],solo[0]]},{id:'B',name:'歌单 B',entries:[]}]},beforeLibraryWrite:(_path,input)=>{
    writes.push(input); if(failWrite)return {code:'storage',status:503};
    if(conflict){conflict=false;library.execute(library.read().revision,[{type:'rename-playlist',playlistId:'B',name:'歌单 B · 更新'}]);return {code:'conflict'};}
  }});
  const library=libraryFixture.library;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const artwork=readFileSync(join(build,'dist/client/assets/coast.png'));
  await page.route('https://images.example.test/coast.png',route=>route.fulfill({contentType:'image/png',body:artwork}));
  const base='http://127.0.0.1:'+server.address().port,dialog=page.getByRole('dialog',{name:'歌曲与分 P',exact:true});
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3'))),close=async()=>{if(await dialog.count())await dialog.getByRole('button',{name:'关闭',exact:true}).click();};
  const playing=()=>page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>0&&!document.querySelector('.play-toggle[aria-busy="true"]');});
  const openLink=async input=>{await close();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByLabel('视频或歌单链接').fill(input);await page.getByRole('button',{name:'读取真实元信息',exact:true}).click();await dialog.waitFor();};
  await page.goto(base);await page.locator('.music-card').nth(3).waitFor();

  await t.test('default cid still prompts; expanding while playing retains progress, ID and other songs',async()=>{
    await page.getByRole('button',{name:'播放 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'播放整组 3 首',exact:true}).waitFor();await playing();
    const before=await saved();assert.equal(before.items.length,1);const prepared=preparations.length;
    await page.evaluate(()=>{document.querySelector('audio').currentTime=7;});
    await dialog.getByRole('button',{name:'播放整组 3 首',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).items.length===3);
    const after=await saved();assert.equal(after.current,before.current);assert.deepEqual(after.items.slice(0,3).map(track=>track.selection.ref.part),group.map(track=>track.ref.part));assert.equal(preparations.length,prepared);assert(await page.locator('audio').evaluate(audio=>audio.currentTime>=7&&!audio.paused));assert.equal(after.order,'sequential');assert.equal(after.repeat,'off');assert(after.items.slice(0,3).every(track=>track.partsGroupId===after.items[0].partsGroupId));
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:parts-preferences:v1')).BV0000000001),'all');
  });
  await t.test('native end advances to the next P and prepares only that song',async()=>{
    const prepared=preparations.length;await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=audio.duration-.05;});await page.waitForFunction(()=>{const queue=JSON.parse(localStorage.getItem('slow-listening:playback:v3'));return queue.items.find(track=>track.instanceId===queue.current)?.selection.ref.part==='9002'&&!document.querySelector('audio').paused&&document.querySelector('audio').currentTime<2;});assert.equal(preparations.length,prepared+1);assert.equal(preparations.at(-1).part,'9002');
  });
  await t.test('per-video preferences survive reload; restoration stays silent and repeat expansion is idempotent',async()=>{
    const prepared=preparations.length;await page.reload();await page.locator('.app').waitFor();assert.equal(preparations.length,prepared);assert(await page.locator('audio').evaluate(audio=>audio.paused&&!audio.getAttribute('src')));assert((await saved()).items[0].partsGroupId);
    await page.getByRole('button',{name:'播放 三首合集',exact:true}).click();await playing();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).items.length===3);assert.equal(await dialog.count(),0);
    await page.getByRole('button',{name:'更多操作 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'本 P',exact:true}).click();await close();
    await page.getByRole('button',{name:'播放 三首合集',exact:true}).click();await page.waitForFunction(()=>{const queue=JSON.parse(localStorage.getItem('slow-listening:playback:v3'));return queue.items.length===3&&queue.items.find(track=>track.instanceId===queue.current)?.selection.ref.part==='9001'&&document.querySelector('audio').currentTime<2;});await playing();assert.equal((await saved()).items.length,3);assert.equal(await dialog.count(),0);
  });
  await t.test('raw video has the same prompt; closing it does not remember a choice',async()=>{
    await page.getByRole('button',{name:'播放 无默认 cid 合集',exact:true}).click();await dialog.getByRole('button',{name:'保持本 P',exact:true}).waitFor();await close();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:parts-preferences:v1')).BV0000000002),undefined);
    await page.getByRole('button',{name:'播放 无默认 cid 合集',exact:true}).click();await dialog.getByRole('button',{name:'保持本 P',exact:true}).click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:parts-preferences:v1')).BV0000000002),'single');
  });
  await t.test('link P3 selection and source-order expansion retain the current song',async()=>{
    await openLink('https://www.bilibili.com/video/BV0000000001?p=3');const selected=await dialog.locator('input[type=checkbox]').evaluateAll(inputs=>inputs.map(input=>input.checked));assert.deepEqual(selected,[false,false,true]);
    const before=await saved();await dialog.getByRole('button',{name:'播放 三首合集 / 第3首',exact:true}).click();await page.waitForFunction(()=>{const queue=JSON.parse(localStorage.getItem('slow-listening:playback:v3'));return queue.items.find(track=>track.instanceId===queue.current)?.selection.ref.part==='9003';});await playing();assert.equal((await saved()).items.length,before.items.length);await close();
    await page.getByRole('button',{name:'更多操作 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'整组顺序播放',exact:true}).click();await close();
    await openLink('https://www.bilibili.com/video/BV0000000001?p=3');await dialog.getByRole('button',{name:'播放 三首合集 / 第3首',exact:true}).click();await playing();const queue=await saved(),current=queue.items.find(track=>track.instanceId===queue.current);assert.equal(current.selection.ref.part,'9003');assert.deepEqual(queue.items.filter(track=>track.partsGroupId===current.partsGroupId).map(track=>track.selection.ref.part),['9001','9002','9003']);await close();
  });
  await t.test('single favorite is one click; multipart favorite offers current, all and custom without playback',async()=>{
    await close();
    const before=preparations.length;await page.getByRole('button',{name:'收藏 独立歌曲',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cover-favorite[aria-pressed=true]'));assert.equal(library.read().snapshot.favorites.length,1);assert.equal(preparations.length,before);
    await page.getByRole('button',{name:'收藏 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'收藏全部 3 首',exact:true}).click();await dialog.getByRole('button',{name:'立即播放',exact:true}).waitFor();assert.equal(library.read().snapshot.favorites.length,4);assert.equal(preparations.length,before);await close();
  });
  await t.test('playlist B and custom selection survive a failed write, back navigation and conflict retry',async()=>{
    await close();
    await page.getByRole('button',{name:'更多操作 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'加入歌单',exact:true}).click();await dialog.getByLabel('分 P 目标歌单').selectOption('B');await dialog.getByRole('button',{name:'选择部分分 P',exact:true}).click();await dialog.getByRole('button',{name:'清空选择',exact:true}).click();await dialog.getByLabel('选择 P2 三首合集 / 第2首',{exact:true}).check();
    failWrite=true;await dialog.getByRole('button',{name:'添加选中 1 首',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('分 P 目标歌单').inputValue(),'B');assert(await dialog.getByLabel('选择 P2 三首合集 / 第2首',{exact:true}).isChecked());assert.equal(library.read().snapshot.playlists.find(playlist=>playlist.id==='B').entries.length,0);
    await dialog.getByRole('button',{name:'返回歌曲操作',exact:true}).click();await dialog.getByRole('button',{name:'加入歌单',exact:true}).click();assert.equal(await dialog.getByLabel('分 P 目标歌单').inputValue(),'B');await dialog.getByRole('button',{name:'选择部分分 P',exact:true}).click();assert(await dialog.getByLabel('选择 P2 三首合集 / 第2首',{exact:true}).isChecked());
    failWrite=false;conflict=true;await dialog.getByRole('button',{name:'添加选中 1 首',exact:true}).click();await dialog.getByText(/资料已被另一页面修改/).waitFor();await dialog.getByRole('button',{name:'重读资料 / 检查服务',exact:true}).click();await dialog.getByRole('button',{name:'重试保留编辑',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.music-action-modal .feedback'));assert.equal(library.read().snapshot.playlists.find(playlist=>playlist.id==='B').entries.length,1);assert.equal(writes.at(-1).save.playlistId,'B');assert.deepEqual(writes.at(-1).save.refs.map(ref=>ref.part),['9002']);await close();
  });
  await t.test('manage-group feedback retains selection and destination within the mounted dialog',async()=>{
    await openLink('BV0000000001');await dialog.getByLabel('选择 P2 三首合集 / 第2首',{exact:true}).check();await dialog.getByRole('button',{name:'添加所选 2 首',exact:true}).click();await dialog.getByRole('button',{name:'歌单',exact:true}).click();await dialog.getByLabel('分 P 目标歌单').selectOption('B');await dialog.getByRole('button',{name:'取消收藏 三首合集 / 第2首',exact:true}).click();await dialog.getByRole('button',{name:'管理整组',exact:true}).click();assert.equal(await dialog.locator('input[type=checkbox]:checked').count(),2);await dialog.getByRole('button',{name:'返回歌曲操作',exact:true}).click();await dialog.getByRole('button',{name:'加入歌单',exact:true}).click();assert.equal(await dialog.getByLabel('分 P 目标歌单').inputValue(),'B');await dialog.getByRole('button',{name:'选择部分分 P',exact:true}).click();assert.equal(await dialog.locator('input[type=checkbox]:checked').count(),2);await close();
  });
  await t.test('saved P adopts its exact queued source as a song selection without expanding or duplicating it',async()=>{
    await close();
    await page.locator('nav:visible').getByRole('button',{name:'歌单',exact:true}).click();await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'歌单 A'}).first().click();const before=await saved();await page.locator('.main-content .song-library-row').getByRole('button',{name:'播放 三首合集 / 第3首',exact:true}).click();await playing();await page.waitForFunction(()=>{const queue=JSON.parse(localStorage.getItem('slow-listening:playback:v3'));return queue.items.find(track=>track.instanceId===queue.current)?.selection.kind==='song';});const queue=await saved();assert.deepEqual(queue.items.map(track=>track.instanceId),before.items.map(track=>track.instanceId));assert.equal(queue.current,before.current);assert.equal(preparations.at(-1).part,'9003');assert.equal(await dialog.count(),0);await page.locator('nav:visible').getByRole('button',{name:'发现',exact:true}).click();
  });
  await t.test('over-limit playback keeps the previous queue and selection',async()=>{
    // Native popovers dismiss on scroll; settle the automatic scroll before opening feedback.
    const before=await saved();await openLink('BV0000000005');await dialog.getByRole('button',{name:'全选分 P',exact:true}).click();await dialog.getByRole('button',{name:'播放所选 501 首',exact:true}).click();const failure=dialog.getByRole('button',{name:'播放失败，查看详情',exact:true});await failure.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await failure.click();await dialog.getByText(/播放队列最多支持 500 首/).waitFor();await page.keyboard.press('Escape');assert.deepEqual((await saved()).items,before.items);assert.equal(await dialog.locator('input[type=checkbox]:checked').count(),30);await dialog.getByRole('button',{name:'分 P尾页',exact:true}).click();assert.equal(await dialog.locator('input[type=checkbox]:checked').count(),21);assert(await dialog.getByRole('button',{name:'播放所选 501 首',exact:true}).isEnabled());await close();
  });
  await t.test('rapid clicks and cancelled metadata cannot open a stale prompt',async()=>{
    delayedId=long[0].ref.id;await page.getByRole('button',{name:'播放 长分 P 歌单',exact:true}).click();await page.getByRole('button',{name:'播放 独立歌曲',exact:true}).click();await playing();await page.waitForTimeout(500);const queue=await saved();assert.equal(queue.items.find(track=>track.instanceId===queue.current)?.selection.ref.id,solo[0].ref.id);assert.equal(await dialog.count(),0);delayedId='';
  });
  await t.test('adding a whole group appends to the live queue without replacing or reloading it',async()=>{
    await page.getByRole('button',{name:'更多操作 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'加入队列',exact:true}).click();const before=await saved(),prepared=preparations.length;
    await page.evaluate(()=>{document.querySelector('audio').currentTime=6;});await dialog.getByRole('button',{name:'加入队列全部 3 首',exact:true}).click();await dialog.getByRole('button',{name:'立即播放',exact:true}).waitFor();const after=await saved();assert.equal(after.current,before.current);assert.equal(after.items.length,before.items.length+3);assert.deepEqual(after.items.slice(-3).map(track=>track.selection.ref.part),['9001','9002','9003']);assert.equal(preparations.length,prepared);assert(await page.locator('audio').evaluate(audio=>audio.currentTime>=6&&!audio.paused));await close();
  });
  await t.test('failed metadata can retry within the same dialog and late responses cannot reopen a closed dialog',async()=>{
    metadataFailure=cold[0].ref.id;await page.getByLabel('搜索歌曲或视频').fill('读取失败');await page.getByRole('button',{name:'开始搜索',exact:true}).click();const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});await search.getByRole('button',{name:'显示全部',exact:true}).click();await search.getByRole('button',{name:'更多操作 读取失败合集',exact:true}).click();await dialog.getByRole('button',{name:'重试读取歌曲',exact:true}).waitFor();assert(await dialog.getByRole('button',{name:'立即播放',exact:true}).isDisabled());metadataFailure='';await dialog.getByRole('button',{name:'重试读取歌曲',exact:true}).click();await dialog.getByRole('button',{name:'2 个分 P · 查看整组',exact:true}).waitFor();assert.equal(await dialog.getByRole('alert').count(),0);await close();await search.getByRole('button',{name:'关闭',exact:true}).click();
  });
  const measurements=[];
  await t.test('clean cover interactions and fixed mobile sheets render in both themes',async()=>{
    assert.equal(await page.locator('.cover-play').count(),0);await page.locator('.art-wrap').first().hover();await page.waitForTimeout(260);assert(await page.locator('.art-wrap').first().evaluate(element=>getComputedStyle(element).transform!=='none'));
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.art-wrap').first().evaluate(element=>getComputedStyle(element).transform),'none');await page.emulateMedia({reducedMotion:'no-preference'});
    for(const theme of ['light','dark'])for(const width of [1440,390,320]){
      await close();await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>[...document.querySelectorAll('.music-card:not(.catalog-empty-slot) .cover-button img')].length===4&&[...document.querySelectorAll('.music-card:not(.catalog-empty-slot) .cover-button img')].every(image=>image.complete&&image.naturalWidth>0));await page.screenshot({path:join(artifacts,`covers-${theme}-${width}.png`),fullPage:true});
      await openLink('BV0000000004');await dialog.locator('.part-entry').nth(23).waitFor();await dialog.locator('.music-action-content').evaluate(element=>element.scrollTop=element.scrollHeight);
      const metrics=await dialog.evaluate(element=>{const frame=element.getBoundingClientRect(),header=element.querySelector('.modal-header').getBoundingClientRect(),footer=element.querySelector('.music-action-footer').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:element.scrollWidth>element.clientWidth,frame:{top:frame.top,bottom:frame.bottom},header:header.top,footer:footer.bottom,height:innerHeight};});assert.equal(metrics.overflow,false);assert.equal(metrics.dialogOverflow,false);assert(metrics.header>=metrics.frame.top&&metrics.footer<=metrics.frame.bottom+1);if(width<760)assert(Math.abs(metrics.frame.bottom-metrics.height)<=1);measurements.push({theme,width,...metrics});await page.screenshot({path:join(artifacts,`parts-${theme}-${width}.png`)});
    }
    await dialog.locator('.part-entry').nth(23).getByRole('button',{name:'更多操作 长分 P 歌单 / 第24首',exact:true}).click();await dialog.getByRole('button',{name:'24 个分 P · 查看整组',exact:true}).click();assert(await dialog.locator('.music-action-content').evaluate(element=>element.scrollTop>100));
    await close();await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'更多操作 三首合集',exact:true}).click();await dialog.getByRole('button',{name:'关闭',exact:true}).focus();await page.keyboard.press('Tab');assert(await dialog.evaluate(element=>element.contains(document.activeElement)));await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
    await page.locator('audio').evaluate(audio=>audio.pause());
    const touch=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await touch.route('https://images.example.test/coast.png',route=>route.fulfill({contentType:'image/png',body:artwork}));await touch.goto(base);const heart=touch.locator('.cover-favorite').nth(1);await heart.waitFor();assert(await touch.evaluate(()=>matchMedia('(hover:none)').matches));
    const size=await heart.evaluate(element=>({button:element.getBoundingClientRect().width,icon:element.querySelector('svg').getBoundingClientRect().width}));assert.equal(size.button,48);assert.equal(size.icon,18);await heart.tap();await touch.getByRole('button',{name:'收藏全部 2 首',exact:true}).waitFor();assert(await touch.locator('audio').evaluate(audio=>audio.paused&&!audio.getAttribute('src')));await touch.screenshot({path:join(artifacts,'favorite-touch-390.png')});await touch.close();
  });
  assert.deepEqual(errors,[]);writeFileSync(join(artifacts,'report.json'),JSON.stringify({errors,measurements,preparations,metadataReads:metadataReads.length,writeCount:writes.length},null,2));
});
