import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {navigate} from '../scripts/browser-ui.mjs';

test('fixed cover slots, container columns, artwork fit and shared follow views retain full pagination',async t=>{
  const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),directory=resolve('local/verification/discovery-startup-2026-10-13');mkdirSync(directory,{recursive:true});
  const track=(n,provider='bilibili')=>({ref:{provider,kind:'video',id:provider==='bilibili'?'BV'+String(n).padStart(10,'0'):String(n).padStart(11,'0')},resourceId:provider+':'+n,title:'很长的歌曲标题 · 第 '+n+' 首 · Live 现场音乐',url:'https://example.com',artwork:'https://artwork.fixture.invalid/'+(n%3===2?'missing.png':n%3===1?'square.svg':'wide.svg'),uploader:{id:'101',name:'很长的作者名字'},publishedAt:1791800000000-n*1000});
  const follow={revision:'f1',creators:[{provider:'bilibili',id:'101',name:'很长的作者名字',url:'https://example.com',followedAt:1}]};
  let biliBatch=1,startupUpdating=false,manualDelay=0;const requests=[],surfaces=[],youtubeRequests=[];
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost'),json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(u.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(u.pathname));
    if (u.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:true}},delivery:{leases:0},tool:{active:0},build:{stale:false}});
    if(u.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili','youtube'].map(provider=>({provider,operations:['metadata','search','list','prepare'],anonymous:true,limitations:[]}))});
    if(u.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(u.pathname==='/api/song-library')return json({revision:'l1',snapshot:{format:'slowtune-library',version:1,songs:[],versions:[],catalogLinks:[],redirects:[],favorites:[],playlists:[]}});
    if(u.pathname==='/api/follows')return json(follow);
    if(u.pathname==='/api/follows/feed')return json({items:Array.from({length:30},(_,i)=>track(100+i)),page:1,pageSize:30,snapshot:'updates',total:30,warnings:[],fetchedAt:1});
    if(u.pathname==='/api/discovery/bilibili'){
      const refresh=u.searchParams.get('refresh');requests.push(refresh);surfaces.push(u.searchParams.get('surface'));if(refresh==='1'){biliBatch++;await new Promise(resolve=>setTimeout(resolve,manualDelay));}
      if(res.destroyed)return;
      return json([{id:'music-recommendation',title:'B站推荐',kind:'recommendation',page:{items:Array.from({length:12},(_,i)=>track(biliBatch*1000+i))},recommendation:{token:'b'+biliBatch,batchId:'b'+biliBatch,fetchedAt:1,pool:20,entry:1,order:'upstream',processed:false,updating:startupUpdating&&refresh!=='1'}}]);
    }
    if(u.pathname==='/api/youtube/music'){
      const refresh=u.searchParams.get('refresh');youtubeRequests.push(refresh);if(refresh==='1')await new Promise(resolve=>setTimeout(resolve,manualDelay));
      if(res.destroyed)return;
      return json({region:'HK',shelf:{id:'youtube-music-selection',title:'YouTube 推荐',kind:'recommendation',page:{items:Array.from({length:3},(_,i)=>track(200+i,'youtube'))},recommendation:{token:'y1',batchId:'y1',pool:3,entry:1,order:'upstream',processed:false,updating:startupUpdating&&refresh!=='1'}},warnings:[],playlists:[],fetchedAt:1});
    }
    if(u.pathname==='/api/recommendation/confirm'||u.pathname==='/api/follows/cancel')return json({accepted:true});
    if(u.pathname==='/v1/call/metadata'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);return json({protocol:2,result:track(Number(input.ref.id.slice(2)))});}
    if(u.pathname==='/wide.svg'||u.pathname==='/square.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${u.pathname==='/wide.svg'?640:360}" height="360"><rect width="100%" height="100%" fill="#315763"/><circle cx="180" cy="180" r="110" fill="#eec08e"/></svg>`);}
    try{const file=join(root,'dist/client',u.pathname==='/'?'index.html':u.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1920,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://artwork.fixture.invalid/**',route=>route.request().url().endsWith('.png')?route.fulfill({status:404}):route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().endsWith('wide.svg')?640:360}" height="360"><rect width="100%" height="100%" fill="#315763"/><circle cx="180" cy="180" r="110" fill="#eec08e"/></svg>`}));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-shelf-id="music-recommendation"] .music-card').last().waitFor();
  const bili=page.locator('[data-shelf-id="music-recommendation"]'),youtube=page.locator('[data-shelf-id="youtube-music-selection"]'),updates=page.locator('[data-shelf-id="follow-updates"]');
  await youtube.locator('.music-card').last().waitFor();
  assert.equal(await bili.locator('.catalog-count').textContent(),'12 首');assert.equal(await youtube.locator('.music-card').count(),12);assert.equal(await youtube.locator('.catalog-empty-slot').count(),9);assert.equal(await youtube.locator('.catalog-empty-slot button').count(),0);
  assert.match(await youtube.textContent(),/符合当前规则的可用歌曲只有 3 首/);
  const initial=await bili.locator('.card-title').allTextContents();await page.reload();await bili.locator('.card-title').first().waitFor();assert.deepEqual(await bili.locator('.card-title').allTextContents(),initial);assert.deepEqual(requests,['0','0']);
  assert.deepEqual(surfaces,['desktop','desktop'],'desktop preload and workspace share the desktop policy request');
  await bili.getByRole('button',{name:'B站推荐换一批',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled);assert.equal(requests.at(-1),'1');
  const layouts=[];
  for(const width of [1920,1440,1100,390,320]){
    await page.setViewportSize({width,height:900});await navigate(page,'发现');
    const measurement=await bili.locator('.cover-grid').evaluate(el=>({width:el.clientWidth,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,card:el.querySelector('.music-card').getBoundingClientRect().width}));
    if(width>760)assert.equal(measurement.columns,measurement.width>=800?4:measurement.width>=600?3:2,'desktop cover columns retain their container layout');
    else {assert.equal(measurement.columns,1,'mobile recommendations use one featured column');assert.equal(await bili.locator('.music-card').count(),6);assert(await bili.locator('.mobile-shelf-covers').evaluate(el=>el.scrollWidth<=el.clientWidth),'mobile recommendations fit the shelf width');}
    await bili.locator('img').first().waitFor();const image=await bili.locator('.cover-button img').first().evaluate(el=>({ratio:el.getBoundingClientRect().width/el.getBoundingClientRect().height,fit:getComputedStyle(el).objectFit}));if(width>760)assert(Math.abs(image.ratio-1)<.02);else assert(image.ratio>1,'featured mobile artwork retains its wide cover');assert.equal(image.fit,'cover');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(directory,`discover-${width}.png`)});layouts.push({width,...measurement});
  }
  await updates.getByRole('button',{name:'关注的最近更新栏目操作',exact:true}).click();await page.getByRole('dialog',{name:'关注的最近更新栏目操作',exact:true}).getByRole('button',{name:'封面浏览',exact:true}).click();assert.equal(await updates.locator('.music-card').count(),4);await updates.getByRole('button',{name:'展开更多 · 还有 8 首',exact:true}).click();assert.equal(await updates.locator('.music-card').count(),12);assert.equal(await updates.locator('time').count(),12);
  await navigate(page,'关注');await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.locator('.follows-page .music-card').last().waitFor();assert.equal(await page.locator('.follows-page .music-card').count(),30,'follow page is not capped to 12');
  await page.getByRole('button',{name:'关注页面操作',exact:true}).click();const followMenu=page.getByRole('dialog',{name:'关注页面操作',exact:true});assert.equal(await followMenu.getByRole('button',{name:'封面浏览',exact:true}).getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');
  assert.equal(await page.locator('.follows-page time').count(),30);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(directory,'follow-covers-320.png')});
  await page.getByRole('button',{name:'关注页面操作',exact:true}).click();await followMenu.getByRole('button',{name:'歌曲列表',exact:true}).click();await page.locator('.follows-page .track-row').last().waitFor();assert.equal(await page.locator('.follows-page .track-row').count(),30);
  await navigate(page,'发现');await updates.locator('.track-row').last().waitFor();assert.equal(await updates.locator('.track-row').count(),4,'the mobile shelf shares the list preference while retaining its compact preview');
  await updates.getByRole('button',{name:'关注的最近更新栏目操作',exact:true}).click();await page.getByRole('dialog',{name:'关注的最近更新栏目操作',exact:true}).getByRole('button',{name:'封面浏览',exact:true}).click();assert.equal(await updates.locator('.music-card').count(),4);
  await updates.getByRole('button',{name:'关注的最近更新栏目操作',exact:true}).click();await page.getByRole('dialog',{name:'关注的最近更新栏目操作',exact:true}).getByRole('button',{name:'歌曲列表',exact:true}).click();
  await page.reload();await updates.locator('.track-row').last().waitFor();assert.equal(await updates.locator('.track-row').count(),4,'mobile list preference restores with a compact preview');
  assert.equal(surfaces.at(-1),null,'mobile keeps its existing recommendation request');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'打开播放队列',exact:true}).click();
  assert(await page.locator('.queue-panel').isVisible(),'the queue opens explicitly');
  await page.locator('.queue-panel').getByRole('button',{name:'关闭播放队列',exact:true}).click();
  const withoutQueue=await bili.locator('.cover-grid').evaluate(el=>({width:el.clientWidth,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length}));
  assert.equal(withoutQueue.columns,4,'wide shelves retain four columns when the queue is closed');
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(directory,'discover-dark-1440-no-queue.png')});
  layouts.push({width:1440,queue:false,theme:'dark',...withoutQueue});
  // Polling the startup fallback must never abort a user's slow explicit next batch.
  startupUpdating=true;manualDelay=3500;await page.reload();await youtube.getByRole('button',{name:'YouTube 推荐：正在更新，查看详情',exact:true}).waitFor();
  assert.equal(surfaces.at(-1),'desktop');
  const bBefore=requests.length,yBefore=youtubeRequests.length;
  await bili.getByRole('button',{name:'B站推荐换一批',exact:true}).click();await youtube.getByRole('button',{name:'YouTube 推荐换一批',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-shelf-kind="recommendation"] .shelf-refresh')].every(button=>!button.disabled));
  assert.deepEqual(requests.slice(bBefore),['1']);assert.deepEqual(youtubeRequests.slice(yBefore),['1']);
  assert.deepEqual(errors,[]);writeFileSync(join(directory,'layout-report.json'),JSON.stringify({layouts,requests,errors},null,2)+'\n');
});
