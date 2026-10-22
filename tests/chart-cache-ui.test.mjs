import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright-core';

test('chart browsing reuses daily/weekly caches across navigation, editions and reloads, then refreshes on expiry',async t=>{
  const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),day=86400000,calls=[],errors=[];
  let now=Date.parse('2026-10-13T12:00:00+08:00'),failure=false,delay=0,latest=439;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),json=(value,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status')return json({version:'fixture',providers:{bilibili:{available:true},youtube:{available:true}},build:{stale:false}});
    if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:['bilibili','youtube'].map(provider=>({provider,operations:['metadata','search','list','prepare'],anonymous:true,limitations:[]}))});
    if(url.pathname==='/api/song-library')return json({revision:'1',snapshot:{format:'slowtune-library',version:1,songs:[],versions:[],catalogLinks:[],redirects:[],playlists:[],favorites:[]}});
    if(url.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(url.pathname==='/api/follows')return json({revision:'1',creators:[]});
    if(url.pathname==='/api/follows/feed')return json({items:[],total:0,warnings:[],fetchedAt:now});
    if(url.pathname==='/api/discovery/bilibili')return json([]);
    if(url.pathname==='/api/youtube/music')return json({region:'HK',shelf:{id:'youtube-music-selection',kind:'recommendation',title:'YouTube 推荐',page:{items:[]}},warnings:[],playlists:[],fetchedAt:now});
    if(url.pathname==='/api/charts'){
      const source=url.searchParams.get('source'),chart=url.searchParams.get('chart'),selected=url.searchParams.get('period');calls.push({source,chart,selected});
      const periods=[{id:latest,number:latest===439?226:227,publishedAt:now-day},{id:437,number:225,publishedAt:now-8*day}],period=selected&&selected!=='latest'?periods.find(p=>p.id===Number(selected)):periods[0];
      const value={source,chart,title:source+'榜单',items:[{rank:1,title:source+' '+chart+' '+(period?.id??'')+' 请求'+calls.length}],fetchedAt:now,refreshAfter:now+(source==='bilibili'?7:1)*day,updateFrequency:source==='bilibili'?'weekly':'daily',sourceUrl:'https://example.com',...(source==='bilibili'?{period,periods}:{})};
      const fail=failure;await new Promise(resolve=>setTimeout(resolve,delay));return fail?json({error:{code:'network'}},503):json(value);
    }
    try{const file=join(root,'dist/client',url.pathname==='/'?'index.html':url.pathname);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  const base='http://127.0.0.1:'+server.address().port,nav=async name=>page.locator('nav:visible').getByRole('button',{name,exact:true}).click();
  const tab=async(name,source)=>{await page.getByRole('tab',{name,exact:true}).click();await page.getByRole('tabpanel',{name:source+'榜单',exact:true}).waitFor();};
  const idle=async()=>{
    // A restored chart can appear before React's effect starts its expired-cache request.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>!document.querySelector('.charts-page .loading'));
  };
  await page.goto(base);await nav('音乐榜单');await page.locator('.chart-song').waitFor();await idle();assert.equal(calls.length,1);
  const first=await page.locator('.chart-song-title').textContent();
  await nav('发现');await nav('音乐榜单');await page.locator('.chart-song').waitFor();await idle();assert.equal(calls.length,1);assert.equal(await page.locator('.chart-song-title').textContent(),first);
  await page.getByLabel('网易云榜单').selectOption('new');await idle();assert.equal(calls.length,2);
  await page.getByLabel('网易云榜单').selectOption('hot');await idle();assert.equal(calls.length,2);
  await tab('QQ','qq');await idle();await tab('网易云','netease');await idle();assert.equal(calls.length,3);
  await tab('B站','bilibili');await idle();const editions=page.getByLabel('B站热歌榜期次');assert.equal(calls.length,4);
  await editions.selectOption('439');await idle();assert.equal(calls.length,4);
  await editions.selectOption('437');await idle();assert.equal(calls.length,5);
  await editions.selectOption('latest');await idle();assert.equal(calls.length,5);assert.match(await page.locator('.chart-song-title').textContent(),/439/);
  await editions.selectOption('437');await idle();assert.equal(calls.length,5);assert.match(await page.locator('.chart-song-title').textContent(),/437/);
  await page.reload();await nav('音乐榜单');await page.locator('.chart-song').waitFor();await idle();assert.equal(calls.length,5);
  await nav('发现');now+=day;await page.clock.setFixedTime(new Date(now));await nav('音乐榜单');await idle();assert.equal(calls.length,6);assert.notEqual(await page.locator('.chart-song-title').textContent(),first);
  await tab('B站','bilibili');await idle();assert.equal(calls.length,6);
  // A historical-edition response carrying a newly published catalogue invalidates the old latest alias.
  now+=7*day;latest=441;await page.clock.setFixedTime(new Date(now));await editions.selectOption('437');await idle();assert.equal(calls.length,7);
  await editions.selectOption('latest');await idle();assert.equal(calls.length,8);assert.match(await page.locator('.chart-song-title').textContent(),/441/);
  const expiredNetease=page.waitForResponse(response=>response.url().includes('/api/charts?source=netease&chart=hot'));
  await tab('网易云','netease');await expiredNetease;await idle();assert.equal(calls.length,9);const retained=await page.locator('.chart-song-title').textContent();
  await nav('发现');now+=day;await page.clock.setFixedTime(new Date(now));failure=true;await nav('音乐榜单');await page.getByRole('alert').waitFor();assert.equal(await page.locator('.chart-song-title').textContent(),retained);
  failure=false;await page.getByRole('button',{name:'重试榜单',exact:true}).click();await idle();assert.equal(await page.getByRole('alert').count(),0);
  // Switching to a valid cache cancels an expired request; its late response must not win.
  delay=200;await page.getByLabel('网易云榜单').selectOption('new');await page.locator('.charts-page .loading').waitFor();
  await page.getByLabel('网易云榜单').selectOption('hot');await idle();const hot=await page.locator('.chart-song-title').textContent();await page.waitForTimeout(250);assert.equal(await page.locator('.chart-song-title').textContent(),hot);
  assert.deepEqual(errors,[]);
});
