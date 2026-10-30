import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate, selectPlaylist } from '../scripts/browser-ui.mjs';

test('desktop context actions preserve playback, versions, keyboard focus and object identity', { timeout: 120000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  const errors = [], preparations = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  await page.route('**/v1/call/prepare', route => { preparations.push(route.request().postDataJSON().request.ref); return route.continue(); });
  const output = resolve('local/verification/desktop-context-menu'); await mkdir(output, { recursive: true });
  const menu = () => page.locator('.context-menu:popover-open');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const choose = name => menu().getByRole('menuitem', { name, exact: true }).click();
  await page.goto(fixture.origin); await navigate(page, '歌单');
  const first = page.locator('.song-library-row').first(), play = first.getByRole('button', { name: '播放 晴天', exact: true });
  await play.click({ button: 'right' }); await menu().waitFor();
  assert.equal(preparations.length, 0); assert(await page.locator('audio').evaluate(audio => audio.paused && !audio.getAttribute('src')));
  const rightActions = await menu().getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape'); assert(await play.evaluate(element => element === document.activeElement));
  await first.getByRole('button', { name: '更多操作 晴天', exact: true }).click();
  assert.deepEqual(await menu().getByRole('menuitem').allTextContents(), rightActions);
  await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.textContent), '下移');
  await page.keyboard.press('Home'); assert.equal(await page.evaluate(() => document.activeElement.textContent), '立即播放');
  await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => document.activeElement.textContent), '下一首播放');
  await page.keyboard.press('Escape'); await play.focus(); await page.keyboard.press('ContextMenu');
  await menu().waitFor(); await page.keyboard.press('Escape');
  assert(await play.evaluate(element => element === document.activeElement));
  await page.keyboard.press('Shift+F10');
  await choose('下一首播放'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3'))?.items.length === 1);
  assert.equal(preparations.length, 0); assert(await page.locator('audio').evaluate(audio => audio.paused));
  await play.click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  const currentId = (await saved()).current, before = preparations.length;
  await page.getByRole('button', { name: '播放模式', exact: true }).click();
  await selectPlaylist(page, '周杰伦精选');
  const pinned = page.locator('.song-library-row').nth(1);
  await pinned.click({ button: 'right' }); await choose('下一首播放');
  const queued = await saved(); assert.equal(queued.current, currentId); assert.equal(queued.items.length, 2);
  assert.equal(queued.items[1].selection.pinnedVersionId, 'live'); assert.equal(preparations.length, before);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000002'));
  assert.equal(preparations.at(-1).id, 'BV0000000002');
  await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
  const queueFirst = page.locator('.queue-track').first(); await queueFirst.click({ button: 'right' });
  const count = (await saved()).items.length; await choose('移到下一首'); assert.equal((await saved()).items.length, count);
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current === id, currentId);
  await page.getByRole('button', { name: '关闭播放队列', exact: true }).click();

  // Sidebar operations address the clicked playlist without first navigating into it.
  await selectPlaylist(page, '我的收藏');
  const sidebar = page.locator('.sidebar-playlist').filter({ hasText: '周杰伦精选' });
  await sidebar.click({ button: 'right' }); await choose('歌单改名');
  const rename = page.getByRole('dialog', { name: '歌单改名', exact: true });
  await rename.getByLabel('歌单名称').fill('右键整理的歌单'); await rename.getByRole('button', { name: '保存歌单', exact: true }).click();
  await rename.waitFor({ state: 'detached' });
  assert.equal(fixture.library.read().snapshot.playlists.find(item => item.id === 'repeat').name, '右键整理的歌单');
  assert.equal(await page.locator('.song-library-page h1').innerText(), '我的收藏');
  await page.locator('.sidebar-playlist').filter({ hasText: '我的收藏' }).click({ button: 'right' });
  assert.equal(await menu().getByRole('menuitem', { name: '删除歌单', exact: true }).count(), 0);
  await page.keyboard.press('Escape');

  // Search dialog survives Escape from its context menu, and typed input keeps its editing menu.
  await navigate(page, '搜索');
  const search = page.getByRole('dialog', { name: '搜索音乐', exact: true });
  await search.getByLabel('弹窗搜索关键词').fill('晴天'); await search.getByRole('button', { name: '搜索', exact: true }).click();
  const result = search.locator('.track-row').first(); await result.waitFor(); await result.click({ button: 'right' });
  await menu().waitFor(); await page.keyboard.press('Escape'); assert(await search.isVisible());
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
  await result.click({button:'right'}); await choose('复制来源链接');
  await page.getByText('复制失败，请从原视频复制链接',{exact:true}).waitFor();
  await search.getByLabel('弹窗搜索关键词').click({ button: 'right' }); assert.equal(await menu().count(), 0);
  await search.getByRole('button', { name: '关闭', exact: true }).click();

  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme }); await play.click({ button: 'right' });
    await page.screenshot({ path: resolve(output, 'song-' + theme + '.png') }); await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 800, height: 500 });
  await play.scrollIntoViewIfNeeded(); await play.focus(); await page.keyboard.press('Shift+F10');
  const bounds = await menu().evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight }; });
  assert(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height);
  await page.keyboard.press('End');
  assert(await menu().evaluate(element => { const item = document.activeElement.getBoundingClientRect(), rect = element.getBoundingClientRect(); return item.top >= rect.top && item.bottom <= rect.bottom + 1; }));
  await page.screenshot({ path: resolve(output, 'short-window.png') });
  await page.keyboard.press('Escape');
  await play.click({ button: 'right' }); await menu().waitFor();
  await page.locator('.main-content').evaluate(element => element.dispatchEvent(new Event('scroll')));
  await menu().waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.app').dataset.layout === 'mobile');
  assert.equal(await page.locator('.song-row-menu').count(), 0);
  assert.deepEqual(errors, []);
});

test('restored queues stay silent when scheduling next and disabled sources keep data actions', { timeout: 60000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  fixture.library.execute(fixture.library.read().revision, [{ type:'create-playlist',id:'closed',name:'关闭来源' },{type:'add-entry',playlistId:'closed',entryId:'closed-cover',songId:'sun',pinnedVersionId:'cover'}]);
  const browser = await chromium.launch({ headless:true,args:['--autoplay-policy=no-user-gesture-required'] }); t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1280,height:800}}); page.setDefaultTimeout(8000);
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
  await page.goto(fixture.origin); await navigate(page,'歌单');
  const menu=()=>page.locator('.context-menu:popover-open');
  await page.getByRole('button',{name:'播放 晴天',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
  await page.reload(); await navigate(page,'歌单');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  await page.locator('.song-library-row').nth(1).click({button:'right'});
  await menu().getByRole('menuitem',{name:'下一首播放',exact:true}).click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  assert.equal(after.current,before.current); assert.equal(after.items[0].instanceId,before.current);
  assert.equal(after.items[1].selection.songId,'duplicate');
  assert(await page.locator('audio').evaluate(audio=>audio.paused&&!audio.getAttribute('src')));
  await selectPlaylist(page,'关闭来源'); await page.locator('.song-library-row').click({button:'right'});
  assert(await menu().getByRole('menuitem',{name:/^立即播放/}).isDisabled());
  assert(await menu().getByRole('menuitem',{name:'编辑歌曲 晴天',exact:true}).isEnabled());
  assert(await menu().getByRole('menuitem',{name:'取消收藏',exact:true}).isEnabled());
  await page.keyboard.press('Escape');
  await navigate(page,'音乐榜单'); await page.locator('.chart-song').first().click({button:'right'});
  assert.equal(await menu().getByRole('menuitem',{name:'打开原视频',exact:true}).count(),0);
  await menu().getByRole('menuitem',{name:'加入队尾',exact:true}).click();
  const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  assert.equal(queued.items.at(-1).selection.kind,'chart');
  assert(await page.locator('audio').evaluate(audio=>audio.paused&&!audio.getAttribute('src')));
});

test('queue additions preserve a pending play request', { timeout: 120000 }, async t => {
  for (const action of ['下一首播放', '加入队尾', '歌单加入队尾', '来源下一首播放']) await t.test(action, async t => {
    const fixture = await startSongManagementFixture(); t.after(fixture.close);
    fixture.library.execute(fixture.library.read().revision, [
      { type: 'create-playlist', id: 'pending', name: '待加入歌单' },
      { type: 'add-entry', playlistId: 'pending', entryId: 'duplicate', songId: 'duplicate' },
      { type: 'add-entry', playlistId: 'pending', entryId: 'live', songId: 'sun', pinnedVersionId: 'live' },
    ]);
    const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
    await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    let release, started;
    const held = new Promise(resolve => { release = resolve; }), preparing = new Promise(resolve => { started = resolve; });
    t.after(() => release());
    await page.route('**/v1/call/prepare', async route => { started(); await held; await route.continue().catch(() => {}); });
    await page.goto(fixture.origin); await navigate(page, '歌单');
    await page.getByRole('button', { name: '播放 晴天', exact: true }).click(); await preparing;
    if (action === '歌单加入队尾') await page.locator('.sidebar-playlist').filter({ hasText: '待加入歌单' }).click({ button: 'right' });
    else if (action === '来源下一首播放') {
      await navigate(page, '搜索');
      const search = page.getByRole('dialog', { name: '搜索音乐', exact: true });
      await search.getByLabel('弹窗搜索关键词').fill('晴天'); await search.getByRole('button', { name: '搜索', exact: true }).click();
      await search.locator('.track-row').first().click({ button: 'right' });
    } else await page.locator('.song-library-row').nth(1).click({ button: 'right' });
    await page.locator('.context-menu:popover-open').getByRole('menuitem', { name: action === '歌单加入队尾' ? '加入队尾' : action === '来源下一首播放' ? '下一首播放' : action, exact: true }).click();
    const count = action === '歌单加入队尾' ? 2 : 1;
    await page.waitForFunction(count => JSON.parse(localStorage.getItem('slow-listening:playback:v3'))?.items.length === count, count);
    release();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
    assert.equal(saved.items.length, count + 1);
    assert.equal(saved.items.find(item => item.instanceId === saved.current).selection.songId, 'sun');
    assert.equal(await page.locator('audio').evaluate(audio => new URL(audio.currentSrc).searchParams.get('id')), 'BV0000000001');
  });
});

test('moving a scheduled next item to the tail cancels its priority without replacing playback', { timeout: 60000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  fixture.library.execute(fixture.library.read().revision, [
    { type: 'create-playlist', id: 'three', name: '三首队列' },
    { type: 'add-entry', playlistId: 'three', entryId: 'a', songId: 'sun' },
    { type: 'add-entry', playlistId: 'three', entryId: 'b', songId: 'duplicate' },
    { type: 'add-entry', playlistId: 'three', entryId: 'c', songId: 'sun', pinnedVersionId: 'live' },
  ]);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  await page.goto(fixture.origin); await navigate(page, '歌单'); await selectPlaylist(page, '三首队列');
  await page.locator('.song-library-page .play-all').click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
  const before = await saved();
  await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
  const row = page.locator('.queue-track').filter({ hasText: '晴天（重复保存）' });
  await row.click({ button: 'right' }); await page.locator('.context-menu:popover-open').getByRole('menuitem', { name: '移到下一首', exact: true }).click();
  await row.click({ button: 'right' }); await page.locator('.context-menu:popover-open').getByRole('menuitem', { name: '移到队尾', exact: true }).click();
  const moved = await saved();
  assert.deepEqual(moved.items.map(item => item.instanceId), [before.items[0].instanceId, before.items[2].instanceId, before.items[1].instanceId]);
  assert.equal(moved.current, before.current);
  assert(await page.locator('audio').evaluate(audio => !audio.paused && new URL(audio.currentSrc).searchParams.get('id') === 'BV0000000001'));
  await page.getByRole('button', { name: '下一首', exact: true }).click();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current === id, before.items[2].instanceId);
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.includes('BV0000000002'));
});

test('clearing the queue cancels a source addition still reading metadata', { timeout: 60000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  await page.goto(fixture.origin); await navigate(page, '歌单');
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
  await navigate(page, '搜索');
  const search = page.getByRole('dialog', { name: '搜索音乐', exact: true });
  await search.getByLabel('弹窗搜索关键词').fill('晴天'); await search.getByRole('button', { name: '搜索', exact: true }).click();
  await search.locator('.track-row').first().waitFor();
  let release, started, finish;
  const held = new Promise(resolve => { release = resolve; }), reading = new Promise(resolve => { started = resolve; }), finished = new Promise(resolve => { finish = resolve; });
  t.after(() => release());
  await page.route('**/v1/call/metadata', async route => { started(); await held; await route.continue().catch(() => {}); finish(); });
  await search.locator('.track-row').first().click({ button: 'right' });
  await page.locator('.context-menu:popover-open').getByRole('menuitem', { name: '加入队尾', exact: true }).click(); await reading;
  await search.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
  await page.getByRole('button', { name: '清空队列并停止', exact: true }).click();
  release(); await finished;
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')).items), []);
  assert(await page.locator('audio').evaluate(audio => audio.paused && !audio.getAttribute('src')));
});
