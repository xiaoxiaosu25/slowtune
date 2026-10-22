import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {fromMusicRef} from './helpers/song-fixture.mjs';
import {installSearchFixture} from './helpers/search-fixture.mjs';

test('music browsing: discovery, four chart tabs, search dialogs and the default favorites playlist',async t=>{
  const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),artifacts=resolve('local/verification/music-browse-2026-10-13');mkdirSync(artifacts,{recursive:true});
  const lookup=new Map();
  const track=(provider,n,title)=>{const value={ref:{provider,kind:'video',id:provider==='bilibili'?'BV'+String(n).padStart(10,'0'):String(n).padStart(11,'0'),...(provider==='bilibili'?{part:String(n+900)}:{})},resourceId:provider+':'+n,title,url:'https://example.com',durationSeconds:30,uploader:{id:'101',name:'测试作者'},publishedAt:1791800000000-n};lookup.set(value.ref.id,value);return value;};
  const a=track('bilibili',1,'旧收藏甲'),b=track('youtube',2,'旧收藏乙');
  const saved=x=>({ref:fromMusicRef(x.ref),metadata:{title:x.title,uploader:x.uploader.name},availability:{state:'unknown'},addedAt:1});
  const snapshot={playlists:[{id:'p1',name:'自建歌单',entries:[],createdAt:1,updatedAt:1}],favorites:[saved(a),saved(b)]};
  let revision=1,chartFailure=false,chartDelay=0,searchDelay=0,discoveryCalls=0,youtubeCalls=0,feedCalls=0,prepareCalls=0,metadataFailure=false;
  const searches=[],confirmations=[],chartCalls=[],metadataReads=[];
  const follow={revision:'f1',creators:[{provider:'bilibili',id:'101',name:'测试作者',url:'https://www.bilibili.com',followedAt:1}]};
  const wave=Buffer.alloc(44+8000*30*2);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost'),json=(value,status=200)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const body=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(u.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(u.pathname));
    if (u.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:true}},delivery:{leases:0},tool:{active:0},build:{stale:false}});
    if(u.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili','youtube'].map(provider=>({provider,operations:['metadata','search','list','prepare'],anonymous:true,limitations:[]}))});
    if(u.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(u.pathname==='/api/follows'){if(req.method==='POST'){const input=await body();follow.revision+='x';follow.creators=input.action==='unfollow'?[]:[{provider:'bilibili',id:'101',name:'测试作者',url:'https://www.bilibili.com',followedAt:1}];return json({...follow,creator:{provider:'bilibili',id:'101'}});}return json(follow);}
    if(u.pathname==='/api/follows/feed'){feedCalls++;return json({items:Array.from({length:18},(_,i)=>track('bilibili',100+i,'关注更新 '+(i+1))),total:18,warnings:[],fetchedAt:Date.now()});}
    if(u.pathname==='/api/discovery/bilibili'){discoveryCalls++;const items=Array.from({length:20},(_,i)=>track('bilibili',200+i,'B站推荐 '+(i+1)));return json([{id:'music-recommendation',title:'B站推荐',kind:'recommendation',page:{items},recommendation:{token:'bili'+discoveryCalls,pool:20,entry:1,order:'upstream',processed:false}}]);}
    if(u.pathname==='/api/youtube/music'){youtubeCalls++;return json({region:u.searchParams.get('region'),shelf:{id:'youtube-music-selection',title:'YouTube 推荐',kind:'recommendation',page:{items:Array.from({length:36},(_,i)=>track('youtube',300+i,'YouTube 推荐 '+(i+1)))},recommendation:{token:'youtube'+youtubeCalls,pool:36,entry:1,order:'upstream',processed:false}},warnings:[],playlists:[],fetchedAt:Date.now()});}
    if(u.pathname==='/api/recommendation/confirm'){confirmations.push(await body());return json({accepted:true});}
    if(u.pathname==='/api/charts'){
      const source=u.searchParams.get('source'),kind=u.searchParams.get('chart'),p=u.searchParams.get('period');chartCalls.push({source,kind,p});const delay=chartDelay;await new Promise(r=>setTimeout(r,delay));
      if(chartFailure)return json({error:{code:'network'}},503);
      const periods=[{id:439,number:226,publishedAt:1791540001000},{id:437,number:225,publishedAt:1790935200000}],period=p==='437'?periods[1]:periods[0];
      return json({source,chart:kind,title:source+'榜单',items:Array.from({length:60},(_,i)=>({rank:i+1,title:i===0?'原歌名【Live】':source==='bilibili'&&p==='437'?'历史歌曲 '+i:source+'歌曲 '+i})),fetchedAt:Date.now(),updatedAt:1791540001000,sourceUrl:'https://example.com',...(source==='bilibili'?{period,periods}:{})});
    }
    if(u.pathname==='/api/identify')return json({ref:{provider:'youtube',kind:'playlist',id:'PLfixture'}});
    if(u.pathname==='/fixture.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wave.length});return res.end(wave);}
    if(u.pathname.startsWith('/v1/call/')){
      const input=await body(),operation=u.pathname.split('/').at(-1);
      if(operation==='search'){
        searches.push(input.request);await new Promise(r=>setTimeout(r,searchDelay));
        if(input.provider==='youtube'&&input.request.query==='收藏回归')return json({protocol:2,result:{items:[lookup.get(String(300).padStart(11,'0'))]}});
        const provider=input.provider,n=input.request.cursor?600:500,items=[track(provider,n,input.request.query+' · '+provider),track(provider,n+1,'搜索第二首')];items.forEach(x=>lookup.set(x.ref.id,x));
        if(provider==='bilibili'&&input.request.query==='合集'){const entry=track(provider,800,'合集'),parts=[{...entry,ref:{...entry.ref,part:'1801'},resourceId:'part-1801',title:'合集 / 第一首'},{...entry,ref:{...entry.ref,part:'1802'},resourceId:'part-1802',title:'合集 / 第二首'}];delete entry.ref.part;items.splice(0,items.length,entry);lookup.set(entry.ref.id,{...entry,parts});}
        return json({protocol:2,result:{items,...(!input.request.cursor?{nextCursor:'next'}:{})}});
      }
      if(operation==='list')return json({protocol:2,result:{items:[b]}});
      if(operation==='metadata'){metadataReads.push(input.ref);if(metadataFailure&&input.ref.provider==='youtube')return json({protocol:2,error:{code:'not-found',retryable:false}},400);const x=lookup.get(input.ref.id)??track(input.ref.provider,1,'歌曲');return json({protocol:2,result:{...x,parts:x.parts??[x]}});}
      if(operation==='prepare'){prepareCalls++;const x=lookup.get(input.request.ref.id);return json({protocol:2,result:{resourceId:x.resourceId,entry:x,format:{id:'fixture',mimeType:'audio/wav',codec:'pcm',container:'wav'},delivery:{url:'http://127.0.0.1:'+server.address().port+'/fixture.wav',requiresHost:false}}});}
      return json({protocol:2,result:{}});
    }
    try{const file=join(root,'dist/client',u.pathname==='/'?'index.html':u.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  const {libraryFixture}=installSearchFixture(server,{librarySeed:snapshot});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const nav=async name=>{const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});if(await search.count())await search.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('nav:visible').getByRole('button',{name,exact:true}).click();};
  const dialog=page.getByRole('dialog',{name:'搜索音乐',exact:true});
  await page.goto('http://127.0.0.1:'+server.address().port);

  await t.test('three fixed-size discovery shelves and independent refresh',async()=>{
    await page.waitForFunction(()=>document.querySelectorAll('.discovery-shelf .music-card').length===24&&document.querySelectorAll('[data-shelf-id="follow-updates"] .track-row').length===12);
    assert.deepEqual(await page.locator('.sidebar-nav button').allTextContents(),['发现','音乐榜单','关注','歌单']);assert.equal(await page.locator('.discovery-shelf').count(),3);
    assert.equal(await page.locator('select[aria-label$="展示数量"]').count(),0);
    const y=youtubeCalls,f=feedCalls;await page.getByRole('button',{name:'B站推荐换一批',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled);assert.equal(youtubeCalls,y);assert.equal(feedCalls,f);
    assert(confirmations.length&&confirmations.every(x=>x.ids.length===12));assert.equal(chartCalls.length,0);
    await page.locator('[data-shelf-id="music-recommendation"] .card-menu').first().click();const menu=page.getByRole('dialog',{name:'歌曲与分 P',exact:true});await menu.getByRole('button',{name:'取消关注 测试作者',exact:true}).click();await menu.getByRole('button',{name:'关注 测试作者',exact:true}).waitFor();assert.equal(await page.locator('[data-shelf-id="follow-updates"] .track-row').count(),0);
    await menu.getByRole('button',{name:'关注 测试作者',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-shelf-id="follow-updates"] .track-row').length===12);await menu.getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.page-heading .source-tabs').getByRole('button',{name:'B站',exact:true}).click();assert.equal(await page.locator('.discovery-shelf').count(),2);await page.locator('.page-heading .source-tabs').getByRole('button',{name:'全部',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.discovery-shelf .music-card').length===24);
    await page.screenshot({path:join(artifacts,'discovery-desktop.png'),fullPage:true});
  });
  await t.test('saved YouTube videos can be unfavorited in discovery and search when metadata fails',async()=>{
    const ref={provider:'youtube',kind:'video',id:String(300).padStart(11,'0')},stable=fromMusicRef(ref),name='收藏 YouTube 推荐 1';
    const isSaved=()=>{const current=libraryFixture.library.read().snapshot,songId=current.versions.find(v=>v.ref.provider===ref.provider&&v.ref.id===ref.id)?.songId;return current.favorites.some(f=>f.songId===songId);};
    const reads=()=>metadataReads.filter(r=>r.provider===ref.provider&&r.id===ref.id).length;
    const waitSaved=value=>page.waitForFunction(({name,value})=>Array.from(document.querySelectorAll('button')).some(button=>button.getAttribute('aria-label')===name&&button.getAttribute('aria-pressed')===String(value)),{name,value});
    for(const context of ['discovery','search']){
      metadataFailure=false;await page.reload();await nav('发现');
      let button=page.locator('[data-shelf-id="youtube-music-selection"]').getByRole('button',{name,exact:true});
      await button.waitFor();assert.equal(isSaved(),false);const beforeAdd=reads(),known=libraryFixture.library.read().snapshot.versions.some(v=>v.ref.provider===ref.provider&&v.ref.id===ref.id);
      await button.click();await waitSaved(true);assert.equal(isSaved(),true);if(known)assert.equal(reads(),beforeAdd);else assert(reads()>beforeAdd);
      metadataFailure=true;await page.reload();await page.locator('.app').waitFor();
      if(context==='search'){
        await page.getByLabel('搜索歌曲或视频').fill('收藏回归');await page.getByRole('button',{name:'开始搜索',exact:true}).click();
        button=dialog.getByRole('button',{name,exact:true});
      }else button=page.locator('[data-shelf-id="youtube-music-selection"]').getByRole('button',{name,exact:true});
      await button.waitFor();const beforeRemove=reads(),beforeRevision=libraryFixture.library.read().revision;
      await button.click();await waitSaved(false);assert.equal(isSaved(),false);const afterRemove=libraryFixture.library.read().revision;assert.notEqual(afterRemove,beforeRevision);assert.equal(reads(),beforeRemove);assert.equal(await page.getByRole('alert').count(),0);
      // The exact source remains in the song index after unfavoriting. Saving
      // that known source again reuses stored facts even when upstream is down.
      await button.click();await waitSaved(true);assert.equal(isSaved(),true);assert.notEqual(libraryFixture.library.read().revision,afterRemove);assert.equal(reads(),beforeRemove);assert.equal(await page.getByRole('alert').count(),0);
      metadataFailure=false;
      await button.click();await waitSaved(false);assert.equal(isSaved(),false);
    }
  });
  await t.test('all chart tabs, historical periods, failed and superseded reads',async()=>{
    await nav('音乐榜单');await page.locator('.chart-song').first().waitFor();assert.equal(await page.locator('.chart-song').count(),30);
    await page.getByRole('button',{name:'榜单歌曲尾页',exact:true}).click();assert.equal(await page.locator('.chart-song').first().getAttribute('data-rank'),'31');
    await page.getByRole('button',{name:'榜单歌曲首页',exact:true}).click();
    await page.getByLabel('网易云榜单').selectOption('new');await page.waitForFunction(()=>document.querySelector('.chart-page-controls select')?.value==='new'&&!document.querySelector('.charts-page .loading'));
    const chartTabs=page.getByRole('tablist',{name:'榜单平台'});
    await chartTabs.getByRole('tab',{name:'网易云',exact:true}).press('ArrowRight');
    assert.equal(await chartTabs.getByRole('tab',{name:'QQ',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await chartTabs.getByRole('tab',{name:'QQ',exact:true}).evaluate(el=>el===document.activeElement),true);
    await chartTabs.getByRole('tab',{name:'QQ',exact:true}).press('End');
    assert.equal(await chartTabs.getByRole('tab',{name:'Apple Music',exact:true}).getAttribute('aria-selected'),'true');
    await chartTabs.getByRole('tab',{name:'Apple Music',exact:true}).press('Home');
    assert.equal(await chartTabs.getByRole('tab',{name:'网易云',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await chartTabs.locator('[tabindex="0"]').count(),1);
    for(const [name,id] of [['QQ','qq'],['Apple Music','apple'],['B站','bilibili']]){await page.getByRole('tab',{name,exact:true}).click();await page.getByRole('tabpanel',{name:id+'榜单',exact:true}).waitFor();assert.equal(await page.locator('.chart-song').count(),30);}
    const period=page.getByLabel('B站热歌榜期次');await period.selectOption('437');await page.getByText('历史歌曲 1',{exact:true}).waitFor();
    chartFailure=true;await period.selectOption('latest');await page.getByRole('button',{name:'重试榜单',exact:true}).waitFor();assert.equal(await period.inputValue(),'437');assert.equal(await page.getByText('历史歌曲 1',{exact:true}).count(),1);
    chartFailure=false;await page.getByRole('button',{name:'重试榜单',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.charts-page .loading'));
    chartDelay=350;await period.selectOption('latest');await page.waitForTimeout(30);chartDelay=0;await period.selectOption('437');await page.waitForTimeout(450);assert.equal(await period.inputValue(),'437');
    assert.equal(await page.locator('.chart-song .source-badge,.chart-song img,.chart-song .row-duration').count(),0);
    await page.screenshot({path:join(artifacts,'charts-desktop.png'),fullPage:true});
  });
  await t.test('the separate song search retains the chart, scroll, focus, nested menus and playback',async()=>{
    await page.locator('.chart-song').nth(25).scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);
    const chartRow=page.locator('.chart-song').nth(25),opener=chartRow.locator('.chart-song-search'),title=await chartRow.locator('.chart-song-title').textContent();await opener.click();await dialog.locator('.track-row').first().waitFor();
    assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),title);assert.equal(await page.getByLabel('搜索歌曲或视频').inputValue(),title);assert.match(await dialog.locator('.search-description').textContent(),new RegExp(title));assert(searches.slice(-2).every(x=>x.query===title));
    const row=dialog.locator('.track-row').first();await row.getByRole('button',{name:'更多操作 '+title+' · bilibili',exact:true}).click();
    const child=page.getByRole('dialog',{name:'歌曲与分 P',exact:true});await child.getByRole('button',{name:'收藏',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.music-action-footer button[aria-pressed]')?.getAttribute('aria-pressed')==='true');
    await child.getByRole('button',{name:'关闭',exact:true}).click();assert(await dialog.isVisible());assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
    await row.getByRole('button',{name:'播放 '+title+' · bilibili',exact:true}).click();await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>0;});assert(prepareCalls>0);assert(await dialog.isVisible());
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await page.evaluate(()=>scrollY),before);assert.equal(await opener.evaluate(el=>el===document.activeElement),true);assert.equal(await page.getByLabel('B站热歌榜期次').inputValue(),'437');assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),false);
    await page.getByLabel('搜索歌曲或视频').fill('原歌名【Live】');await page.getByRole('button',{name:'开始搜索',exact:true}).click();await dialog.locator('.track-row').first().waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.search-modal .catalog:first-of-type .track-row').length===4);assert(await dialog.getByRole('button',{name:'B站搜索结果下一页',exact:true}).isDisabled());
    await dialog.getByLabel('弹窗搜索关键词').fill('合集');await dialog.getByRole('button',{name:'搜索',exact:true}).click();await dialog.getByRole('button',{name:'播放 合集',exact:true}).click();const parts=page.getByRole('dialog',{name:'歌曲与分 P',exact:true});await parts.getByRole('button',{name:'播放整组 2 首',exact:true}).waitFor();await parts.getByText('第一首',{exact:true}).waitFor();await parts.getByRole('button',{name:'关闭',exact:true}).click();assert(await dialog.isVisible());assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'合集');
    await dialog.getByRole('button',{name:'YouTube 视频',exact:true}).click();await dialog.locator('.track-row').first().waitFor();assert.equal(await dialog.locator('.catalog').count(),1);assert.equal(await page.getByLabel('B站热歌榜期次').inputValue(),'437');
    searchDelay=350;await dialog.getByLabel('弹窗搜索关键词').fill('迟到搜索');await dialog.getByRole('button',{name:'搜索',exact:true}).click();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.waitForTimeout(400);assert.equal(await dialog.count(),0);searchDelay=0;
  });
  await t.test('existing favorites become a protected playlist with ordering, filtering and removal',async()=>{
    await nav('歌单');assert.equal(await page.locator('.playlist-copy h2').textContent(),'我的收藏');assert.equal(await page.getByRole('button',{name:'删除歌单',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'改名',exact:true}).count(),0);
    const rows=page.locator('.main-content .song-library-row');assert.equal(await rows.count(),libraryFixture.library.read().snapshot.favorites.length);assert((await rows.locator('.track-name').allTextContents()).includes('旧收藏甲'));
    await rows.first().getByRole('button',{name:'更多操作 旧收藏甲',exact:true}).click();await page.locator('.song-row-menu [popover]:popover-open').getByRole('button',{name:'下移 旧收藏甲',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.song-library-row .track-name')?.textContent==='旧收藏乙');
    await page.getByLabel('搜索歌单内音乐').fill('旧收藏甲');assert.equal(await rows.count(),1);await rows.getByRole('button',{name:'取消收藏 旧收藏甲',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.main-content .song-library-row'));assert(!libraryFixture.library.read().snapshot.favorites.some(f=>f.songId==='song-0'));
    await page.getByLabel('搜索歌单内音乐').fill('');await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'自建歌单'}).first().click();await nav('关注');await nav('歌单');assert.equal(await page.locator('.playlist-copy h2').textContent(),'自建歌单');
    await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'我的收藏'}).first().click();await page.screenshot({path:join(artifacts,'favorites-desktop.png'),fullPage:true});
  });
  await t.test('public playlists use the search dialog and mobile dialogs fit the viewport',async()=>{
    await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByLabel('视频或歌单链接').fill('https://www.youtube.com/playlist?list=PLfixture');await page.getByRole('button',{name:'读取真实元信息',exact:true}).click();await dialog.getByTitle('旧收藏乙',{exact:true}).waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    for(const width of [390,320]){
      await page.setViewportSize({width,height:740});await nav('音乐榜单');await page.locator('.chart-song-search').first().waitFor();await page.locator('.chart-song-search').first().click();await dialog.locator('.track-row').first().waitFor();
      const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:el.scrollWidth,width:el.clientWidth};});assert(bounds.left>=0&&bounds.right<=width&&bounds.top>=0&&bounds.bottom<=740);assert(bounds.scroll<=bounds.width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.locator('.mobile-nav button').count(),5);await page.screenshot({path:join(artifacts,`search-${width}.png`)});await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.screenshot({path:join(artifacts,`charts-${width}.png`)});
    }
  });
  assert.deepEqual(errors,[]);writeFileSync(join(artifacts,'browser-report.json'),JSON.stringify({searches:searches.length,chartCalls,confirmations:confirmations.map(c=>({column:c.column,count:c.ids.length})),prepareCalls,errors},null,2));
});
