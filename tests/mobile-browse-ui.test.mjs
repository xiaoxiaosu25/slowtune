import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';
import { navigate, selectPlaylist, libraryAction } from '../scripts/browser-ui.mjs';

const artifacts=join(developmentPaths().artifacts,'mobile-browse');

test('mobile empty queue opens an interactive search page without retaining the drawer', {timeout:60000},async t=>{
  const fixture=await createMobileFixture(),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  for(const width of [320,390]){
    const context=await browser.newContext({viewport:{width,height:844},hasTouch:true});
    await context.route('https://i1.hdslb.com/fixture-artwork.png',route=>route.fulfill({contentType:'image/png',body:readFileSync(resolve('public/assets/coast.png'))}));
    const page=await context.newPage();page.setDefaultTimeout(8000);
    await page.goto(fixture.base);
    await page.getByRole('button',{name:'打开播放队列',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'播放队列',exact:true});
    await drawer.getByRole('button',{name:'去搜索音乐',exact:true}).click();
    await drawer.waitFor({state:'detached'});
    const search=page.getByRole('main',{name:'搜索音乐',exact:true});
    await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('风从远方来');
    await search.getByRole('button',{name:'搜索',exact:true}).click();
    await search.getByRole('button',{name:'播放 风从远方来',exact:true}).waitFor();
    assert.equal(await page.locator('dialog[open]').count(),0,'search has no modal blocking its controls');
    await page.goBack();
    await page.getByRole('navigation',{name:'手机导航',exact:true}).waitFor();
    assert.equal(await drawer.count(),0,'Back does not reopen the replaced queue');
    await page.goForward();
    await search.waitFor();
    assert.equal(await drawer.count(),0,'Forward restores an interactive search without the queue');
    await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('晚风');
    await context.close();
  }
});

test('mobile discovery, library details and search keep navigation context and one player', {timeout:120000},async t=>{
  const fixture=await createMobileFixture({preview:true,discovery:true}),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,colorScheme:'light'});
  await context.route('https://i1.hdslb.com/fixture-artwork.png',route=>route.fulfill({contentType:'image/png',body:readFileSync(resolve('public/assets/coast.png'))}));
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  mkdirSync(artifacts,{recursive:true});await page.goto(fixture.base);
  const nav=page.getByRole('navigation',{name:'手机导航',exact:true}),shelf=page.locator('[data-shelf-id="account-recommendation"]');
  await shelf.locator('.music-card').last().waitFor();
  assert((await shelf.locator('.cover-button').first().boundingBox()).y<240,'music comes before desktop tools');
  assert.equal(await shelf.locator('.catalog-display-controls,.catalog-meta,.catalog-empty-slot').count(),0);
  assert(await shelf.locator('.mobile-shelf-covers').evaluate(e=>e.scrollWidth>e.clientWidth),'recommendations scroll inside their own shelf');
  await shelf.getByRole('button',{name:'为你推荐 · B站账号栏目操作',exact:true}).click();
  const actions=page.getByRole('dialog',{name:'为你推荐 · B站账号栏目操作',exact:true});
  await actions.getByRole('button',{name:'换一批音乐',exact:true}).waitFor();await actions.getByRole('button',{name:'歌曲列表',exact:true}).click();
  assert.equal(await shelf.locator('.track-row').count(),4);
  await shelf.getByRole('button',{name:'查看全部 12 首',exact:true}).click();assert.equal(await shelf.locator('.track-row').count(),12);
  await shelf.getByRole('button',{name:'收起列表',exact:true}).click();
  await shelf.getByRole('button',{name:'为你推荐 · B站账号栏目操作',exact:true}).click();await actions.getByRole('button',{name:'封面浏览',exact:true}).click();
  await page.setViewportSize({width:1280,height:800});
  await shelf.getByRole('button',{name:'为你推荐 · B站账号列表视图',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await shelf.locator('.mobile-shelf-covers').waitFor();
  assert.equal(await shelf.locator('.music-card').count(),12,'mobile cover browsing keeps its own preference across the desktop breakpoint');
  await page.screenshot({path:join(artifacts,'discovery-390.png')});
  await nav.getByRole('button',{name:'音乐库',exact:true}).click();
  const library=page.getByRole('region',{name:'音乐库',exact:true});await library.getByRole('button',{name:'我的收藏 2 首歌曲',exact:true}).waitFor();
  await library.getByRole('button',{name:'晚风与散步 2 首歌曲',exact:true}).waitFor();
  const playlists=library.getByRole('group',{name:'我的歌单 2',exact:true});
  assert.equal(await playlists.getByRole('button').count(),2,'favorites belong to the same playlist group');
  const favoriteRow=await playlists.getByRole('button',{name:'我的收藏 2 首歌曲',exact:true}).boundingBox();
  const playlistRow=await playlists.getByRole('button',{name:'晚风与散步 2 首歌曲',exact:true}).boundingBox();
  assert(Math.abs(favoriteRow.height-playlistRow.height)<2,'favorites and custom playlists have the same row height');
  assert(Math.abs(playlistRow.y-(favoriteRow.y+favoriteRow.height))<2,'no separate pinned favorites section');
  assert.equal(await page.locator('.song-library-page').count(),0,'the overview is separate from playlist details');
  await page.screenshot({path:join(artifacts,'library-390.png')});
  await library.getByRole('button',{name:'晚风与散步 2 首歌曲',exact:true}).click();
  await page.getByRole('heading',{name:'晚风与散步',exact:true}).waitFor();
  await page.locator('.song-library-page').getByRole('button',{name:'播放 风从远方来',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1&&!document.querySelector('audio').paused);
  const audio=await page.locator('audio').elementHandle(),prepared=fixture.preparations.length;
  await page.getByRole('button',{name:'搜索歌曲或视频',exact:true}).click();
  const search=page.getByRole('main',{name:'搜索音乐',exact:true});await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('晚风');await search.getByRole('button',{name:'搜索',exact:true}).click();
  await search.getByRole('button',{name:'播放 风从远方来',exact:true}).waitFor();
  assert.equal(await page.locator('.search-modal,.search-playing').count(),0);
  assert.equal(await page.locator('.mobile-mini-player').count(),1);assert.equal(await nav.count(),0);
  assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.getByRole('button',{name:'打开播放队列',exact:true}).click();await page.getByRole('dialog',{name:'播放队列',exact:true}).waitFor();await page.goBack();
  await page.getByRole('dialog',{name:'播放队列',exact:true}).waitFor({state:'detached'});assert.equal(await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).inputValue(),'晚风');
  await page.screenshot({path:join(artifacts,'search-390.png')});
  await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.locator('.mobile-player').waitFor();
  await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();await search.waitFor();
  assert.equal(await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).evaluate(e=>e===document.activeElement),false,'returning to results does not request the soft keyboard again');
  assert.equal(await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).inputValue(),'晚风');assert.equal(fixture.preparations.length,prepared);
  await page.setViewportSize({width:1280,height:800});
  const desktopSearch=page.getByRole('dialog',{name:'搜索音乐',exact:true});await desktopSearch.waitFor();
  assert.equal(await desktopSearch.getByLabel('弹窗搜索关键词',{exact:true}).inputValue(),'晚风');
  assert.equal(await page.locator('.song-library-page h1').textContent(),'晚风与散步','desktop search keeps the original playlist underneath');
  await page.setViewportSize({width:390,height:844});await search.waitFor();
  assert.equal(await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).inputValue(),'晚风');
  await page.goBack();await page.getByRole('heading',{name:'晚风与散步',exact:true}).waitFor();
  await page.goForward();await search.waitFor();assert.equal(await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).inputValue(),'晚风');
  await search.getByRole('button',{name:'关闭搜索',exact:true}).click();await search.waitFor({state:'detached'});
  await page.reload();await page.getByRole('heading',{name:'晚风与散步',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回音乐库',exact:true}).click();await library.waitFor();
  await library.getByRole('button',{name:'新建歌单',exact:true}).click();const create=page.getByRole('dialog',{name:'新建歌单',exact:true});
  await create.getByLabel('歌单名称').fill('手机新歌单');await create.getByRole('button',{name:'保存歌单',exact:true}).click();await create.waitFor({state:'detached'});
  await library.getByRole('button',{name:'手机新歌单 0 首歌曲',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
});

test('playlist rename drafts survive both layout transitions', {timeout:60000},async t=>{
  const fixture=await createMobileFixture(),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(8000);
  await page.goto(fixture.base);await navigate(page,'歌单');await selectPlaylist(page,'晚风与散步');
  const filter=page.getByRole('textbox',{name:'搜索歌单内音乐',exact:true});await filter.fill('风');
  await libraryAction(page,'歌单改名');
  const dialog=page.getByRole('dialog',{name:'歌单改名',exact:true}),input=dialog.getByRole('textbox',{name:'歌单名称',exact:true});
  await input.fill('尚未保存的晚风歌单');
  const original=await dialog.elementHandle();
  for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
    await page.setViewportSize(viewport);
    await page.waitForFunction(mobile=>document.querySelector('.app')?.dataset.layout===(mobile?'mobile':'desktop')&&!!document.querySelector('.mobile-playlist-heading')===mobile,viewport.width<=760);
    assert(await original.evaluate(element=>element.isConnected&&element.open),'the open editor survives without remounting');
    assert.equal(await input.inputValue(),'尚未保存的晚风歌单');
    assert.equal(await page.locator('input[aria-label="搜索歌单内音乐"]').inputValue(),'风');
  }
  await dialog.getByRole('button',{name:'保存歌单',exact:true}).click();await dialog.waitFor({state:'detached'});
  await page.getByRole('heading',{name:'尚未保存的晚风歌单',exact:true}).waitFor();
});

test('mobile browse surfaces fit light and dark compact screens', {timeout:90000},async t=>{
  const fixture=await createMobileFixture({preview:true,discovery:true}),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(8000);await page.goto(fixture.base);
  const nav=page.getByRole('navigation',{name:'手机导航',exact:true});await nav.waitFor();
  for(const theme of ['light','dark'])for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:430,height:932}]){
    await page.setViewportSize(viewport);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const destination of ['发现','音乐库']){
      await nav.getByRole('button',{name:destination,exact:true}).click();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify({theme,viewport,destination}));
      if(destination==='发现'){
        const cover=await page.locator('[data-shelf-id="account-recommendation"] .cover-button').first().boundingBox();
        assert(cover.width>=120&&cover.width<=144,'mobile covers keep a compact browsing size');
        assert(Math.abs(cover.width-cover.height)<1,'compact artwork stays square');
      }
    }
    await page.locator('.mobile-library').getByRole('button').filter({hasText:'我的收藏'}).click();
    await page.getByRole('button',{name:'搜索歌曲或视频',exact:true}).click();
    const search=page.getByRole('main',{name:'搜索音乐',exact:true});await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('风');await search.getByRole('button',{name:'搜索',exact:true}).click();await search.locator('.track-row').first().waitFor();
    const geometry=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect();const results=box('.search-results'),mini=box('.mobile-mini-player'),input=document.querySelector('input[aria-label="搜索关键词"]');return {overflow:document.documentElement.scrollWidth>innerWidth,resultsBottom:results.bottom,miniTop:mini.top,miniBottom:mini.bottom,inputFont:getComputedStyle(input).fontSize};});
    assert.equal(geometry.overflow,false);assert(geometry.resultsBottom<=geometry.miniTop+1);assert(geometry.miniBottom<=viewport.height);assert.equal(geometry.inputFont,'16px');
    await search.getByRole('button',{name:'关闭搜索',exact:true}).click();
  }
});
