import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { DEFAULT_CONFIG } from '@studio/recommendation';
const build=resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.');
test('follow UI: song entry, creator collections, recent updates, retry and responsive navigation',async t=>{
  const bili={provider:'bilibili',id:'101',name:'测试 UP',url:'https://space.bilibili.com/101',artwork:'http://i0.hdslb.com/bfs/face/up-avatar.jpg',followedAt:1};
  const youtube={provider:'youtube',id:'UCcvLSRIWJIAGFDyWtzkbiHA',name:'测试博主',url:'https://www.youtube.com/channel/UCcvLSRIWJIAGFDyWtzkbiHA',artwork:'http://yt3.googleusercontent.com/blogger-avatar.jpg',followedAt:2};
  let accountAvatar='http://i0.hdslb.com/bfs/face/account-avatar.jpg';
  const song=(provider,id,title,author,date,part)=>({ref:{provider,kind:'video',id,...(part?{part}:{})},resourceId:provider+':video:'+id+(part?':'+part:''),title,url:provider==='bilibili'?'https://www.bilibili.com/video/'+id:'https://www.youtube.com/watch?v='+id,uploader:{id:author.id,name:author.name},publishedAt:date});
  const first={...song('bilibili','BV1234567890','合集里的音乐',bili,Date.parse('2026-10-11T12:00:00Z'),'900'),artists:['演唱者']};
  const second=song('youtube','abcdefghijk','博主最新发布',youtube,Date.parse('2026-10-12T12:00:00Z'));
  const unknown=song('bilibili','BV0987654321','时间未知的内容',bili,undefined,'901');
  let state={revision:'r0',creators:[]},revision=0,feedFailure=false,writeFailure=false,creatorFailure=false,creatorDelay=0;
  let rejectListProfileRefresh=false,profileGate,pendingProfileReads=0,feedPagination=false,feedDelay=0;
  const listProfileReads=[],profileReads=[],feedReads=[];
  const readBody=async request=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString());};
  const server=createServer(async(request,response)=>{
    response.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const url=new URL(request.url,'http://localhost'),json=(value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status')return json({version:'fixture',node:process.version,providers:{bilibili:{available:true},youtube:{available:true}},delivery:{leases:0,activeReads:0},tool:{active:0}});
    if(url.pathname==='/api/song-library')return json({revision:'l0',snapshot:{format:'slowtune-library',version:1,songs:[],versions:[],catalogLinks:[],redirects:[],playlists:[],favorites:[]}});
    if(url.pathname==='/api/bilibili/account')return json({state:'authenticated',account:{provider:'bilibili',id:'200',name:'我的测试账号',artwork:accountAvatar}});
    if(url.pathname==='/api/discovery/bilibili')return json([{id:'music-recommendation',title:'音乐推荐',kind:'recommendation',page:{items:[{...first,uploader:{name:bili.name}}]}}]);
    if(url.pathname==='/api/bilibili/chart')return json({shelf:{id:'hot-chart',title:'热歌榜',kind:'chart',page:{items:[]}},periods:[{id:1,number:1,publishedAt:1}],period:{id:1,number:1,publishedAt:1},sourceUrl:'https://music.bilibili.com',fetchedAt:1});
    if(url.pathname==='/api/youtube/music')return json({region:'HK',shelf:{id:'youtube-music-selection',title:'YouTube 音乐精选',kind:'recommendation',page:{items:[]}},sourceUrl:'https://www.youtube.com',fetchedAt:1,catalogueUpdatedAt:1,playlists:[],warnings:[]});
    if(url.pathname==='/api/recommendation/settings')return json({entry:1,epoch:0,legacyRevision:'legacy-0',sharedRevision:'shared-0',legacy:{include:[],exclude:[],mode:'any',order:'upstream'},document:{schema:1,revision:'shared-0',preset:{id:'fixture',revision:'music-v1',config:DEFAULT_CONFIG},overrides:{}},origins:{}});
    if(url.pathname.startsWith('/api/recommendation/'))return json({accepted:true});
    if(url.pathname==='/api/creators/resolve'){
      const body=await readBody(request);await new Promise(resolve=>setTimeout(resolve,creatorDelay));
      if(response.destroyed)return;if(creatorFailure)return json({error:{code:'network'}},503);
      return json(body.ref.provider==='youtube'?youtube:bili);
    }
    if(url.pathname==='/api/creators/profile'){
      profileReads.push(Object.fromEntries(url.searchParams));pendingProfileReads++;await profileGate;pendingProfileReads--;
      if(response.destroyed)return;return json(url.searchParams.get('provider')==='youtube'?youtube:bili);
    }
    if(url.pathname==='/api/follows'){
      if(request.method==='GET'){
        if(url.searchParams.get('profiles')==='1'){
          listProfileReads.push(Object.fromEntries(url.searchParams));
          if(rejectListProfileRefresh&&url.searchParams.get('refresh')==='1')return json({error:{code:'timeout'}},503);
          state.creators=state.creators.map(c=>({...c,artwork:(c.provider==='bilibili'?bili:youtube).artwork.replace('http:','https:')}));
        }
        return json(state);
      }
      const body=await readBody(request);if(writeFailure)return json({error:{code:'storage'}},503);
      if(body.revision!==state.revision)return json({error:{code:'conflict'}},409);
      const ref=body.creator ?? (body.ref?bili:youtube),creator=ref.provider==='bilibili'?bili:youtube;
      if(body.action==='follow'&&!state.creators.some(c=>c.provider===creator.provider&&c.id===creator.id))state.creators.push(creator);
      if(body.action==='unfollow')state.creators=state.creators.filter(c=>c.provider!==creator.provider||c.id!==creator.id);
      state={...state,revision:'r'+(++revision)};return json({...state,creator});
    }
    if(url.pathname==='/api/follows/cancel')return json({ok:true});
    if(url.pathname==='/api/follows/collections'){
      const creator=url.searchParams.get('provider')==='bilibili'?bili:youtube;
      return json({items:[{id:creator.provider==='bilibili'?'season:101:1':'PLfixture_12345',kind:creator.provider==='bilibili'?'season':'playlist',title:creator.name+' 的合集',url:creator.url,count:2,...(creator.provider==='youtube'?{ref:{provider:'youtube',kind:'playlist',id:'PLfixture_12345'}}:{})}]});
    }
    if(url.pathname==='/api/follows/collection')return json({items:[first,unknown]});
    if(url.pathname==='/api/follows/videos')return json({items:[url.searchParams.get('provider')==='youtube'?second:first]});
    if(url.pathname==='/api/follows/feed'){
      const current=state,cursor=url.searchParams.get('snapshot')??url.searchParams.get('cursor');feedReads.push({revision:current.revision,cursor});
      await new Promise(resolve=>setTimeout(resolve,feedDelay));if(response.destroyed)return;
      if(feedFailure)return json({error:{code:'network'}},503);
      if(cursor&&cursor!=='feed-'+current.revision)return json({error:{code:'stale-cursor'}},503);
      const items=[second,first,unknown].filter(item=>current.creators.some(c=>c.id===item.uploader.id)&&(!url.searchParams.get('provider')||item.ref.provider===url.searchParams.get('provider')));
      const pageSize=Number(url.searchParams.get('pageSize')??30),page=Number(url.searchParams.get('page')??1);
      return json({items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,fetchedAt:1,warnings:[],snapshot:'feed-'+current.revision,page,pageSize});
    }
    if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','discover','search','prepare'],limitations:[],anonymous:true},{provider:'youtube',operations:['metadata','list','prepare'],limitations:[],anonymous:true}]});
    if(url.pathname==='/v1/call/metadata')return json({protocol:2,result:{...first,parts:[first]}});
    if(url.pathname==='/v1/call/list')return json({protocol:2,result:{items:[second]}});
    if(url.pathname.startsWith('/v1/'))return json({protocol:2,error:{code:'unsupported',retryable:false}},400);
    try{const path=join(build,'dist/client',url.pathname==='/'?'index.html':url.pathname);response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)] ?? 'application/octet-stream');response.end(readFileSync(path));}catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
  const avatarRequests=[];await page.route(/https:\/\/(?:i0\.hdslb\.com|yt3\.googleusercontent\.com)\//,route=>{avatarRequests.push(route.request().url());return route.request().url().includes('unavailable')?route.abort():route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const nav=name=>page.locator('nav:visible').getByRole('button',{name,exact:true}).click();
  await t.test('own account avatar loads over HTTPS under the production CSP and failed images have a placeholder',async()=>{
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'B站账号',exact:true}).click();
    await page.waitForFunction(()=>{const img=document.querySelector('.account-avatar');return img?.tagName==='IMG'&&img.complete&&img.naturalWidth>0;});assert.equal(await page.getByAltText('我的测试账号的头像').getAttribute('src'),'https://i0.hdslb.com/bfs/face/account-avatar.jpg');
    accountAvatar='http://i0.hdslb.com/bfs/face/unavailable.jpg';await page.getByRole('button',{name:'检查账号状态',exact:true}).click();await page.getByLabel('我的测试账号的头像暂不可用',{exact:true}).waitFor();assert.equal(await page.locator('.platform-profile img').count(),0);
    accountAvatar='http://i0.hdslb.com/bfs/face/account-avatar.jpg';await page.getByRole('button',{name:'检查账号状态',exact:true}).click();await page.getByAltText('我的测试账号的头像').waitFor();await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
  });
  await t.test('clicking an uploader previews an unfollowed author and follows from their page',async()=>{
    await page.locator('.music-card .creator-artists').getByText('演唱者',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'演唱者',exact:true}).count(),0,'performers are not treated as the uploader');
    await page.getByRole('button',{name:'查看 UP / 博主 · 合集里的音乐',exact:true}).click();
    await page.getByRole('button',{name:'打开合集 测试 UP 的合集',exact:true}).waitFor();assert.equal(state.creators.length,0);
    await page.waitForFunction(()=>{const img=document.querySelector('.follow-author-heading img.follow-avatar');return img?.complete&&img.naturalWidth>0;});assert.equal(await page.getByAltText('测试 UP的头像').getAttribute('src'),'https://i0.hdslb.com/bfs/face/up-avatar.jpg');
    await page.getByRole('button',{name:'关注作者',exact:true}).click();await page.getByRole('button',{name:'取消关注',exact:true}).waitFor();assert.equal(state.creators.length,1);
    await page.getByRole('button',{name:'打开合集 测试 UP 的合集',exact:true}).click();await page.getByTitle('合集里的音乐',{exact:true}).waitFor();
    await page.getByRole('button',{name:'取消关注',exact:true}).click();await page.getByRole('button',{name:'关注作者',exact:true}).waitFor();assert.equal(state.creators.length,0);
    assert.equal(await page.locator('.follows-page .track-row').count(),2,'unfollow keeps the public author contents open');
    await nav('关注');await page.getByText('关注喜欢的 UP 和博主',{exact:true}).waitFor();
    await nav('发现');creatorFailure=true;await page.getByRole('button',{name:'查看 UP / 博主 · 合集里的音乐',exact:true}).click();await page.getByText(/网络或服务连接中断/).waitFor();assert.equal(state.creators.length,0);
    creatorFailure=false;await page.getByRole('button',{name:'关闭提示',exact:true}).click();
    creatorDelay=400;await page.getByRole('button',{name:'查看 UP / 博主 · 合集里的音乐',exact:true}).click();await nav('歌单');await new Promise(resolve=>setTimeout(resolve,450));assert.equal(await page.locator('h1').textContent(),'我的歌单');creatorDelay=0;
    await nav('发现');await page.getByRole('button',{name:'更多操作 合集里的音乐',exact:true}).first().click();
    creatorDelay=400;await page.getByRole('button',{name:'查看 UP / 博主',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(await page.locator('h1').textContent(),'发现音乐');creatorDelay=0;
  });
  await t.test('empty follow area and following a real song author',async()=>{
    await nav('关注');await page.getByText('关注喜欢的 UP 和博主',{exact:true}).waitFor();
    await nav('发现');await page.getByRole('button',{name:'更多操作 合集里的音乐',exact:true}).first().click();
    await page.getByRole('button',{name:'关注 测试 UP',exact:true}).click();
    await page.getByRole('button',{name:'取消关注 测试 UP',exact:true}).waitFor();
    assert.equal(state.creators.length,1);await page.getByRole('button',{name:'关闭',exact:true}).click();
    const before={revision:state.revision,followedAt:state.creators[0].followedAt};state.creators=state.creators.map(({artwork,...rest})=>rest);
    await nav('关注');await page.getByRole('button',{name:'查看 测试 UP 的合集',exact:true}).waitFor();
    await page.getByAltText('测试 UP的头像').waitFor();assert.equal(state.revision,before.revision);assert.equal(state.creators[0].followedAt,before.followedAt,'backfill keeps the original follow record');
    await page.reload();await nav('发现');await page.getByRole('button',{name:'更多操作 合集里的音乐',exact:true}).first().click();
    await page.getByRole('button',{name:'取消关注 测试 UP',exact:true}).waitFor();assert.equal(state.creators.length,1,'missing cached author IDs resolve without adding another follow');
    await page.getByRole('button',{name:'关闭',exact:true}).click();await nav('关注');
  });
  await t.test('creator to collection to videos and return navigation',async()=>{
    await page.getByRole('button',{name:'查看 测试 UP 的合集',exact:true}).click();
    await page.getByRole('button',{name:'打开合集 测试 UP 的合集',exact:true}).click();
    await page.getByTitle('合集里的音乐',{exact:true}).waitFor();assert.equal(await page.locator('.follows-page .track-row').count(),2);
    await page.getByRole('button',{name:'返回作者合集',exact:true}).click();
    await page.getByRole('button',{name:'全部投稿',exact:true}).click();await page.locator('.row-update').waitFor();
    await page.getByRole('button',{name:'返回关注',exact:true}).click();
  });
  await t.test('author refresh reads only the current profile and content does not wait for its avatar',async()=>{
    await page.getByRole('button',{name:'查看 测试 UP 的合集',exact:true}).click();
    await page.getByRole('button',{name:'打开合集 测试 UP 的合集',exact:true}).waitFor();
    const listsBefore=listProfileReads.length,profilesBefore=profileReads.length;
    let releaseProfile;profileGate=new Promise(resolve=>releaseProfile=resolve);rejectListProfileRefresh=true;
    try{
      const content=page.waitForResponse(response=>response.url().includes('/api/follows/collections?'),{timeout:3000});
      await page.getByRole('button',{name:'刷新',exact:true}).click();await content;
      await page.waitForFunction(()=>!document.querySelector('.follows-page .loading'));
      assert.equal(listProfileReads.length,listsBefore,'author refresh never reads full-list profiles');
      assert.deepEqual(profileReads.slice(profilesBefore),[{provider:'bilibili',id:'101',refresh:'1'}]);
      assert(pendingProfileReads>0,'content finishes while the current avatar is still loading');
      assert.equal(await page.locator('.follows-page [role="alert"]').count(),0);
    }finally{rejectListProfileRefresh=false;releaseProfile();profileGate=undefined;}
    await page.getByRole('button',{name:'返回关注',exact:true}).click();
  });
  await t.test('adding a blogger preserves failed edits and recent updates display source dates',async()=>{
    await page.getByRole('button',{name:'添加关注',exact:true}).click();
    await page.getByRole('textbox',{name:'作者主页链接 / B站 UID'}).fill('https://www.youtube.com/@test');
    writeFailure=true;await page.getByRole('button',{name:'关注作者',exact:true}).click();await page.getByText(/资料保存失败/).waitFor();assert.equal(state.creators.length,1);
    assert.equal(await page.getByRole('textbox',{name:'作者主页链接 / B站 UID'}).inputValue(),'https://www.youtube.com/@test');
    writeFailure=false;await page.getByRole('button',{name:'关注作者',exact:true}).click();await page.getByRole('button',{name:'查看 测试博主 的合集',exact:true}).waitFor();
    await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.getByTitle('博主最新发布',{exact:true}).waitFor();
    assert.deepEqual(await page.locator('.follows-page .track-name').allTextContents(),['博主最新发布','合集里的音乐','时间未知的内容']);
    assert.match(await page.locator('.row-update').first().textContent(),/2026\/10\/12 20:00/);assert.equal(await page.locator('.row-update').last().textContent(),'发布时间未知');
    await page.locator('.source-tabs').getByRole('button',{name:'B站',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.follows-page .track-row').length===2);
    assert(!await page.getByTitle('博主最新发布',{exact:true}).count());
    await page.locator('.source-tabs').getByRole('button',{name:'全部',exact:true}).click();await page.getByTitle('博主最新发布',{exact:true}).waitFor();
    feedFailure=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByText(/网络或服务连接中断/).waitFor();assert.equal(await page.locator('.follows-page .track-row').count(),3);
    feedFailure=false;await page.getByRole('button',{name:'重新获取更新',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.follows-page [role="alert"]'));
  });
  await t.test('song-menu unfollow removes updates, replaces the pagination snapshot and refollow reloads it',async()=>{
    feedPagination=true;
    await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('textbox',{name:'最近更新页码',exact:true}).waitFor();
    const readsBefore=feedReads.length;feedDelay=400;
    await page.getByRole('button',{name:'更多操作 合集里的音乐',exact:true}).first().click();
    await page.getByRole('button',{name:'取消关注 测试 UP',exact:true}).click();
    await page.getByRole('button',{name:'关注 测试 UP',exact:true}).waitFor();
    assert.equal(await page.locator('.follows-page').getByTitle('合集里的音乐',{exact:true}).count(),0);
    assert.equal(await page.getByRole('textbox',{name:'最近更新页码',exact:true}).count(),0,'old pagination is removed before the new feed arrives');
    await page.waitForFunction(()=>document.querySelectorAll('.follows-page .track-row').length===1);
    assert.equal(await page.locator('.follows-page .track-name').textContent(),'博主最新发布');
    assert(feedReads.slice(readsBefore).some(read=>read.revision===state.revision&&!read.cursor),'membership change reads a new first page');
    await page.getByRole('button',{name:'关注 测试 UP',exact:true}).click();
    await page.getByRole('button',{name:'取消关注 测试 UP',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.follows-page .track-row').length===3);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    assert(await page.getByRole('button',{name:'最近更新下一页',exact:true}).isDisabled());
    await page.waitForFunction(()=>!document.querySelector('.follows-page .loading'));
    assert.equal(await page.locator('.follows-page [role="alert"]').count(),0);
    assert.equal(await page.locator('.follows-page .track-row').count(),3);
    feedDelay=0;feedPagination=false;
  });
  await t.test('YouTube playlists use existing video list actions',async()=>{
    await page.getByRole('button',{name:'关注的 UP',exact:true}).click();await page.getByRole('button',{name:'查看 测试博主 的合集',exact:true}).click();
    await page.getByRole('button',{name:'打开合集 测试博主 的合集',exact:true}).click();await page.getByTitle('博主最新发布',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回作者合集',exact:true}).click();await page.getByRole('button',{name:'返回关注',exact:true}).click();
  });
  await t.test('desktop and 320px mobile show both tabs and five navigation entries without overflow',async()=>{
    const directory=resolve('local/verification/follows/screenshots');mkdirSync(directory,{recursive:true});
    await page.screenshot({path:join(directory,'desktop-authors.png'),fullPage:true});
    await page.setViewportSize({width:320,height:800});assert.equal(await page.locator('.mobile-nav button').count(),5);
    assert(await page.locator('.mobile-nav').getByRole('button',{name:'关注',exact:true}).isVisible());
    await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.getByTitle('博主最新发布',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile content does not overflow horizontally');
    await page.screenshot({path:join(directory,'mobile-updates.png'),fullPage:true});
    await page.getByRole('button',{name:'查看 UP / 博主 · 博主最新发布',exact:true}).click();await page.getByRole('button',{name:'打开合集 测试博主 的合集',exact:true}).waitFor();assert.equal(state.creators.length,2);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(directory,'mobile-author-preview.png'),fullPage:true});await nav('关注');
    await page.getByRole('button',{name:'关注的 UP',exact:true}).click();await page.getByRole('button',{name:'取消关注 测试 UP',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.follow-creator-card').length===1);
    await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.follows-page .track-row').length===1);
    assert.equal(await page.locator('.follows-page .track-name').textContent(),'博主最新发布');assert.deepEqual(errors,[]);assert(avatarRequests.some(url=>url.includes('account-avatar')));assert(avatarRequests.some(url=>url.includes('up-avatar')));assert(avatarRequests.some(url=>url.includes('blogger-avatar')));
  });
});
