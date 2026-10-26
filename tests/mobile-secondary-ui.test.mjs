import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { createMobileSecondaryFixture } from './helpers/mobile-secondary-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const artifacts=join(developmentPaths().artifacts,'mobile-secondary');
async function setup(t,options) {
  const fixture=await createMobileSecondaryFixture(options),browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,colorScheme:'light'});
  page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.base);await page.locator('.mobile-nav').waitFor();mkdirSync(artifacts,{recursive:true});
  return {fixture,page,errors};
}
const discoverNav=page=>page.getByRole('navigation',{name:'发现栏目',exact:true});
const mobileNav=page=>page.getByRole('navigation',{name:'手机导航',exact:true});
const position=page=>page.evaluate(()=>scrollY);
const queue=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
const queueItems=record=>record.items.map(({instanceId,selection})=>({instanceId,selection:selection.kind==='source'?{kind:selection.kind,ref:selection.ref}:selection}));
async function assertPosition(page,saved) {
  await page.waitForFunction(()=>![...document.querySelectorAll('.main-content .loading')].some(element=>element.getClientRects().length));
  try {await page.waitForFunction(y=>Math.abs(scrollY-y)<3,saved);}
  catch(error) {
    const actual=await page.evaluate(()=>({scroll:scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight,history:history.state?.slowTuneMobileNavigation,focused:document.activeElement?.getAttribute('aria-label')}));
    throw new Error('Scroll restoration did not retain '+saved+': '+JSON.stringify(actual),{cause:error});
  }
}
async function readAt(page,y,action) {await page.evaluate(y=>scrollTo(0,y),y);if(action)await action.scrollIntoViewIfNeeded();const saved=await position(page);await page.waitForFunction(y=>history.state?.slowTuneMobileNavigation?.scroll===y,saved);return saved;}
async function startAudio(page) {
  await page.locator('.mobile-mini-player').getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0);
  return page.locator('audio').elementHandle();
}

test('mobile secondary navigation retains chart choice, author depth, pagination and scroll without touching playback',{timeout:120000},async t=>{
  const {fixture,page,errors}=await setup(t,{withYoutube:true}),audio=await startAudio(page);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowAnchor),'none');
  // Loop the controlled media so long browsing cannot naturally advance the queue.
  await audio.evaluate(a=>a.loop=true);
  const original=await queue(page),preparations=fixture.preparations.length;
  await discoverNav(page).getByRole('button',{name:'音乐榜单',exact:true}).click();
  await page.getByRole('tab',{name:'QQ',exact:true}).click();
  await page.getByRole('button',{name:'榜单歌曲下一页',exact:true}).click();
  await page.getByRole('textbox',{name:'榜单歌曲页码',exact:true}).waitFor();
  const chartsScroll=await readAt(page,650,page.getByRole('button',{name:'搜索 海岸第 38 首',exact:true}));
  await page.getByRole('button',{name:'搜索 海岸第 38 首',exact:true}).click();
  await page.getByRole('main',{name:'搜索音乐',exact:true}).waitFor();await page.goBack();
  await page.getByRole('tab',{name:'QQ',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'QQ',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('textbox',{name:'榜单歌曲页码',exact:true}).inputValue(),'2');
  await assertPosition(page,chartsScroll);
  await discoverNav(page).getByRole('button',{name:'关注',exact:true}).click();
  await page.locator('.source-tabs').getByRole('button',{name:'B站',exact:true}).click();
  await page.getByRole('button',{name:'关注作者下一页',exact:true}).click();
  const authorsScroll=await readAt(page,420,page.getByRole('button',{name:'查看 散步的音乐人 35 的合集',exact:true}));
  await page.getByRole('button',{name:'查看 散步的音乐人 35 的合集',exact:true}).click();
  await page.getByRole('button',{name:'打开合集 散步歌单 2 · 合集',exact:true}).waitFor();
  await page.getByRole('button',{name:'作者合集下一页',exact:true}).click();
  const collectionsScroll=await readAt(page,500,page.getByRole('button',{name:'打开合集 散步歌单 36 · 合集',exact:true}));
  await page.getByRole('button',{name:'打开合集 散步歌单 36 · 合集',exact:true}).click();
  await page.locator('.follows-page .track-row').first().waitFor();
  await page.getByRole('button',{name:'作者内容下一页',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="作者内容页码"]')?.value==='2');
  assert.equal(await page.getByRole('textbox',{name:'作者内容页码',exact:true}).inputValue(),'2');
  await page.getByRole('button',{name:'返回作者合集',exact:true}).click();
  await page.getByRole('button',{name:'打开合集 散步歌单 36 · 合集',exact:true}).waitFor();
  await assertPosition(page,collectionsScroll);
  await page.goBack();await page.getByRole('button',{name:'查看 散步的音乐人 35 的合集',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'关注作者页码',exact:true}).inputValue(),'2');await assertPosition(page,authorsScroll);
  assert.equal(await page.locator('.source-tabs').getByRole('button',{name:'B站',exact:true}).getAttribute('aria-pressed'),'true');
  await page.goForward();await page.getByRole('button',{name:'打开合集 散步歌单 36 · 合集',exact:true}).waitFor();await assertPosition(page,collectionsScroll);
  await page.getByRole('button',{name:'全部投稿',exact:true}).click();await page.locator('.follows-page .track-row').first().waitFor();
  await page.getByRole('button',{name:'作者内容下一页',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="作者内容页码"]')?.value==='2');
  const uploadsScroll=await readAt(page,650);
  let finishRead;
  const delayedRead=new Promise(done=>{finishRead=done;});t.after(()=>finishRead());
  await page.route('**/api/follows',async route=>{await delayedRead;await route.continue();});
  await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.locator('.mobile-player').waitFor();
  await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
  await page.locator('.follows-page>.loading').waitFor();finishRead();
  await page.locator('.follows-page .track-row').first().waitFor();
  assert.equal(await page.getByRole('textbox',{name:'作者内容页码',exact:true}).inputValue(),'2');await assertPosition(page,uploadsScroll);
  await page.setViewportSize({width:1280,height:800});await page.getByRole('heading',{name:'散步的音乐人 35',exact:true}).waitFor();
  await page.waitForFunction(()=>history.scrollRestoration==='auto'&&document.documentElement.style.overflowAnchor==='');
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'散步的音乐人 35',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'作者内容页码',exact:true}).inputValue(),'2');
  assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));
  assert.equal(fixture.preparations.length,preparations);assert.deepEqual(queueItems(await queue(page)),queueItems(original));
  await page.screenshot({path:join(artifacts,'06-author-uploads-390.png')});assert.deepEqual(errors,[]);
});

test('follow searches restore author and collection context across layout transitions',{timeout:60000},async t=>{
  const {fixture,page,errors}=await setup(t),audio=await startAudio(page);await audio.evaluate(a=>a.loop=true);
  const original=await queue(page),preparations=fixture.preparations.length;
  await discoverNav(page).getByRole('button',{name:'关注',exact:true}).click();
  await page.locator('.follow-creator-open').first().click();await page.locator('.follow-author-heading').waitFor();
  for(const collection of [false,true]){
    if(collection){
      await page.getByRole('button',{name:'打开合集 散步歌单 2 · 合集',exact:true}).click();
      await page.locator('.follows-page .track-row').first().waitFor();
    }
    await page.getByRole('button',{name:'搜索歌曲或视频',exact:true}).click();
    await page.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('跨屏搜索');
    await page.setViewportSize({width:1280,height:800});
    const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});await search.waitFor();
    assert.equal(await search.getByRole('textbox',{name:'弹窗搜索关键词',exact:true}).inputValue(),'跨屏搜索');
    await search.getByRole('button',{name:'关闭',exact:true}).click();await search.waitFor({state:'detached'});
    await page.getByRole('heading',{name:fixture.creators[0].name,exact:true}).waitFor();
    if(collection)await page.getByRole('button',{name:'返回作者合集',exact:true}).waitFor();
    else await page.getByRole('button',{name:'打开合集 散步歌单 2 · 合集',exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.app')?.dataset.layout==='mobile');
    const view=await page.evaluate(()=>JSON.parse(decodeURIComponent(history.state.slowTuneMobileNavigation.page.slice(8))));
    assert.equal(view.selected.id,fixture.creators[0].id);
    assert.equal(view.collection?.id,collection?fixture.collections[1].id:undefined);
  }
  assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));
  assert.equal(fixture.preparations.length,preparations);assert.deepEqual(queueItems(await queue(page)),queueItems(original));assert.deepEqual(errors,[]);
});

test('mobile version selection marks the current source and switches in place, including preparation failure',{timeout:90000},async t=>{
  const {fixture,page,errors}=await setup(t),audio=await startAudio(page);await audio.evaluate(a=>a.loop=true);
  await mobileNav(page).getByRole('button',{name:'音乐库',exact:true}).click();await page.getByRole('button',{name:'我的收藏 1 首歌曲',exact:true}).click();
  const original=await queue(page),prepared=fixture.preparations.length;
  await page.getByRole('button',{name:'选择播放版本 '+fixture.longTitle,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'歌曲与版本',exact:true}),versions=dialog.locator('.song-version-item');
  assert.equal(await dialog.locator('.song-version-item[aria-current="true"]').count(),1);
  assert.equal(fixture.preparations.length,prepared);
  await versions.last().getByRole('button',{name:'设为默认版本',exact:true}).click();
  await versions.last().getByText('默认播放',{exact:true}).waitFor();assert.equal(fixture.preparations.length,prepared);
  assert.deepEqual(queueItems(await queue(page)),queueItems(original),'changing a default does not change the queue');
  await versions.last().getByRole('button',{name:'播放此版本',exact:true}).click();
  await dialog.getByText(/^已切换到/).waitFor();
  assert.equal(await versions.last().getAttribute('aria-current'),'true');
  const switched=await queue(page);assert.deepEqual(switched.items.map(i=>i.instanceId),original.items.map(i=>i.instanceId));
  assert.equal(switched.current,original.current);assert.equal(switched.items[0].selection.explicitVersionId,'version-live');
  assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));
  fixture.setFailPrepare(true);await versions.first().getByRole('button',{name:'播放此版本',exact:true}).click();
  await dialog.getByText(/版本未能切换/).waitFor();assert.equal(await versions.last().getAttribute('aria-current'),'true');
  assert.deepEqual((await queue(page)).items,switched.items);assert(await audio.evaluate(a=>!a.paused));
  fixture.setFailPrepare(false);await versions.first().getByRole('button',{name:'播放此版本',exact:true}).click();await versions.first().getByText('当前播放版本',{exact:true}).waitFor();
  await page.screenshot({path:join(artifacts,'07-versions-390.png')});await page.goBack();await dialog.waitFor({state:'detached'});await page.goForward();assert.equal(await dialog.count(),0);
  assert.deepEqual(errors,[]);
});

test('mobile backup and source imports preview, cancel, retry and confirm without changing queue; compact and desktop layouts remain usable',{timeout:120000},async t=>{
  const {fixture,page,errors}=await setup(t),audio=await startAudio(page);await audio.evaluate(a=>a.loop=true);
  const original=await queue(page),prepared=fixture.preparations.length;
  await mobileNav(page).getByRole('button',{name:'音乐库',exact:true}).click();await page.getByRole('button',{name:'音乐库管理',exact:true}).click();await page.getByRole('button',{name:'导入 / 导出',exact:true}).click();
  const backup=page.getByRole('dialog',{name:'备份与恢复',exact:true});
  await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).fill('{}');await backup.getByRole('button',{name:'校验并预览影响',exact:true}).click();await backup.getByRole('alert').waitFor();
  const snapshot=await(await fetch(fixture.base+'/api/song-library/export')).text();
  await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).fill(snapshot);await backup.getByRole('button',{name:'校验并预览影响',exact:true}).click();
  await backup.getByRole('button',{name:'取消预览',exact:true}).click();assert.equal(await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).inputValue(),snapshot);
  await backup.getByRole('button',{name:'校验并预览影响',exact:true}).click();await backup.getByRole('button',{name:'确认导入',exact:true}).waitFor();
  fixture.setFailWrite(true);await backup.getByRole('button',{name:'确认导入',exact:true}).click();await backup.getByRole('alert').waitFor();
  assert.equal(await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).inputValue(),snapshot);
  fixture.setFailWrite(false);await backup.getByRole('button',{name:'确认导入',exact:true}).click();await backup.getByText('资料已导入，当前播放与队列保留。',{exact:true}).waitFor();await backup.getByRole('button',{name:'返回上一级',exact:true}).click();
  await mobileNav(page).getByRole('button',{name:'发现',exact:true}).click();await discoverNav(page).getByRole('button',{name:'关注',exact:true}).click();
  await page.getByRole('button',{name:'最近更新',exact:true}).click();await page.locator('.follow-feed-pages .track-row').first().waitFor();
  await page.locator('.follow-toolbar').getByRole('button',{name:'加入歌单',exact:true}).click();
  const source=page.getByRole('dialog',{name:/添加歌曲/});await source.getByRole('button',{name:'读取并预览来源',exact:true}).click();await source.getByRole('button',{name:'确认添加',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.song-list-import-modal [role="status"]')?.textContent?.includes('正在读取'));
  assert.equal(await source.locator('.source-import-preview .choice').count(),30);
  await source.getByRole('combobox',{name:'导入目标',exact:true}).selectOption('new');await source.getByRole('textbox',{name:'歌单名称',exact:true}).fill('海岸导入验证');
  fixture.setFailWrite(true);await source.getByRole('button',{name:'确认添加',exact:true}).click();await source.getByRole('button',{name:'重试添加',exact:true}).waitFor();assert.equal(await source.getByRole('textbox',{name:'歌单名称',exact:true}).inputValue(),'海岸导入验证');
  fixture.setFailWrite(false);
  for(const viewport of [{width:320,height:568},{width:360,height:640},{width:430,height:932},{width:568,height:320},{width:667,height:375}]) {
    await page.setViewportSize(viewport);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await source.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    const close=await source.getByRole('button',{name:'返回上一级',exact:true}).boundingBox();assert(close.x>=0&&close.x+close.width<=viewport.width);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'08-source-import-390.png')});
  await source.getByRole('button',{name:'重试添加',exact:true}).click();await source.waitFor({state:'detached'});
  await page.locator('.follow-toolbar').getByRole('button',{name:'加入歌单',exact:true}).click();
  fixture.setMetadataDelay(500);await source.getByRole('button',{name:'读取并预览来源',exact:true}).click();await source.getByRole('button',{name:'取消读取',exact:true}).click();await source.getByText(/读取已取消/).waitFor();
  fixture.setMetadataDelay(0);fixture.setFailMetadata(true);await source.getByRole('button',{name:'读取并预览来源',exact:true}).click();await source.getByRole('region',{name:'来源失败项',exact:true}).waitFor();
  assert.equal(await source.getByRole('button',{name:'确认添加',exact:true}).isDisabled(),true);
  fixture.setFailMetadata(false);await source.getByRole('button',{name:'读取并预览来源',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.source-import-preview .choice').length===30);
  const writesBeforeCancel=fixture.writes.length;await source.getByRole('button',{name:'取消添加',exact:true}).click();await source.waitFor({state:'detached'});assert.equal(fixture.writes.length,writesBeforeCancel);
  assert(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused));assert.equal(fixture.preparations.length,prepared);assert.deepEqual(queueItems(await queue(page)),queueItems(original));
  await page.setViewportSize({width:1280,height:800});await page.locator('.sidebar-nav').getByRole('button',{name:'音乐榜单',exact:true}).click();await page.locator('.chart-song-play').first().waitFor();assert(await page.locator('.chart-song-play').first().isVisible());
  assert.deepEqual(errors,[]);
});

test('secondary screens reflow at phone and landscape sizes with readable long content and reachable dialog controls',{timeout:120000},async t=>{
  const {fixture,page,errors}=await setup(t);
  const sizes=[{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:430,height:932},{width:568,height:320},{width:667,height:375}];
  const fits=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const dialogFits=async dialog=>{assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));const rect=await dialog.getByRole('button',{name:'返回上一级',exact:true}).boundingBox();assert(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=page.viewportSize().width&&rect.y+rect.height<=page.viewportSize().height);};
  for(const theme of ['light','dark'])for(const size of sizes){
    await page.setViewportSize(size);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await mobileNav(page).getByRole('button',{name:'发现',exact:true}).click();await discoverNav(page).getByRole('button',{name:'音乐榜单',exact:true}).click();await page.locator('.chart-song').first().waitFor();await fits();
    const row=await page.locator('.chart-song').first().boundingBox();assert(row.height<=104);
    for(const selector of ['.chart-song-main','.chart-song-search','.chart-song>.btn-icon:not(.chart-song-play)'])assert((await page.locator(selector).first().boundingBox()).height>=48);
    await discoverNav(page).getByRole('button',{name:'关注',exact:true}).click();
    if(await page.getByRole('button',{name:'返回关注',exact:true}).count())await page.getByRole('button',{name:'返回关注',exact:true}).click();
    await page.getByRole('button',{name:'关注的 UP',exact:true}).click();await page.getByRole('button',{name:'查看 '+fixture.creators[0].name+' 的合集',exact:true}).click();
    await page.getByRole('button',{name:'打开合集 '+fixture.collections[0].title,exact:true}).waitFor();await fits();
    if(theme==='light'&&size.width===320)await page.screenshot({path:join(artifacts,'12-author-320.png')});
    await page.getByRole('button',{name:'返回关注',exact:true}).click();await mobileNav(page).getByRole('button',{name:'音乐库',exact:true}).click();await page.getByRole('button',{name:'我的收藏 1 首歌曲',exact:true}).click();await page.getByRole('button',{name:'选择播放版本 '+fixture.longTitle,exact:true}).click();
    const versions=page.getByRole('dialog',{name:'歌曲与版本',exact:true});await dialogFits(versions);await fits();
    if(theme==='light'&&size.width===568)await page.screenshot({path:join(artifacts,'13-versions-landscape.png')});
    await versions.getByRole('button',{name:'返回上一级',exact:true}).click();await page.getByRole('button',{name:'返回音乐库',exact:true}).click();await page.getByRole('button',{name:'音乐库管理',exact:true}).click();await page.getByRole('button',{name:'导入 / 导出',exact:true}).click();
    const backup=page.getByRole('dialog',{name:'备份与恢复',exact:true});await dialogFits(backup);await fits();
    await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).fill('x'.repeat(500));assert.equal(await backup.getByRole('textbox',{name:'新资料库快照内容',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'16px');
    await backup.getByRole('button',{name:'返回上一级',exact:true}).click();
  }
  assert.deepEqual(errors,[]);
});
