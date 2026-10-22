import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {fromMusicRef} from './helpers/song-fixture.mjs';
import {DEFAULT_CONFIG} from '@studio/recommendation';
import {resourceId} from '@studio/music-sources';
import {installSearchFixture} from './helpers/search-fixture.mjs';

test('list actions: loaded and filtered playback, search drafts, queue identity and responsive buttons',async t=>{
  const build=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),artifacts=resolve(process.env.MUSIC_APP_TEST_ARTIFACTS??'local/verification/list-actions-2026-10-13');mkdirSync(artifacts,{recursive:true});
  const creators=[{provider:'bilibili',id:'101',name:'测试 UP',url:'https://space.bilibili.com/101',followedAt:1},{provider:'youtube',id:'UCfixture',name:'测试博主',url:'https://www.youtube.com/@fixture',followedAt:1}];
  const lookup=new Map(),searches=[],reads=[],errors=[];
  const track=(provider,n,title)=>{
    const author=creators.find(c=>c.provider===provider),id=provider==='bilibili'?'BV'+String(n).padStart(10,'0'):String(n).padStart(11,'0');
    const ref={provider,kind:'video',id,...(provider==='bilibili'?{part:String(900+n)}:{})};
    const value={ref,resourceId:resourceId(ref),title,durationSeconds:30,url:'https://example.com',uploader:{id:author.id,name:author.name},publishedAt:1791800000000-n};lookup.set(id,value);return value;
  };
  const a=track('bilibili',1,'匹配歌曲甲'),b=track('youtube',2,'歌曲乙'),c=track('bilibili',3,'歌曲丙'),d=track('bilibili',4,'分页歌曲丁');
  const saved=x=>({ref:fromMusicRef(x.ref),metadata:{title:x.title,uploader:x.uploader.name},availability:{state:'unknown'},addedAt:1});
  const playlist={id:'p1',name:'重复条目歌单',entries:[{...saved(a),id:'a1'},{...saved(b),id:'b1'},{...saved(a),id:'a2'},{...saved(c),id:'c1'}],createdAt:1,updatedAt:1};
  const library={revision:'l1',snapshot:{playlists:[playlist],favorites:[saved(a),saved(b),saved(c)]}};
  const discovery=Array.from({length:15},(_,i)=>track('bilibili',100+i,'发现歌曲 '+(i+1)));
  discovery[0].title='超长歌曲标题 · 现场完整演出与经典音乐合集，用于检查分列布局和省略显示时的对齐';
  discovery[1].durationSeconds=36000;delete discovery[2].durationSeconds;
  let feedDelay=0,emptyFeed=false,searchFailure=false;
  const wave=Buffer.alloc(44+8000*30*2);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),json=(value,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}},body=async()=>{let input='';for await(const chunk of req)input+=chunk;return JSON.parse(input);};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:true}},delivery:{leases:0,activeReads:0},tool:{active:0},build:{stale:false}});
    if(url.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(url.pathname==='/api/follows')return json({revision:'f1',creators});
    if(url.pathname==='/api/follows/feed'){
      reads.push(url.pathname+url.search);await new Promise(r=>setTimeout(r,feedDelay));
      const items=(emptyFeed?[]:[b,a,c]).filter(x=>!url.searchParams.has('provider')||x.ref.provider===url.searchParams.get('provider'));
      return json({items,warnings:[],total:items.length,fetchedAt:1,snapshot:'feed',page:1,pageSize:30});
    }
    if(url.pathname==='/api/follows/collections')return json({items:[{id:'season:101:1',kind:'season',title:'测试合集',url:'https://example.com',count:3}]});
    if(['/api/follows/collection','/api/follows/videos'].includes(url.pathname)){
      reads.push(url.pathname+url.search);
      const items=url.pathname.endsWith('videos')?[c,a]:[a,c,d];return json({items,total:items.length,page:1,pageSize:30});
    }
    if(url.pathname==='/api/creators/profile'||url.pathname==='/api/creators/resolve')return json(creators[0]);
    if(url.pathname==='/api/discovery/bilibili')return json([{id:'music-recommendation',title:'音乐推荐',kind:'recommendation',page:{items:discovery}}]);
    if(url.pathname==='/api/youtube/music')return json({region:'HK',shelf:{id:'youtube-music-selection',title:'YouTube 音乐精选',kind:'recommendation',page:{items:[]}},warnings:[],playlists:[],fetchedAt:1});
    if(url.pathname==='/api/charts')return json({source:'netease',chart:'hot',title:'测试榜单',items:[{rank:1,title:'快捷歌名'}],sourceUrl:'https://example.com',fetchedAt:1});
    if(url.pathname==='/api/identify')return json({ref:{provider:'youtube',kind:'playlist',id:'PLfixture'}});
    if(url.pathname==='/api/recommendation/settings')return json({entry:1,epoch:0,legacyRevision:'legacy',sharedRevision:'shared',legacy:{include:[],exclude:[],mode:'any',order:'upstream'},document:{schema:1,revision:'shared',preset:{id:'fixture',revision:'v1',config:DEFAULT_CONFIG},overrides:{}},origins:{}});
    if(url.pathname.startsWith('/api/'))return json({ok:true});
    if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili','youtube'].map(provider=>({provider,operations:['metadata','search','list','prepare'],anonymous:true,limitations:[]}))});
    if(url.pathname==='/fixture.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wave.length});return res.end(wave);}
    if(url.pathname.startsWith('/v1/call/')){
      const input=await body(),operation=url.pathname.split('/').at(-1),result=value=>json({protocol:2,result:value});
      if(operation==='search'){
        searches.push({provider:input.provider,...input.request});
        if(searchFailure)return json({protocol:2,error:{code:'network',retryable:true}},503);
        const n=(input.provider==='bilibili'?600:700)+(input.request.cursor?2:0),items=[0,1].map(i=>track(input.provider,n+i,input.request.query+' · '+input.provider+' '+(n+i)));
        return result({items,...(!input.request.cursor?{nextCursor:'search-next'}:{})});
      }
      if(operation==='list')return result({items:[b]});
      const ref=input.ref??input.request?.ref,value=lookup.get(ref?.id);
      if(operation==='metadata')return result({...value,parts:[value]});
      if(operation==='prepare')return result({resourceId:value.resourceId,entry:value,format:{id:'fixture',mimeType:'audio/wav',codec:'pcm',container:'wav'},delivery:{url:'http://127.0.0.1:'+server.address().port+'/fixture.wav',requiresHost:false}});
      return result({items:[]});
    }
    try{const file=join(build,'dist/client',url.pathname==='/'?'index.html':url.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  const {libraryFixture}=installSearchFixture(server,{librarySeed:library.snapshot});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const dialog=page.getByRole('dialog',{name:'搜索音乐',exact:true}),nav=async name=>{if(await dialog.count())await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('nav:visible').getByRole('button',{name,exact:true}).click();};
  const storage=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const playAndCheck=async(button,titles)=>{
    await page.evaluate(()=>{const audio=document.querySelector('audio');if(audio?.duration)audio.currentTime=5;});
    await button.click();
    try{await page.waitForFunction(titles=>{const saved=JSON.parse(localStorage.getItem('slow-listening:playback:v3')??'null'),audio=document.querySelector('audio');return saved?.items.length===titles.length&&saved.items.every((x,i)=>x.title===titles[i])&&saved.current===saved.items[0].instanceId&&audio&&!audio.paused&&audio.currentTime<1;},titles,{timeout:5000});}
    catch(error){console.log(await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('slow-listening:playback:v3')??'null'),audio=document.querySelector('audio');return {saved,audio:{paused:audio.paused,position:audio.currentTime,readyState:audio.readyState,error:audio.error?.message},feedback:[...document.querySelectorAll('.feedback')].map(x=>x.textContent)};}));throw error;}
  };
  await page.goto('http://127.0.0.1:'+server.address().port);

  await t.test('discovery queues exactly the visible twelve songs and empty shelves disable play all',async()=>{
    const shelf=page.locator('[data-shelf-id="music-recommendation"]');await shelf.locator('.music-card').nth(11).waitFor();
    await playAndCheck(shelf.getByRole('button',{name:'播放全部',exact:true}),discovery.slice(0,12).map(x=>x.title));
    assert.equal(await page.locator('[data-shelf-id="youtube-music-selection"] .play-all').isDisabled(),true);
  });
  await t.test('collections and author uploads queue loaded items only and expand after pagination',async()=>{
    await nav('关注');await page.getByRole('button',{name:'查看 测试 UP 的合集',exact:true}).click();await page.getByRole('button',{name:'打开合集 测试合集',exact:true}).waitFor();assert.equal(await page.locator('.follows-page .play-all').count(),0);
    await page.getByRole('button',{name:'打开合集 测试合集',exact:true}).click();const all=page.locator('.follows-page .play-all');await all.waitFor();await playAndCheck(all,[a.title,c.title,d.title]);assert(!reads.some(x=>x.includes('cursor=content-next')));
    await page.getByRole('button',{name:'返回作者合集',exact:true}).click();await page.getByRole('button',{name:'全部投稿',exact:true}).click();await page.locator('.follows-page .track-row').nth(1).waitFor();await playAndCheck(all,[c.title,a.title]);
    await page.getByRole('button',{name:'返回关注',exact:true}).click();
  });
  await t.test('recent updates follow source filtering, view changes and loaded pages; refresh keeps retained items playable',async()=>{
    await nav('关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();const all=page.locator('.follow-toolbar .play-all');await page.locator('.follows-page .track-row').nth(2).waitFor();await playAndCheck(all,[b.title,a.title,c.title]);
    await page.getByRole('button',{name:'关注的最近更新封面视图',exact:true}).click();await page.locator('.follows-page .music-card').nth(2).waitFor();await playAndCheck(all,[b.title,a.title,c.title]);
    await page.locator('.source-tabs').getByRole('button',{name:'B站',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.follows-page .music-card').length===2);await playAndCheck(all,[a.title,c.title]);
    feedDelay=250;await page.locator('.follow-toolbar').getByRole('button',{name:'刷新',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.follow-feed-pages [aria-busy="true"]'));assert.equal(await all.isEnabled(),true);await page.waitForFunction(()=>!document.querySelector('.follow-feed-pages [aria-busy="true"]'));feedDelay=0;
    emptyFeed=true;await page.locator('.follow-toolbar').getByRole('button',{name:'刷新',exact:true}).click();await page.getByText('暂时没有可展示的更新',{exact:true}).waitFor();assert.equal(await all.isDisabled(),true);emptyFeed=false;
    await page.locator('.source-tabs').getByRole('button',{name:'全部',exact:true}).click();await page.locator('.follows-page .music-card').nth(1).waitFor();
  });
  await t.test('favorites and playlist play all honor filters and preserve duplicate entry identities',async()=>{
    await nav('歌单');await page.locator('.source-tabs').getByRole('button',{name:'B站',exact:true}).click();const all=page.locator('.playlist-intro .play-all');await playAndCheck(all,[a.title,c.title]);
    await page.getByLabel('搜索歌单内音乐').fill('匹配');await playAndCheck(all,[a.title]);
    await page.getByLabel('搜索歌单内音乐').fill('不存在');assert.equal(await all.isDisabled(),true);
    await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'重复条目歌单'}).first().click();await page.getByLabel('搜索歌单内音乐').fill('匹配');await playAndCheck(all,[a.title,a.title]);const queue=await storage();assert.equal(new Set(queue.items.map(x=>x.instanceId)).size,2);assert.equal(queue.items[0].selection.songId,queue.items[1].selection.songId);
    await page.getByLabel('搜索歌单内音乐').fill('');await playAndCheck(all,[a.title,a.title,c.title]);
  });
  await t.test('shortcut search leaves both inputs empty; source switches, retries and pagination use the submitted term',async()=>{
    await nav('音乐榜单');await page.getByLabel('搜索歌曲或视频').fill('旧输入');await page.getByRole('button',{name:'搜索 快捷歌名',exact:true}).click();await dialog.locator('.track-row').nth(3).waitFor();
    assert.equal(await page.getByLabel('搜索歌曲或视频').inputValue(),'');assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'');assert(searches.slice(-2).every(x=>x.query==='快捷歌名'));assert.match(await dialog.locator('.search-description').textContent(),/快捷歌名/);
    const bili=dialog.locator('.catalog').filter({has:page.getByRole('heading',{name:'B站',exact:true})});await playAndCheck(bili.locator('.play-all'),['快捷歌名 · bilibili 600','快捷歌名 · bilibili 601','快捷歌名 · bilibili 602','快捷歌名 · bilibili 603']);
    await dialog.getByLabel('弹窗搜索关键词').fill('未提交草稿');await dialog.getByRole('button',{name:'YouTube 视频',exact:true}).click();await dialog.locator('.track-row').nth(1).waitFor();assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'未提交草稿');assert.equal(searches.at(-1).query,'快捷歌名');
    await page.waitForFunction(()=>document.querySelectorAll('.search-modal .track-row').length===4);assert.equal(searches.at(-1).query,'快捷歌名');assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'未提交草稿');
    await playAndCheck(dialog.locator('.play-all'),['快捷歌名 · youtube 700','快捷歌名 · youtube 701','快捷歌名 · youtube 702','快捷歌名 · youtube 703']);
    await dialog.getByRole('button',{name:'搜索',exact:true}).click();await dialog.getByTitle('未提交草稿 · youtube 700',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'未提交草稿');assert.equal(searches.at(-1).query,'未提交草稿');
    searchFailure=true;await dialog.getByRole('button',{name:'YouTube 视频',exact:true}).click();await dialog.locator('.feedback[role="alert"]').waitFor();await dialog.getByLabel('弹窗搜索关键词').fill('重试时的新草稿');searchFailure=false;await dialog.getByRole('button',{name:'重试',exact:true}).click();await dialog.getByTitle('未提交草稿 · youtube 700',{exact:true}).waitFor();assert.equal(searches.at(-1).query,'未提交草稿');assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'重试时的新草稿');
  });
  await t.test('public playlists and the queue have play all; selecting the queue preserves IDs and playback mode',async()=>{
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByLabel('视频或歌单链接').fill('https://www.youtube.com/playlist?list=PLfixture');await page.getByRole('button',{name:'读取真实元信息',exact:true}).click();await dialog.getByTitle(b.title,{exact:true}).waitFor();await playAndCheck(dialog.locator('.play-all'),[b.title]);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();await nav('歌单');await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'重复条目歌单'}).first().click();await page.locator('.source-tabs').getByRole('button',{name:'全部',exact:true}).click();await playAndCheck(page.locator('.playlist-intro .play-all'),[a.title,b.title,a.title,c.title]);
    await page.locator('.playbar').getByRole('button',{name:'播放模式',exact:true}).click();await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.getByRole('button',{name:'播放队列歌曲 '+b.title,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.now-playing strong')?.textContent==='歌曲乙'&&!document.querySelector('audio').paused);const before=await storage();await playAndCheck(page.locator('.queue-play-all'),[a.title,b.title,a.title,c.title]);const after=await storage();assert.deepEqual(after.items.map(x=>x.instanceId),before.items.map(x=>x.instanceId));assert.equal(after.order,before.order);assert.equal(after.repeat,before.repeat);await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();
  });
  await t.test('oversized lists show an actionable limit and preserve the existing queue',async()=>{
    const entries=playlist.entries;playlist.entries=Array.from({length:501},(_,i)=>({...saved(a),id:'large-'+i}));
    libraryFixture.reset(library.snapshot);try{await page.reload();await nav('歌单');await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'重复条目歌单'}).first().click();const before=await storage();await page.locator('.playlist-intro .play-all').click();await page.getByText('当前列表超过 500 首，播放队列最多支持 500 首，请筛选后再播放。',{exact:true}).waitFor();assert.deepEqual((await storage()).items,before.items);}finally{playlist.entries=entries;libraryFixture.reset(library.snapshot);}
  });
  await t.test('list panels, numbering and column headings stay aligned across pages, breakpoints and queue states',async()=>{
    await page.setViewportSize({width:1440,height:1000});await page.reload();
    const measurements=[];
    const checkList=async(list,width)=>{
      if(await list.locator('.song-library-row').count()){
        const row=list.locator('.song-library-row').first();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await row.evaluate(el=>el.scrollWidth>el.clientWidth),false);assert.equal(await row.locator('.row-number').textContent(),'1');measurements.push({viewport:width,kind:'song',width:await row.evaluate(el=>el.clientWidth)});return;
      }
      const value=await list.evaluate(el=>{
        const heading=el.querySelector('.track-table-heading'),row=el.querySelector('.track-row'),number=row.querySelector('.row-number');
        const style=getComputedStyle(row),headingStyle=getComputedStyle(heading),bounds=node=>node.getBoundingClientRect();
        const panel=el.closest('.catalog,.follows-page>.paged-list')??el;
        return {overflow:el.scrollWidth>el.clientWidth+1,grid:style.gridTemplateColumns,headingGrid:headingStyle.gridTemplateColumns,headingVisible:headingStyle.display!=='none',
          titleDelta:bounds(heading.children[2]).left-bounds(row.querySelector('.row-info')).left,
          durationDelta:bounds(heading.querySelector('.row-duration')).right-bounds(row.querySelector('.row-duration')).right,
          number:number.textContent,font:getComputedStyle(number).fontSize,panelRadius:getComputedStyle(panel).borderRadius};
      });
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(value.overflow,false,JSON.stringify({width,...value}));assert.equal(value.number,'01');assert.equal(value.font,'12px');assert.equal(value.panelRadius,'18px');
      if(width>760){assert(value.headingVisible);assert.equal(value.grid,value.headingGrid);assert(Math.abs(value.titleDelta)<1);assert(Math.abs(value.durationDelta)<1);}
      else assert.equal(value.headingVisible,false);
      measurements.push({width,...value});
    };
    const scenarios=[
      ['discovery',async()=>{await nav('发现');await page.getByRole('button',{name:'音乐推荐列表视图',exact:true}).click();return page.locator('[data-shelf-id="music-recommendation"] .track-list');}],
      ['favorites',async()=>{await nav('歌单');await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'我的收藏'}).first().click();return page.locator('.list-view .track-list');}],
      ['playlist',async()=>{await nav('歌单');await page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({hasText:'重复条目歌单'}).first().click();return page.locator('.list-view .track-list');}],
      ['follows',async()=>{await nav('关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.getByRole('button',{name:'关注的最近更新列表视图',exact:true}).click();return page.locator('.follows-page .track-list');}],
      ['search',async()=>{await page.getByLabel('搜索歌曲或视频').fill('超长歌曲标题与现场演出完整版，用于验证搜索列表中的列对齐');await page.getByRole('button',{name:'开始搜索',exact:true}).click();return dialog.locator('.track-list').first();}],
    ];
    for(const [name,open] of scenarios){
      await page.setViewportSize({width:1440,height:1000});const list=await open();await list.locator('.track-row,.song-library-row').first().waitFor();
      for(const width of [1440,1251,1249,1051,1024,390,320]){
        await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);await checkList(list,width);
        if(width===1440||width===320)await page.screenshot({path:join(artifacts,`list-${name}-${width}.png`)});
      }
    }
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.setViewportSize({width:1440,height:1000});await nav('发现');
    const list=page.locator('[data-shelf-id="music-recommendation"] .track-list');
    await page.getByRole('button',{name:'打开播放队列',exact:true}).click();
    for(const width of [1440,1251,1249,1051]){await page.setViewportSize({width,height:1000});await checkList(list,width);}
    assert.equal(await page.locator('.queue-number').first().evaluate(el=>getComputedStyle(el).fontSize),'12px');
    assert.equal(await page.locator('.queue-track').first().evaluate(el=>getComputedStyle(el).borderRadius),'8px');
    await page.screenshot({path:join(artifacts,'list-discovery-with-queue.png')});
    await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
    for(const theme of ['light','dark'])for(const palette of ['paper','mint','ocean','plum']){
      await page.emulateMedia({colorScheme:theme});
      await page.evaluate(palette=>{localStorage.setItem('slow-listening:palette:v1',palette);window.dispatchEvent(new StorageEvent('storage',{key:'slow-listening:palette:v1',newValue:palette,storageArea:localStorage}));},palette);
      await checkList(list,1440);await page.screenshot({path:join(artifacts,`list-${palette}-${theme}.png`),animations:'disabled'});
    }
    await page.evaluate(()=>{localStorage.removeItem('slow-listening:palette:v1');window.dispatchEvent(new StorageEvent('storage',{key:'slow-listening:palette:v1',newValue:null,storageArea:localStorage}));});
    writeFileSync(join(artifacts,'list-layout-report.json'),JSON.stringify(measurements,null,2));
  });
  await t.test('light and dark layouts align toolbar controls, fit all target widths and keep touch buttons at least 44px',async()=>{
    await page.reload();await nav('关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.getByRole('button',{name:'关注的最近更新封面视图',exact:true}).click();await page.locator('.follows-page .music-card').nth(1).waitFor();
    const measurements=[];
    for(const theme of ['light','dark'])for(const width of [1440,1024,390,320]){
      await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const buttons=await page.locator('.follow-toolbar>.btn').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {label:el.textContent,top:r.top,height:r.height,radius:s.borderRadius,background:s.backgroundColor};}));assert(buttons.every(x=>x.height===(width<=760?44:40)&&x.radius==='12px'));if(width>760)assert(buttons.every(x=>x.top===buttons[0].top),'desktop actions align');measurements.push({theme,width,buttons});
      await page.screenshot({path:join(artifacts,`updates-${theme}-${width}.png`)});
      if(width===1440){await page.getByRole('button',{name:'查看 UP / 博主 · '+a.title,exact:true}).first().click();await page.getByRole('button',{name:'打开合集 测试合集',exact:true}).click();await page.locator('.follows-page .track-row').nth(1).waitFor();await page.screenshot({path:join(artifacts,`collection-${theme}.png`)});await nav('关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.locator('.follows-page .music-card').nth(1).waitFor();}
    }
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'诊断与数据',exact:true}).click();await page.screenshot({path:join(artifacts,'settings-dark.png')});
    writeFileSync(join(artifacts,'report.json'),JSON.stringify({measurements,searches,reads,errors},null,2));
  });
  assert.deepEqual(errors,[]);
});
