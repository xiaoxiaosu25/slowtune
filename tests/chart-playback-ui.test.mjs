import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {installSearchFixture} from './helpers/search-fixture.mjs';

test('chart playback: direct first results, lazy whole charts, failures, cancellation and silent restoration',async t=>{
  const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),artifacts=resolve(process.env.MUSIC_APP_TEST_ARTIFACTS??'local/verification/chart-playback-2026-10-13/browser');mkdirSync(artifacts,{recursive:true});
  const searches=[],preparations=[],lookup=new Map(),errors=[];
  let chartItems=Array.from({length:300},(_,i)=>({rank:i+1,title:'榜单歌 '+(i+1),artists:['原榜歌手'],artwork:'/cover.svg'})),delay=0,failureMode='',sequence=0;
  const audio=Buffer.alloc(44+8000*20*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  const track=(title,provider,second=false)=>{
    const n=++sequence,id=provider==='bilibili'?'BV'+String(n).padStart(10,'0'):String(n).padStart(11,'0');
    const raw={ref:{provider,kind:'video',id},resourceId:provider+':'+n,title:title+' · '+provider+(second?'第二条':'第一条'),url:'https://example.com',uploader:{name:'实际上传者',id:'101'},durationSeconds:20};
    const canonical=provider==='bilibili'?{...raw,ref:{...raw.ref,part:String(900+n)}}:raw;
    if(title==='多P'&&!second)canonical.title='多P / 默认第一P';
    lookup.set(id,{...canonical,query:title,parts:title==='多P'?[canonical,{...canonical,ref:{...canonical.ref,part:'99999'},title:'多P / 第二P'}]:[canonical]});
    return raw;
  };
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost'),json=(data,status=200)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const body=async()=>{let text='';for await(const b of req)text+=b;return JSON.parse(text);};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(u.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(u.pathname));
    if (u.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:true}},build:{stale:false}});
    if(u.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili','youtube'].map(provider=>({provider,operations:['metadata','search','list','prepare'],anonymous:true,limitations:[]}))});
    if(u.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(u.pathname==='/api/follows')return json({revision:'1',creators:[]});
    if(u.pathname==='/api/follows/feed')return json({items:[],total:0,warnings:[],fetchedAt:1});
    if(u.pathname==='/api/discovery/bilibili')return json([]);
    if(u.pathname==='/api/youtube/music')return json({region:'HK',shelf:{id:'youtube-music-selection',kind:'recommendation',title:'YouTube 推荐',page:{items:[]}},warnings:[],playlists:[],fetchedAt:1});
    if(u.pathname==='/api/charts')return json({source:'netease',chart:'hot',title:'测试榜单',items:chartItems.map(x=>({...x,artwork:x.artwork?'https://example.com/cover.jpg':undefined})),sourceUrl:'https://example.com',fetchedAt:1});
    if(u.pathname==='/cover.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#558b7c"/></svg>');}
    if(u.pathname==='/bad-fixture.wav'){res.writeHead(404);return res.end();}
    if(u.pathname==='/fixture.wav'){
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),audio.length-1):audio.length-1;
      res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})});return res.end(audio.subarray(start,end+1));
    }
    if(u.pathname.startsWith('/v1/call/')){
      const input=await body(),op=u.pathname.split('/').at(-1),result=x=>json({protocol:2,result:x});
      if(op==='search'){
        const query=input.request.query.replace(/ (?:原榜歌手|榜单歌手)$/,''),provider=input.provider;searches.push({provider,...input.request});const wait=delay;await new Promise(r=>setTimeout(r,wait));
        if(failureMode==='fatal'||query==='限流')return json({protocol:2,error:{code:'rate-limited',retryable:true}},429);
        if(failureMode==='unavailable')return json({protocol:2,error:{code:'upstream',upstreamCode:'503',retryable:false}},503);
        if(query==='B站报错'&&provider==='bilibili')return json({protocol:2,error:{code:'restricted',retryable:false}},400);
        if(failureMode==='empty'||query==='查无结果'||query==='空结果'||query==='YouTube回退'&&provider==='bilibili')return result({items:[]});
        return result({items:[track(query,provider),track(query,provider,true)]});
      }
      const ref=input.ref??input.request?.ref,x=lookup.get(ref?.id);
      if(op==='metadata')return result(x);
      if(op==='prepare'){
        preparations.push({id:ref.id,part:ref.part,query:x.query});
        if(x.query==='取源失败')return json({protocol:2,error:{code:'not-found',retryable:false}},400);
        return result({resourceId:x.resourceId,entry:x,format:{id:'pcm',codec:'pcm',container:'wav',mimeType:'audio/wav'},delivery:{url:'http://127.0.0.1:'+server.address().port+(x.query==='媒体失败'?'/bad-fixture.wav?':'/fixture.wav?')+preparations.length,requiresHost:false}});
      }
      return result({items:[]});
    }
    try{const file=join(root,'dist/client',u.pathname==='/'?'index.html':u.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  const searchFixture=installSearchFixture(server);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://example.com/cover.jpg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#558b7c"/></svg>'}));
  const base='http://127.0.0.1:'+server.address().port,storage=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const nav=async name=>{await page.locator('nav:visible').getByRole('button',{name,exact:true}).click();};
  const load=async items=>{chartItems=items;await page.goto(base);await page.locator('.app').waitFor();await nav('音乐榜单');await page.waitForFunction(title=>document.querySelector('.chart-song-title')?.textContent===title,items[0].title);};
  const one=(title,extra={})=>({rank:1,title,...extra});
  const direct=title=>page.getByRole('button',{name:'直接播放 '+title,exact:true}).click();
  const playing=title=>page.waitForFunction(title=>document.querySelector('.now-playing strong')?.textContent===title&&!document.querySelector('audio').paused,title);
  const finish=async()=>{await page.evaluate(()=>{const a=document.querySelector('audio');a.currentTime=a.duration-.05;});};
  const openIssues=async()=>{const panel=page.locator('.playback-feedback-popover [popover]:popover-open');if(!await panel.count())await page.getByRole('button',{name:/^(播放失败|\d+ 首未能播放)，查看详情$/}).click();return panel;};
  const failureSummary=async()=>{const panel=await openIssues(),text=await panel.locator('.popover-heading').filter({hasText:/首榜单歌曲未能播放/}).textContent();await page.keyboard.press('Escape');return text;};
  await load(chartItems);
  await t.test('chart artwork and artists render and the separate search button opens the shared search dialog',async()=>{
    await page.locator('.chart-cover').first().evaluate(img=>img.decode());assert.equal(await page.locator('.chart-song-artists').first().textContent(),'原榜歌手');
    assert.equal(await page.locator('.chart-song-main button').count(),0);
    await page.locator('.chart-song-search').first().click();const dialog=page.getByRole('dialog',{name:'搜索音乐',exact:true});await dialog.locator('.track-row').first().waitFor();assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'榜单歌 1 原榜歌手');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  });
  await t.test('direct play takes only Bilibili first result, bypasses the search dialog and uses a one-song queue',async()=>{
    const n=searches.length;await direct('榜单歌 1');await playing('榜单歌 1');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(searches.slice(n).map(x=>x.provider),['bilibili']);assert.equal((await storage()).items.length,1);assert.equal((await storage()).repeat,'off');
  });
  await t.test('song titles, artwork and keyboard activation each play once without opening search',async()=>{
    for(const [title,selector] of [['点击歌名','.chart-song-title'],['点击封面','.chart-cover'],['键盘点播','.chart-song-main']]){
      await load([one(title,{artists:['原榜歌手'],artwork:'https://example.com/cover.jpg'})]);
      const n=searches.length,target=page.locator(selector).first();
      if(title==='键盘点播')await target.press('Enter');else await target.click();
      await playing(title+'');
      assert.equal(await page.getByRole('dialog').count(),0);assert.equal(searches.length,n+1);
      assert.equal(searches.at(-1).query,title+' 原榜歌手');
    }
  });
  await t.test('an empty Bilibili response uses YouTube first; first-result errors never select another result or source',async()=>{
    await load([one('YouTube回退')]);let n=searches.length;await direct('YouTube回退');await playing('YouTube回退');assert.deepEqual(searches.slice(n).map(x=>x.provider),['bilibili','youtube']);
    await load([one('B站报错')]);n=searches.length;const old=await storage();await direct('B站报错');await openIssues();await page.getByRole('button',{name:'去搜索',exact:true}).waitFor();assert.deepEqual(searches.slice(n).map(x=>x.provider),['bilibili']);assert.deepEqual((await storage()).items,old.items);
  });
  await t.test('no results preserve the existing audio and offer ordinary search; multi-P directly plays its default first part',async()=>{
    await load([one('多P'),{rank:2,title:'查无结果'}]);await direct('多P');await playing('多P');const before=await storage();await direct('查无结果');await openIssues();await page.getByText('没有找到符合当前偏好的可靠版本，可以搜索并显示全部结果，或指定播放版本。',{exact:true}).waitFor();assert.deepEqual((await storage()).items,before.items);assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByRole('button',{name:'去搜索',exact:true}).click();const dialog=page.getByRole('dialog',{name:'搜索音乐',exact:true});assert.equal(await dialog.getByLabel('弹窗搜索关键词').inputValue(),'查无结果');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  });
  await t.test('play all queues all 300 songs, resets the mode and resolves only the selected song',async()=>{
    await load(Array.from({length:300},(_,i)=>({rank:i+1,title:i===1?'空结果':i===2?'取源失败':'完整榜 '+(i+1),artists:['榜单歌手']})));
    await page.locator('.playbar').getByRole('button',{name:'播放模式',exact:true}).click();const n=searches.length;await page.locator('.chart-play-all').click();await playing('完整榜 1');const saved=await storage();assert.equal(saved.items.length,300);assert.equal(saved.order,'sequential');assert.equal(saved.repeat,'off');assert.equal(saved.items.filter(x=>x.selection.kind==='chart').length,300);assert.equal(searches.length,n+1);
    await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.getByRole('button',{name:'队列操作 完整榜 5',exact:true}).click();assert.equal(await page.getByRole('button',{name:'查看 UP / 博主',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
    const queuedIds=(await storage()).items.map(x=>x.instanceId),beforeSearch=searches.length;await page.locator('.queue-play-all').click();await playing('完整榜 1');assert.deepEqual((await storage()).items.map(x=>x.instanceId),queuedIds);assert.equal(searches.length,beforeSearch);assert.equal((await storage()).items.filter(x=>x.selection.kind==='chart').length,300);
    await page.screenshot({path:join(artifacts,'full-chart-desktop.png')});
  });
  await t.test('natural advancement skips empty results and first-result preparation failures and continues to the next song',async()=>{
    await finish();await playing('完整榜 4');assert.equal(await failureSummary(),'2 首榜单歌曲未能播放');assert.equal((await storage()).items.length,300);assert(preparations.some(x=>x.query==='取源失败'));assert.equal(searches.filter(x=>x.query==='取源失败 榜单歌手').length,1);
  });
  await t.test('mixed resolved/pending queues restore silently and do not search or prepare on reload',async()=>{
    const before=await storage(),n=searches.length,p=preparations.length;await page.reload();await page.locator('.app').waitFor();await page.waitForTimeout(150);const saved=await storage();assert.equal(saved.items.length,300);assert.equal(saved.current,before.current);assert.equal(searches.length,n);assert.equal(preparations.length,p);assert.equal(await page.locator('audio').evaluate(a=>a.paused&&a.currentTime===0&&!a.getAttribute('src')),true);
  });
  await t.test('cancelling a single lookup prevents a late result from replacing or restarting the queue',async()=>{
    await nav('音乐榜单');delay=600;const before=await storage(),n=searches.length;await direct('完整榜 8');await page.waitForFunction(n=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')).items.length===n,300);await page.getByRole('button',{name:'取消播放准备',exact:true}).click();await page.waitForTimeout(700);delay=0;assert.equal(searches.length,n+1);assert.deepEqual((await storage()).items,before.items);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
  });
  await t.test('rapid selection during deferred search cancels the old item; stopping prevents further auto-skip',async()=>{
    delay=600;await page.locator('.chart-play-all').click();await page.getByRole('button',{name:'下一首',exact:true}).click();await page.waitForTimeout(50);await page.getByRole('button',{name:'取消播放准备',exact:true}).click();const n=searches.length;await page.waitForTimeout(750);delay=0;assert.equal(searches.length,n);assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
  });
  await t.test('a newer direct play wins over an old delayed lookup',async()=>{
    delay=500;const before=await storage();await direct('完整榜 8');await page.waitForTimeout(40);delay=0;await direct('完整榜 9');await playing('完整榜 9');await page.waitForTimeout(600);assert.equal((await storage()).items.length,before.items.length+1);assert.equal(await page.locator('.now-playing strong').textContent(),'完整榜 9');
  });
  await t.test('a new direct play immediately cancels a deferred chart source and no late source can win',async()=>{
    searchFixture.service.dispose();
    delay=500;const n=searches.length;await page.locator('.chart-play-all').click();await page.waitForTimeout(60);delay=0;await direct('完整榜 10');await playing('完整榜 10');const p=preparations.length;await page.waitForTimeout(600);assert.equal((await storage()).items.length,301);assert.equal(preparations.length,p);assert.equal(searches.length,n+2);assert.equal(await page.locator('.now-playing strong').textContent(),'完整榜 10');
  });
  await t.test('all failing songs finish after one pass; rate limiting stops further requests',async()=>{
    await load([one('失败一'),{rank:2,title:'失败二'},{rank:3,title:'失败三'}]);failureMode='empty';let n=searches.length;await page.locator('.chart-play-all').click();await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).waitFor();await openIssues();await page.getByText('榜单播放已结束，未能播放的歌曲已列出。',{exact:true}).waitFor();await page.waitForTimeout(100);assert.equal(searches.length,n+6);assert.equal(await failureSummary(),'3 首榜单歌曲未能播放');
    failureMode='fatal';n=searches.length;await page.locator('.chart-play-all').click();await openIssues();await page.getByText('来源请求过于频繁，请稍后重试。',{exact:true}).first().waitFor();await page.waitForTimeout(100);assert.equal(searches.length,n+1);failureMode='';
  });
  await t.test('upstream 503 stops the chart without requesting later songs',async()=>{
    failureMode='unavailable';const n=searches.length;
    try {await page.locator('.chart-play-all').click();await openIssues();await page.getByText('来源暂时无法返回有效内容，请重试。',{exact:true}).first().waitFor();await page.waitForTimeout(100);assert.equal(searches.length,n+1);}
    finally {failureMode='';}
  });
  await t.test('missing/failed artwork has a placeholder and mobile keeps 48px controls with a roomy play surface',async()=>{
    await load([one('手机歌曲',{artists:['歌手甲','歌手乙'],artwork:'bad'}),{rank:2,title:'缺资料'}]);await page.route('https://example.com/cover.jpg',route=>route.abort());await page.reload();await nav('音乐榜单');await page.locator('.chart-song').first().waitFor();await page.locator('.chart-song').getByLabel('封面未知').first().waitFor();await page.getByText('歌手未知',{exact:true}).waitFor();assert.equal(await page.getByText('歌手未知',{exact:true}).count(),1);
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:740});await page.locator('.app[data-layout="'+(width>760?'desktop':'mobile')+'"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert(await page.locator('.chart-song .row-number').first().isVisible());
      for(const selector of width>760?['.chart-song-play','.chart-song-search']:['.chart-song-search']){
        const button=page.locator(selector).first(),box=await button.boundingBox();
        assert.equal(box.width,width>760?36:48);assert.equal(box.height,width>760?36:48);
        const style=await button.evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderColor,background:s.backgroundColor};});
        assert.equal(style.border,'rgba(0, 0, 0, 0)');assert.equal(style.background,'rgba(0, 0, 0, 0)');
      }
      if(width<=760){assert.equal(await page.locator('.chart-song-play').first().isVisible(),false);assert((await page.locator('.chart-song-main').first().boundingBox()).height>=48);}
      assert.equal(await page.locator('.chart-song-play svg').first().getAttribute('width'),'16');
      assert.equal(await page.locator('.chart-song .row-number').first().evaluate(el=>getComputedStyle(el).fontSize),'12px');
      await page.screenshot({path:join(artifacts,'charts-'+width+'.png'),fullPage:true});
    }
  });
  await t.test('a native media failure skips the chosen first video without trying its second search result',async()=>{
    await page.setViewportSize({width:1440,height:900});await load([one('媒体失败'),{rank:2,title:'媒体后继'}]);const n=searches.length;await page.locator('.chart-play-all').click();await playing('媒体后继');assert.equal(searches.length,n+2);assert.equal(await failureSummary(),'1 首榜单歌曲未能播放');
  });
  await t.test('list repeat skips a prior media failure without searching or preparing it again',async()=>{
    const mode=page.locator('.playbar').getByRole('button',{name:'播放模式',exact:true});
    for(let i=0;i<4&&await mode.getAttribute('data-mode')!=='all';i++)await mode.click();assert.equal(await mode.getAttribute('data-mode'),'all');
    const n=searches.length,p=preparations.length;await finish();
    await page.waitForFunction(()=>document.querySelector('audio')?.currentTime<1&&JSON.parse(localStorage.getItem('slow-listening:playback:v3')).repeat==='all');
    await playing('媒体后继');
    assert.equal(searches.length,n);assert.equal(preparations.length,p+1);assert.equal(await failureSummary(),'1 首榜单歌曲未能播放');
  });
  assert.deepEqual(errors,[]);writeFileSync(join(artifacts,'report.json'),JSON.stringify({searches,preparations,errors},null,2));
});
