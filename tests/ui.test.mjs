import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './helpers/browser.mjs';
import { fromMusicRef,queueRecord,installSongFixture } from './helpers/song-fixture.mjs';
import { DEFAULT_CONFIG, execute } from '@studio/recommendation';
import { navigate, createPlaylist, selectPlaylist, openTrackMenu, queueTrackMenu, verifyDefaultDiscovery, selectRate, openSettingsPage, closeSettingsPage } from '../scripts/browser-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = process.env.MUSIC_APP_TEST_BUILD ?? root;

test('Browser regressions: favorite state, unavailable warnings and current acceptance controls', async t => {
  const ref = { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm' };
  const track = { ref, resourceId: 'bilibili:video:' + ref.id, title: '视频标题 / 单项 · 在夜色中慢听的现场录音与特别演出（完整音乐视频）', url: 'https://www.bilibili.com/video/' + ref.id, artwork:'http://i1.hdslb.com/bfs/archive/fixture-cover.png' };
  const part = { ...track, ref: { ...ref, part: '900' }, resourceId: track.resourceId + ':900' };
  const metadata = { ...part, parts: [part] };
  const second = { ref: { provider: 'youtube', kind: 'video', id: 'kK0CRZ0wvvc' }, resourceId: 'queue-second', title: '第二首', url: 'https://www.youtube.com/watch?v=kK0CRZ0wvvc' };
  const shelves = ['recommendation', 'chart', 'new'].map((kind, index) => ({
    id: ['music-recommendation','hot-chart','new-music'][index], title: '栏目 ' + index, kind,
    page: { items: Array.from({ length: index === 1 ? 3 : 20 }, (_, i) => ({ ...track, resourceId: track.resourceId + '-' + i })) },
  }));
  let revision = 0;
  let account = {state:'anonymous'}, qrIndex = 0, loginPhase = 'pending';
  const pollFailures = [], pollCalls = [], confirmations = [];
  let discoveryCalls=0,discoveryMode='same',discoveryDelay=80,chartDelay=0,chartFailure=false,chartCalls=[],displayProcessed=false,statusCalls=0;
  let build={startedAt:1,stale:false,changed:[],started:{server:1,client:1},current:{server:1,client:1}};
  let youtubeAvailable=false,youtubeFailure=false;
  const youtubeCalls=[];
  const recommendationStates = new Map(), recommendationPreviews = [], recommendationSaves = [];
  const recommendationState = column => {
    if (!recommendationStates.has(column)) recommendationStates.set(column, { entry: 1, epoch: 1, legacyRevision: 'legacy-1', sharedRevision: 'shared-1', legacy: { include: [], exclude: [], mode: 'any', order: 'upstream' }, document: { schema: 1, revision: 'document-1', preset: { id: 'preset', revision: 'preset-1', config: structuredClone(DEFAULT_CONFIG) }, overrides: {} }, origins: {} });
    return recommendationStates.get(column);
  };
  const chartPeriods=[{id:439,number:226,publishedAt:1791540001000},{id:437,number:225,publishedAt:1790935200000}];
  const cancellations = [];
  const snapshot = {
    playlists: [{ id: 'p1', name: '失效歌曲歌单', createdAt: 1, updatedAt: 1, entries: [{
      id: 'e1', ref: fromMusicRef(part.ref), metadata: { title: part.title },
      availability: { state: 'unavailable', code: 'not-found', checkedAt: 1 }, addedAt: 1,
    }] }], favorites: [],
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(request.url)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(request.url));
    if (request.url === '/api/status') { statusCalls++; return json({ version: 'fixture', node: process.version, providers: { youtube: { enabled: true, available: youtubeAvailable } }, delivery: { leases: 0, activeReads: 0 }, tool: { active: 0 }, build }); }
    if (request.url === '/api/recommendation/confirm') {const chunks=[];for await(const chunk of request)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks).toString());confirmations.push(input);return json({accepted:true,count:input.ids.length});}
    if (request.url.startsWith('/api/recommendation/settings')) {
      if (request.method !== 'POST') return json(recommendationState(new URL(request.url, 'http://localhost').searchParams.get('column')));
      const chunks=[];for await(const chunk of request)chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks).toString()), state=recommendationState(input.column);
      recommendationSaves.push(input);
      if (input.patch.overrides) { state.document.overrides=input.patch.overrides;state.origins=Object.fromEntries(Object.keys(input.patch.overrides).map(key=>[key,'personal'])); }
      if (input.patch.entry !== undefined) state.entry=input.patch.entry;
      if (input.patch.legacy) state.legacy=input.patch.legacy;
      state.epoch++;state.sharedRevision='shared-'+state.epoch;
      return json(state);
    }
    if (request.url === '/api/recommendation/preview') {
      const chunks=[];for await(const chunk of request)chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks).toString());recommendationPreviews.push(input);
      const source=input.column==='youtube-music-selection'?'youtube':'bilibili';
      const items=['Music · 正式录音','Music · 现场','Music · 伴奏','Music · 其他'].map((title,index)=>({...track,title,resourceId:'preview-'+index,ref:{provider:source,kind:'video',id:source==='youtube'?String(index).padStart(11,'0'):'BV'+String(index).padStart(10,'0')},uploader:{name:'测试博主',id:'fixture-author'}}));
      const result=execute({candidates:items.map(item=>({identity:{namespace:source,id:item.ref.id},source,authorized:true,available:true,media:'video',title:item.title,author:item.uploader.name,provenance:'ui-fixture'})),config:{...recommendationState(input.column).document.preset.config,...input.overrides},access:{user:'fixture',authorizationRevision:'fixture',sourceRevision:'fixture',grants:[{source}]},seed:'fixture',all:true});
      return json({id:input.column,title:'推荐预览',kind:'recommendation',page:{items:result.items.map(selected=>items.find(item=>item.ref.id===selected.candidate.identity.id))},recommendation:{entry:1,processed:true,order:input.overrides.order??'upstream',pool:items.length,shortage:result.shortage,diagnostics:result.diagnostics,reasons:result.items.map(item=>item.reasons),seed:'fixture',context:'fixture'}});
    }
    if (request.url.startsWith('/api/youtube/music?')) {
      const params=new URL(request.url,'http://localhost').searchParams,region=params.get('region');
      youtubeCalls.push({region,refresh:params.get('refresh')});
      await new Promise(resolve=>setTimeout(resolve,region==='HK'?200:10));
      if(response.destroyed)return;
      if(youtubeFailure)return json({error:{code:'network'}},503);
      return json({region,shelf:{id:'youtube-music-selection',title:'YouTube 音乐精选',kind:'recommendation',recommendation:{entry:1,processed:false,order:'upstream',pool:36,shortage:[],seed:'fixture',context:'fixture',token:'youtube-display-'+region},page:{items:Array.from({length:36},(_,i)=>({...second,ref:{provider:'youtube',kind:'video',id:String(i).padStart(11,'0')},resourceId:region+'-youtube-'+i,title:region+'精选 '+(i+1),artwork:track.artwork}))}},sourceUrl:'https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ?gl='+region,fetchedAt:Date.now(),catalogueUpdatedAt:Date.now(),playlists:[{id:'public-mando',title:region==='HK'?'Mando Flow':'地区公开歌单',url:'https://www.youtube.com/playlist?list=fixture'}],warnings:[]});
    }
    if (request.url.startsWith('/api/follows')) return json({revision:'f0',creators:[]});
    if (request.url === '/api/bilibili/account') return json(account);
    if (request.url.startsWith('/api/bilibili/sync')) return json({accountId:'123',links:[],busy:false,folders:[]});
    if (request.url.startsWith('/api/bilibili/chart?')) {
      const period=new URL(request.url,'http://localhost').searchParams.get('period');chartCalls.push(period);
      await new Promise(resolve=>setTimeout(resolve,chartDelay));
      if(response.destroyed)return;
      if(chartFailure)return json({error:{code:'network'}},503);
      const selected=period==='latest'?chartPeriods[0]:chartPeriods.find(p=>String(p.id)===period);
      return json({shelf:{...shelves[1],title:'B站热歌榜',page:{items:shelves[1].page.items.map(t=>({...t,title:selected.id===437?'历史期歌曲':track.title}))}},periods:chartPeriods,period:selected,sourceUrl:'https://music.bilibili.com/pc/rank?list_type=1&list_id='+selected.id,fetchedAt:Date.now()});
    }
    if (request.url === '/api/bilibili/login') return json({id:'fixture-qr-'+(++qrIndex),method:'qr',url:'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixture-'+qrIndex,expiresAt:Date.now()+180000,intervalMs:2000});
    if (request.url === '/api/bilibili/poll') {
      const chunks=[];for await(const chunk of request)chunks.push(chunk);
      pollCalls.push(JSON.parse(Buffer.concat(chunks).toString()).id);
      if(pollFailures.length)return json({error:{code:pollFailures.shift()}},503);
      if(loginPhase==='authenticated'){account={state:'authenticated',account:{provider:'bilibili',id:'123',name:'测试音乐账号'}};return json(account);}
      return json({state:loginPhase});
    }
    if (request.url === '/api/bilibili/cancel') {const chunks=[];for await(const chunk of request)chunks.push(chunk);cancellations.push(JSON.parse(Buffer.concat(chunks).toString()).id);return json({ok:true});}
    if (request.url === '/api/bilibili/disconnect') {account={state:'anonymous'};return json(account);}
    if (request.url === '/v1/handshake') return json({ protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata', 'discover', 'search', 'prepare'], limitations: [], anonymous: true }] });
    if (request.url === '/v1/call/discover' || request.url.startsWith('/api/discovery/bilibili')) {
      discoveryCalls++;await new Promise(resolve=>setTimeout(resolve,discoveryDelay));
      const first={...shelves[0],recommendation:{entry:1,processed:displayProcessed,order:'upstream',pool:20,shortage:[],seed:'fixture',context:'fixture',token:'display-'+discoveryCalls},...(account.state==='authenticated'?{id:'account-recommendation',title:'为你推荐 · B站账号'}:{}),...(discoveryMode==='changed'?{page:{items:[{...track,ref:{...ref,id:'BV1234567890'},resourceId:'fresh-music',title:'换批后的音乐'}]}}:{})};
      return json(request.url.startsWith('/api/discovery/')?[first,...shelves.slice(1)]:{protocol:2,result:[first,...shelves.slice(1)]});
    }
    if (request.url === '/v1/call/metadata') return json({ protocol: 2, result: metadata });
    if (request.url.startsWith('/v1/')) return json({ protocol: 2, error: { code: 'unsupported', retryable: false } }, 400);
    try {
      const path = join(buildRoot, 'dist/client', request.url === '/' ? 'index.html' : request.url);
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream');
      response.end(readFileSync(path));
    } catch { response.writeHead(404); response.end(); }
  });
  const libraryFixture=installSongFixture(server,{seed:snapshot});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const setViewport = async viewport => {
    await page.setViewportSize(viewport);
    await page.waitForFunction(mobile => document.querySelector('.app')?.dataset.layout === (mobile ? 'mobile' : 'desktop'), viewport.width <= 760);
  };
  await page.clock.setFixedTime(new Date(2026, 9, 15, 12));
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const settingsPanel = section => page.locator(':is(.settings-view,.mobile-settings:not([hidden])) [data-settings-section="'+section+'"]');
  const openSettings = (section = '外观') => openSettingsPage(page, section);
  const closeSettings = async () => {
    const mobile = await page.locator('.app').getAttribute('data-layout') === 'mobile';
    await closeSettingsPage(page);
    if (mobile) await navigate(page, '发现');
  };
  await page.route('https://i1.hdslb.com/bfs/archive/fixture-cover.png',route=>route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')}));
  await page.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)),queueRecord([part,second]));
  await page.goto('http://127.0.0.1:' + server.address().port);

  await t.test('default discovery counts and favorite/unfavorite preserve the original reference', async () => {
    const result = await verifyDefaultDiscovery(page);
    assert.deepEqual(result.map(shelf => shelf.shown), [12, 0, 0]);
    const heart = page.locator('.music-card').first().locator('.cover-favorite');
    await heart.click();
    await page.waitForFunction(() => document.querySelector('.music-card .cover-favorite')?.classList.contains('saved'));
    assert.equal(libraryFixture.library.read().snapshot.favorites.length, 1);
    assert.deepEqual(libraryFixture.library.read().snapshot.versions[0].ref, part.ref);
    await heart.click();
    await page.waitForFunction(() => !document.querySelector('.music-card .cover-favorite')?.classList.contains('saved'));
    assert.equal(libraryFixture.library.read().snapshot.favorites.length, 0);
  });

  await t.test('HTTP artwork loads under the production HTTPS-only CSP, including previously saved queue covers',async()=>{
    await page.waitForFunction(()=>document.querySelector('.discovery-shelf .cover-button img')?.naturalWidth===1&&document.querySelector('.now-playing img')?.naturalWidth===1);
    assert.equal(await page.locator('.discovery-shelf .cover-button img').first().getAttribute('src'),'https://i1.hdslb.com/bfs/archive/fixture-cover.png');
    assert.equal(await page.locator('.now-playing img').getAttribute('src'),'https://i1.hdslb.com/bfs/archive/fixture-cover.png');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('slow-listening:playback:v3')));
    assert.deepEqual(saved.items.map(t=>t.selection.ref),[part.ref,second.ref],'new queue restores exact sources without persisting artwork');
    assert.equal(saved.current,part.resourceId);
  });

  await t.test('desktop tools stay at the bottom left and mobile header and profile keep link and theme actions reachable', async () => {
    const artifacts = join(root, 'test-results/topbar-tools');
    mkdirSync(artifacts, { recursive: true });
    const originalPlaylists = snapshot.playlists;
    snapshot.playlists = [...originalPlaylists, ...Array.from({ length: 25 }, (_, index) => ({ id: 'sidebar-' + index, name: '用于验证滚动的长歌单 ' + (index + 1), createdAt: 1, updatedAt: 1, entries: [] }))];
    libraryFixture.reset(snapshot);
    try {
      await page.reload();
      const tools = page.getByRole('group', { name: '工具', exact: true });
      await tools.waitFor();
      assert.equal(await page.locator('.sidebar>.desktop-tools').count(), 1, 'the utility row is outside the scrolling playlist area');
      assert.deepEqual(await tools.locator('button').allTextContents(), ['', '', ''], 'the tools only display icons');
      assert.equal(await tools.locator('button').first().getAttribute('aria-label'), '粘贴链接');
      assert.equal(await tools.locator('button').last().getAttribute('aria-label'), '设置');
      for (const width of [768, 1050, 1051, 1250, 1440, 1775, 1776, 1920, 2560]) {
        await setViewport({ width, height: 640 });
        assert.equal(await page.locator('.topbar button:visible').count(), 1, 'only the search submit remains in the desktop header');
        const bounds = await page.locator('.sidebar').evaluate(sidebar => {
          const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width }; };
          const library = sidebar.querySelector('.sidebar-library');
          return { sidebar: rect(sidebar), header: rect(document.querySelector('.topbar')), search: rect(document.querySelector('.search-field')), tools: rect(document.querySelector('.desktop-tools')), buttons: [...document.querySelectorAll('.desktop-tools button')].map(rect), scrollable: library.scrollHeight > library.clientHeight };
        });
        assert.equal(bounds.sidebar.bottom, 640, 'the sidebar reaches the viewport bottom');
        assert(bounds.scrollable, 'long libraries scroll independently');
        assert(bounds.search.left >= bounds.sidebar.right, 'the search stays in the content header');
        assert(bounds.tools.left >= 0 && bounds.tools.right <= bounds.sidebar.right && bounds.tools.top > 320 && bounds.tools.bottom <= 640, 'tools stay at the bottom left');
        for (const button of bounds.buttons) {
          assert(button.height >= 40 && button.width >= 40, JSON.stringify({ width, button }));
          assert.equal(button.top, bounds.buttons[0].top, 'the tools share one row');
        }
        const before = await tools.boundingBox();
        await page.locator('.sidebar-library').evaluate(element => { element.scrollTop = element.scrollHeight; });
        assert((await page.locator('.sidebar-library').evaluate(element => element.scrollTop)) > 0);
        assert.deepEqual(await tools.boundingBox(), before, 'scrolling playlists does not move the global tools');
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        assert.deepEqual(await tools.boundingBox(), before, 'scrolling page content does not move the global tools');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(artifacts, `desktop-${width}.png`) });
      }
      await setViewport({ width: 1440, height: 1000 });
      const position = await tools.boundingBox();
      for (const name of ['发现', '音乐榜单', '关注', '歌单']) {
        await navigate(page, name);
        assert.deepEqual(await tools.boundingBox(), position, name + ' preserves the global tools');
      }
      await openSettings();
      assert.deepEqual(await tools.boundingBox(), position, 'settings preserves the global tools');
      await closeSettings();
      await navigate(page, '发现');
      await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
      await page.locator('.listening-stage').waitFor();
      assert.equal(await tools.count(), 0, 'desktop listening uses the sidebar tools after returning to browsing');
      await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
      await tools.waitFor();
      await tools.getByRole('button', { name: '粘贴链接', exact: true }).click();
      const link = page.getByRole('dialog', { name: '粘贴链接', exact: true });
      await link.waitFor();
      assert(await link.getByLabel('视频或歌单链接').evaluate(element => element === document.activeElement));
      await link.getByLabel('视频或歌单链接').fill('BV1tX4y1W7Xm');
      assert(await link.getByRole('button', { name: '读取真实元信息', exact: true }).isEnabled());
      await link.getByRole('button', { name: '关闭', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'light' });
      await openSettings();
      const mode = page.getByRole('group', { name: '明暗模式', exact: true });
      await mode.getByRole('button', { name: '跟随系统', exact: true }).click();
      assert(await page.getByText('系统使用深色，或本机时间为 18:00–次日 06:00 时，自动使用黑夜模式', { exact: false }).isVisible());
      await closeSettings();
      await tools.getByRole('button', { name: '切换为深色', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'dark');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.emulateMedia({ colorScheme: 'light' });
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'the shortcut still selects a manual theme');
      await tools.getByRole('button', { name: '切换为浅色', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'light');
      await tools.getByRole('button', { name: '切换为深色', exact: true }).waitFor();
      await page.mouse.move(800, 90);
      await page.waitForTimeout(220); // Let the existing color transitions settle before the visual capture.
      await page.screenshot({ path: join(artifacts, 'light-1440.png') });
      await openSettings();
      await mode.getByRole('button', { name: '跟随系统', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await closeSettings();
      for (const width of [320, 390]) {
        await setViewport({ width, height: 844 });
        const header = page.locator('.mobile-header');
        await header.waitFor();
        for (const name of ['搜索歌曲或视频', '粘贴链接']) {
          const button = header.getByRole('button', { name, exact: true });
          assert(await button.isVisible(), 'phone header actions stay reachable');
          const bounds = await button.boundingBox();
          assert(bounds.width >= 48 && bounds.height >= 48 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        }
        await header.getByRole('button', { name: '粘贴链接', exact: true }).click();
        await link.getByLabel('视频或歌单链接').fill('BV1tX4y1W7Xm');
        assert(await link.getByRole('button', { name: '读取真实元信息', exact: true }).isEnabled());
        await link.getByRole('button', { name: '关闭', exact: true }).click();
        await openSettings();
        const mobileMode = settingsPanel('appearance').getByRole('group', { name: '明暗模式', exact: true });
        await mobileMode.getByRole('button', { name: '白天', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'light');
        await mobileMode.getByRole('button', { name: '黑夜', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme-preference'), 'dark');
        await closeSettings();
        await page.screenshot({ path: join(artifacts, `phone-${width}.png`) });
      }
    } finally {
      snapshot.playlists = originalPlaylists;
      libraryFixture.reset(snapshot);
      await setViewport({ width: 1440, height: 1000 });
      await page.reload();
      await page.locator('.music-card').first().waitFor();
    }
  });

  await t.test('queue visibility is manual, survives navigation and resizing, and never restores with saved tracks', async () => {
    const opener = page.locator('.playbar button[aria-label="打开播放队列"]');
    assert.equal(await page.locator('.queue-panel').count(), 0);
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    await setViewport({ width: 2560, height: 1000 });
    for (const opened of [false, true]) {
      if (opened) await opener.click();
      for (const name of ['发现', '音乐榜单', '关注', '歌单', '设置']) {
        if (name === '设置') await openSettings();
        else await navigate(page, name);
        assert.equal(await opener.getAttribute('aria-expanded'), String(opened), name + ' preserves the manual switch');
        assert.equal(await page.locator('.queue-panel').count(), Number(opened));
        const bounds = await page.locator('.main-content').evaluate(element => {
          const app = getComputedStyle(element.closest('.app')), style = getComputedStyle(element), r = element.getBoundingClientRect();
          const left = parseFloat(app.paddingLeft), right = parseFloat(app.paddingRight), available = document.documentElement.clientWidth - left - right;
          return { left: r.left, width: r.width, expectedLeft: left + (available - Math.min(1600, available)) / 2, expectedWidth: Math.min(1600, available), paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
        });
        assert(Math.abs(bounds.left - bounds.expectedLeft) < 1 && Math.abs(bounds.width - bounds.expectedWidth) < 1, name + ': ' + JSON.stringify(bounds));
        assert.equal(bounds.paddingLeft, bounds.paddingRight, name + ' uses symmetric content padding');
      }
    }
    await navigate(page, '发现');
    await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
    assert(await page.locator('.queue-panel').isVisible(), 'entering the listening page preserves an open queue');
    await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
    for (const width of [1051, 1050, 768, 1440]) {
      await setViewport({ width, height: 1000 });
      await page.locator('.queue-panel').waitFor();
      if (width <= 1050) await page.getByRole('dialog', { name: '播放队列', exact: true }).waitFor();
      else await page.locator('.queue-drawer').waitFor({ state: 'detached' });
      assert.equal(await opener.getAttribute('aria-expanded'), 'true', 'resize preserves the manual switch at ' + width);
    }
    await opener.click();
    await page.locator('.queue-panel').waitFor({ state: 'detached' });
    for (const name of ['音乐榜单', '发现']) await navigate(page, name);
    await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
    assert.equal(await page.locator('.queue-panel').count(), 0, 'entering the listening page does not open a closed queue');
    await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
    await opener.click();
    await page.reload();
    await opener.waitFor();
    assert.equal(await page.locator('.queue-panel').count(), 0, 'refresh closes the panel');
    assert.equal(await page.locator('.now-playing strong').getAttribute('title'), part.title, 'saved queue content still restores');
    await setViewport({ width: 768, height: 1000 });
    await opener.click();
    const drawer = page.getByRole('dialog', { name: '播放队列', exact: true });
    await drawer.waitFor();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    assert(await opener.evaluate(element => element === document.activeElement), 'Escape returns focus to the queue opener');
    await opener.click();
    await drawer.waitFor();
    await page.mouse.click(1, 1);
    await drawer.waitFor({ state: 'detached' });
    await setViewport({ width: 1440, height: 1000 });
    assert.equal(await opener.getAttribute('aria-expanded'), 'false', 'a dismissed drawer stays closed on desktop');
  });

  await t.test('the floating dock stays centered and compact without overlapping controls or the last content row', async () => {
    const artifacts = join(root, 'test-results/floating-player');
    mkdirSync(artifacts, { recursive: true });
    await navigate(page, '发现');
    await page.locator('.music-card').first().waitFor();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [320, 390, 768, 1050, 1051, 1250, 1251, 1440, 1920, 2560]) {
        await setViewport({ width, height: 1000 });
        const bounds = await page.locator(width > 760 ? '.playbar' : '.mobile-mini-player').evaluate(element => {
          const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          return { viewport: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, dock: rect(element), play: rect(element.querySelector('.play-toggle')), groups: [...element.querySelector('.playbar-inner,.mobile-mini-row').children].filter(child => child.getClientRects().length).map(child => ({ ...rect(child), controls: [...child.querySelectorAll('button,input')].filter(control => control.getClientRects().length && !control.closest('[popover]')).map(rect) })) };
        });
        assert.equal(bounds.overflow, false, JSON.stringify({ width, theme, ...bounds }));
        if (width > 760) {
          assert(Math.abs(bounds.dock.width - Math.min(1280, bounds.viewport - 32)) < 1);
          assert.equal(bounds.dock.height, 88);
          assert.equal(bounds.dock.bottom, 984);
          assert(Math.abs((bounds.dock.left + bounds.dock.right) / 2 - bounds.viewport / 2) < 1, 'dock is centered');
          assert(Math.abs((bounds.play.left + bounds.play.right) / 2 - bounds.viewport / 2) < 1, 'play is centered');
          for (const group of bounds.groups) for (const control of group.controls) {
            assert(control.left >= group.left - 1 && control.right <= group.right + 1 && control.top >= bounds.dock.top && control.bottom <= bounds.dock.bottom, JSON.stringify({ width, theme, group, control }));
          }
          assert(await page.getByRole('button', { name: '打开播放队列', exact: true }).isVisible());
        } else {
          assert.equal(bounds.dock.width, bounds.viewport - 24);
          assert.equal(bounds.dock.left, 12);
          assert.equal(bounds.dock.height, 72);
          assert(bounds.play.width >= 48 && bounds.play.height >= 48);
          const nav = await page.locator('.mobile-nav').boundingBox();
          assert(bounds.dock.bottom <= nav.y, 'the mini player clears mobile navigation');
        }
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const last = await page.locator('.discovery-shelf').last().boundingBox();
        assert(last.y + last.height <= bounds.dock.top + 1, 'last shelf clears the dock at ' + width);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`) });
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await setViewport({ width: 1440, height: 1000 });
    const empty = await browser.newPage({ viewport: { width: 2560, height: 1000 } });
    try {
      await empty.goto('http://127.0.0.1:' + server.address().port);
      await empty.getByRole('button', { name: '打开播放队列', exact: true }).click();
      await empty.locator('.queue-empty').waitFor();
      assert.equal(await empty.locator('.playbar .play-toggle').isDisabled(), true);
      await empty.screenshot({ path: join(artifacts, 'empty-2560.png') });
    } finally { await empty.close(); }
  });

  await t.test('player shell choices preserve internal positions, remember the selection and keep full-height panels clear', async () => {
    const artifacts = join(root, 'test-results/player-styles');
    mkdirSync(artifacts, { recursive: true });
    const dock = page.locator('.playbar'), menu = dock.locator('.player-options > .control-popover-panel');
    const choose = async (label, value) => {
      await dock.getByRole('button', { name: '更多播放选项', exact: true }).click();
      const choice = menu.getByRole('radio', { name: label, exact: true });
      await choice.check();
      await page.waitForFunction(value => document.querySelector('.app').dataset.playerStyle === value, value);
      assert(await choice.isChecked());
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
    };
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [768, 1050, 1051, 1250, 1251, 1440, 1775, 1776, 1920, 2031, 2032, 2560]) {
        await setViewport({ width, height: 1000 });
        if (width > 1050) await dock.getByRole('button', { name: '打开播放队列', exact: true }).click();
        let floating;
        for (const [label, value] of [['悬浮播放岛', 'floating'], ['底部长条', 'bar']]) {
          await choose(label, value);
          const bounds = await page.evaluate(() => {
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            const panel = document.querySelector('.app > .queue-panel');
            return { viewport: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, dock: rect(document.querySelector('.playbar')), controls: ['.playbar-now', '.playbar-center', '.playbar-tools'].map(selector => rect(document.querySelector(selector))), tools: rect(document.querySelector('.desktop-tools')), sidebar: rect(document.querySelector('.sidebar')), ...(panel ? { panel: rect(panel), footer: rect(panel.querySelector('.queue-footer')), content: rect(panel.querySelector('.queue-content')) } : {}) };
          });
          assert.equal(bounds.overflow, false, JSON.stringify({ width, value, bounds }));
          if (value === 'floating') floating = bounds.controls;
          else {
            assert.equal(bounds.dock.width, bounds.viewport);
            assert.equal(bounds.dock.bottom, 1000);
            assert.equal(bounds.dock.height, 104);
            for (let index = 0; index < floating.length; index++) for (const key of ['left', 'right', 'top', 'bottom']) {
              assert(Math.abs(bounds.controls[index][key] - floating[index][key]) < 1, 'switching only changes the outer surface: ' + JSON.stringify({ width, index, key, floating: floating[index], bar: bounds.controls[index] }));
            }
          }
          const clears = rect => rect.right <= bounds.dock.left || rect.left >= bounds.dock.right || rect.bottom <= bounds.dock.top;
          assert.equal(bounds.sidebar.bottom, 1000);
          assert(clears(bounds.tools), 'global tools clear ' + value + ' at ' + width);
          if (bounds.panel) {
            assert.equal(bounds.panel.bottom, 1000, 'the queue background reaches the viewport bottom');
            assert(clears(bounds.footer), 'queue actions clear ' + value + ' at ' + width);
            assert(bounds.content.bottom <= bounds.footer.top, 'the list scrolls above its fixed actions');
          }
          if ([1440, 1920, 2560].includes(width)) await page.screenshot({ path: join(artifacts, `${theme}-${value}-${width}.png`) });
        }
        if (width > 1050) await page.getByRole('button', { name: '关闭播放队列', exact: true }).click();
      }
    }
    await page.reload();
    await dock.waitFor();
    assert.equal(await page.locator('.app').getAttribute('data-player-style'), 'bar', 'refresh remembers the shell');
    await setViewport({ width: 390, height: 844 });
    const mini = page.locator('.mobile-mini-player');
    await mini.waitFor();
    assert.equal((await mini.boundingBox()).width, 366, 'the phone keeps its inset mini player');
    assert.equal((await mini.boundingBox()).height, 72);
    assert.equal(await dock.count(), 0, 'desktop shell choices do not render the desktop dock on phones');
    await setViewport({ width: 1440, height: 1000 });
    assert.equal((await dock.boundingBox()).height, 104, 'returning to desktop keeps the saved choice');
    const other = await page.context().newPage();
    try {
      await other.goto('http://127.0.0.1:' + server.address().port);
      await other.locator('.playbar').getByRole('button', { name: '更多播放选项', exact: true }).click();
      await other.getByRole('radio', { name: '悬浮播放岛', exact: true }).check();
      await page.waitForFunction(() => document.querySelector('.app').dataset.playerStyle === 'floating');
    } finally { await other.close(); }
    await page.evaluate(() => localStorage.setItem('slow-listening:player-style:v1', 'unknown'));
    await page.reload();
    await dock.waitFor();
    assert.equal(await page.locator('.app').getAttribute('data-player-style'), 'floating', 'invalid preferences fall back to the current default');
    const blocked = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await blocked.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key === 'slow-listening:player-style:v1') throw new DOMException('Blocked', 'QuotaExceededError'); return original.call(this, key, value); };
      });
      await blocked.goto('http://127.0.0.1:' + server.address().port);
      await blocked.locator('.playbar').getByRole('button', { name: '更多播放选项', exact: true }).click();
      await blocked.getByRole('radio', { name: '底部长条', exact: true }).check();
      await blocked.waitForFunction(() => document.querySelector('.app').dataset.playerStyle === 'bar');
    } finally { await blocked.close(); }
    await choose('悬浮播放岛', 'floating');
  });

  await t.test('appearance stays global across navigation, player and dialogs, survives reload and follows the system', async () => {
    const backgrounds = {
      light:['rgb(243, 240, 233)','rgb(255, 252, 247)'],
      dark:['rgb(27, 25, 22)','rgb(39, 35, 31)'],
    };
    const palettes = [
      { id:'paper', label:'暖纸炭黑', primary:{light:'#252720',dark:'#f2ece1'} },
      { id:'mint', label:'经典薄荷', primary:{light:'#31c27c',dark:'#43d99a'} },
      { id:'ocean', label:'晴樱粉', primary:{light:'#ff6699',dark:'#ff80ab'} },
      { id:'plum', label:'珊瑚红', primary:{light:'#fa233b',dark:'#ff6377'} },
    ];
    const neutralAppearances = new Map();
    const rgb = hex => 'rgb(' + hex.slice(1).match(/../g).map(value => parseInt(value,16)).join(', ') + ')';
    const luminance = color => color.slice(0,3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum,value,index) => sum + value * [.2126,.7152,.0722][index],0);
    const contrast = (first,second) => { const values = [luminance(first),luminance(second)].sort((a,b) => b-a); return (values[0]+.05)/(values[1]+.05); };
    const artifacts = join(root,'test-results/themes');
    mkdirSync(artifacts,{recursive:true});
    for (const palette of palettes) for (const mode of ['light', 'dark']) {
      await openSettings();
      const panel = settingsPanel('appearance');
      await panel.getByRole('button', { name: palette.label, exact: true }).click();
      await panel.getByRole('group', { name: '明暗模式', exact: true }).getByRole('button', { name: mode === 'light' ? '白天' : '黑夜', exact: true }).click();
      assert.equal(await panel.getByRole('group', { name: '明暗模式', exact: true }).getByRole('button', { name: mode === 'light' ? '白天' : '黑夜', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await panel.getByRole('button', { name: palette.label, exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'desktop settings sections sit directly on the page');
      const appearance = await panel.evaluate(el => {
        const style = getComputedStyle(el);
        const context = document.createElement('canvas').getContext('2d');
        const color = value => { context.clearRect(0,0,1,1); context.fillStyle=value; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data]; };
        return {
          neutral: {
            tokens: Object.fromEntries(['bg','surface','text','muted','border','surface-soft','sidebar','raised','control-border','track'].map(name => [name,color(style.getPropertyValue('--'+name))])),
            surfaces: ['.sidebar','.topbar','.playbar'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor),
          },
          colors: Object.fromEntries(['bg','surface','text','muted','accent','accent-text','selected','primary','on-primary','primary-hover','on-accent'].map(name => [name,color(style.getPropertyValue('--'+name))])),
        };
      });
      if (palette.id === 'paper') neutralAppearances.set(mode,appearance.neutral);
      else assert.deepEqual(appearance.neutral,neutralAppearances.get(mode),'palette changes preserve the paper base, panels, text, borders and player');
      const colors = appearance.colors;
      for (const [foreground,background] of [['text','bg'],['text','surface'],['muted','bg'],['muted','surface'],['accent-text','bg'],['accent-text','surface'],['accent-text','selected'],['on-primary','primary'],['on-primary','primary-hover'],['on-accent','accent']]) {
        assert(contrast(colors[foreground],colors[background]) >= 4.5,`${palette.id} ${mode} ${foreground} on ${background} meets text contrast`);
      }
      for (const background of ['bg','surface','selected']) assert(contrast(colors.accent,colors[background]) >= 3,`${palette.id} ${mode} interactive accents remain visible on ${background}`);
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('.playbar .play-toggle')).backgroundColor === expected,rgb(palette.primary[mode]));
      for (const previewMode of ['light','dark']) {
        const preview = panel.locator('.theme-options .theme-preview[data-palette="'+palette.id+'"][data-theme="'+previewMode+'"]');
        assert.equal(await preview.evaluate(el => getComputedStyle(el).backgroundColor),backgrounds[previewMode][0],'previews use their own neutral mode regardless of the page mode');
        assert.equal(await preview.locator('.theme-preview-content>span').first().evaluate(el => getComputedStyle(el).backgroundColor),backgrounds[previewMode][1]);
        assert.equal(await preview.locator('.theme-preview-content').evaluate(el => getComputedStyle(el).borderTopColor),rgb(palette.primary[previewMode]),'previews show the actual primary action color');
      }
      await page.screenshot({path:join(artifacts,palette.id+'-'+mode+'.png'),fullPage:true,animations:'disabled'});
      assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),mode === 'light' ? '#F3F0E9' : '#1B1916');
      await page.getByRole('button', { name:'粘贴链接', exact:true }).click();
      const dialog = page.getByRole('dialog', { name:'粘贴链接', exact:true });
      await dialog.waitFor();
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor),backgrounds[mode][1],'dialogs share the neutral panel background');
      await dialog.getByRole('button', { name:'关闭', exact:true }).click();
      await closeSettings();
      for (const name of ['音乐榜单', '歌单', '关注', '发现']) {
        await navigate(page, name);
        assert.equal(await page.locator('html').getAttribute('data-theme'), mode, name);
        assert.equal(await page.locator('html').getAttribute('data-palette'), palette.id, name);
        assert.equal(await page.locator('.app').evaluate(el => getComputedStyle(el).backgroundColor), backgrounds[mode][0]);
      }
      await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), mode, 'independent player inherits appearance');
      assert.equal(await page.locator('.app').evaluate(el => getComputedStyle(el).backgroundColor), backgrounds[mode][0]);
      assert.equal(await page.locator('.playing-title h2').getAttribute('title'), part.title, 'appearance changes preserve the current song');
      await page.reload();
      await page.locator('.app').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), mode, 'reload restores preference');
      assert.equal(await page.locator('html').getAttribute('data-palette'), palette.id, 'reload restores palette');
      await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light' });
      assert.equal(await page.locator('html').getAttribute('data-theme'), mode, 'manual appearance ignores system changes');
    }
    await openSettings();
    await settingsPanel('appearance').getByRole('button', { name: '跟随系统', exact: true }).click();
    const automatic=await page.evaluate(()=>{const hour=new Date().getHours();return hour>=18||hour<6?'dark':'light';});
    assert.equal(await page.locator('html').getAttribute('data-theme'), automatic, 'following a light system still darkens at night');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'plum', 'system changes preserve the palette');
    await setViewport({ width: 320, height: 740 });
    await page.locator('.mobile-settings:not([hidden])').waitFor();
    assert.equal(await settingsPanel('appearance').evaluate(el => el.scrollWidth > el.clientWidth), false, 'appearance options fit a narrow phone');
    assert.equal(await page.locator('.mobile-theme-options button').count(), 4);
    assert(await page.locator('.mobile-theme-options button').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 48)));
    assert(await page.locator('.mobile-theme-modes button').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 48)));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no horizontal scrolling on the settings page at 320px');
    assert.equal(await page.locator('.mobile-header h1').textContent(), '外观与主题', 'phone settings use a dedicated section header');
    await page.screenshot({path:join(artifacts,'phone-320.png'),fullPage:true});
    await closeSettings();
    await navigate(page, '歌单');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no horizontal scrolling at 320px');
    await setViewport({ width: 1440, height: 1000 });
  });

  await t.test('settings sections keep their state: an unsaved recommendation draft and the diagnostics panel survive switching', async () => {
    await setViewport({ width: 1440, height: 1000 });
    await openSettings();
    const nav = page.locator('.settings-nav');
    const rules = settingsPanel('recommendation');
    await nav.getByRole('button', { name: '推荐偏好', exact: true }).click();
    await rules.locator('.recommendation-advanced>summary').click();
    await rules.getByLabel('包含关键词').fill('未保存草稿');
    await nav.getByRole('button', { name: '诊断与数据', exact: true }).click();
    assert.equal(await rules.isVisible(), false, 'inactive settings panels leave the page');
    const diagnostics = settingsPanel('diagnostics');
    assert.equal(await diagnostics.locator('.diagnostics-advanced').getAttribute('open'), null, 'technical details are collapsed by default');
    await diagnostics.locator('.diagnostics-advanced>summary').click();
    await diagnostics.getByText('服务端 SQLite 条件事务', { exact: true }).waitFor();
    assert.equal(await diagnostics.locator('.diagnostics dd').first().textContent(), 'fixture');
    assert(await diagnostics.getByRole('button', { name: '停止播放并释放来源', exact: true }).isVisible());
    await nav.getByRole('button', { name: '推荐偏好', exact: true }).click();
    assert.equal(await rules.getByLabel('包含关键词').inputValue(), '未保存草稿', 'an unsaved draft survives a section switch');
    const settingsEntry = page.locator('.desktop-tools button[aria-label="设置"]');
    assert.equal(await settingsEntry.getAttribute('aria-current'), 'page', 'the gear marks the settings page as current');
    assert.notEqual(await settingsEntry.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'the current settings entry is visibly marked');
    const before = statusCalls;
    await page.getByRole('button', { name: '设置', exact: true }).click();
    for (let attempt = 0; attempt < 50 && statusCalls === before; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert(statusCalls > before, 'clicking the gear while settings is already open reloads diagnostics');
    await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
    await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
    assert(await page.locator('.settings-view').isVisible(),'the player returns to the settings page it was opened from');
    await closeSettings();
    assert.equal(await page.locator('.settings-view').count(),0,'settings can still return to the original music page');
    await navigate(page, '发现');
  });

  await t.test('recommendation preferences preview the real rules, preserve drafts and fit both themes on phones', async () => {
    await openSettings('推荐偏好');
    const panel=settingsPanel('recommendation'), save=panel.getByRole('button',{name:'保存偏好',exact:true});
    await panel.getByLabel('偏好关键词').waitFor();
    assert.equal(await panel.locator('.recommendation-advanced').getAttribute('open'),null);
    assert.equal(await panel.locator('.recommendation-compatibility').getAttribute('open'),null);
    assert.equal(await save.isEnabled(),false);
    await page.route('**/api/recommendation/preview',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{code:'not-found'}})}));
    await panel.getByRole('button',{name:'预览效果',exact:true}).click();
    await panel.getByText('这个栏目还没有可预览的音乐。',{exact:false}).waitFor();
    assert.equal(await save.isEnabled(),false,'a missing candidate pool cannot enable saving');
    await page.unroute('**/api/recommendation/preview');
    await panel.getByLabel('偏好关键词').fill('现场');
    assert.equal(await panel.getByLabel('推荐顺序').inputValue(),'score','first preference enables its effective ordering');
    await panel.getByLabel('排除关键词').fill('伴奏');
    await panel.getByRole('button',{name:'预览效果',exact:true}).click();
    await panel.locator('.recommendation-preview').waitFor();
    assert.equal(await panel.locator('.preview-list li').count(),3,'the exclusion removes only the matching track');
    assert.equal(await panel.locator('.preview-list strong').first().textContent(),'Music · 现场','the preferred track moves ahead of the original first result');
    assert.equal(await save.isEnabled(),true);
    const artifacts=join(root,'test-results/recommendation-preferences');mkdirSync(artifacts,{recursive:true});
    for(const theme of ['light','dark']) {
      await setViewport({width:1440,height:1000});
      await page.locator('.settings-view').waitFor();
      await page.locator('.settings-nav').getByRole('button',{name:'外观',exact:true}).click();
      await page.locator('.theme-mode-options').getByRole('button',{name:theme==='light'?'白天':'黑夜',exact:true}).click();
      await page.locator('.settings-nav').getByRole('button',{name:'推荐偏好',exact:true}).click();
      await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
      for(const width of [1440,1100,390,320]) {
        await setViewport({width,height:width<760?900:1100});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,theme+' '+width+' fits the viewport');
        if(width<760) {
          await panel.getByRole('button',{name:'预览效果',exact:true}).waitFor();
          assert(await panel.locator('.recommendation-actions button').evaluateAll(elements=>elements.every(el=>el.getBoundingClientRect().height>=44)),'phone actions keep their touch targets');
        }
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:join(artifacts,theme+'-'+width+'.png'),fullPage:true});
      }
    }
    await setViewport({width:1440,height:1000});
    await page.locator('.settings-nav').getByRole('button',{name:'推荐偏好',exact:true}).click();
    // The two layouts mount separate forms; recreate the desktop draft before previewing it.
    await panel.getByLabel('偏好关键词').fill('现场');
    await panel.getByLabel('排除关键词').fill('伴奏');
    await panel.getByLabel('排除关键词').fill('伴奏\n其他');
    assert.equal(await save.isEnabled(),false,'a changed draft requires a new preview');
    await panel.getByRole('button',{name:'预览效果',exact:true}).click();
    await panel.locator('.recommendation-preview').waitFor();
    await save.click();await panel.getByText('已保存；下一次推荐生效。',{exact:true}).waitFor();
    assert.deepEqual(recommendationSaves.at(-1).patch.overrides,recommendationPreviews.at(-1).overrides,'the saved document is exactly the previewed draft');
    assert.deepEqual(Object.keys(recommendationSaves.at(-1).patch.overrides).sort(),['exclude','order','preferences'],'untouched fields continue to inherit defaults');
    await panel.getByLabel('推荐顺序').selectOption('random');
    await panel.getByLabel('偏好关键词').fill('现场\n录音');
    assert.equal(await panel.getByLabel('推荐顺序').inputValue(),'random','editing an existing preference preserves an explicit order');
    await panel.getByRole('button',{name:'启用偏好排序',exact:true}).click();
    assert.equal(await panel.getByLabel('推荐顺序').inputValue(),'score');
    await panel.getByLabel('推荐栏目').selectOption('youtube-music-selection');
    await page.waitForFunction(()=>document.querySelector('[aria-label="偏好关键词"]')?.value==='');
    assert.equal(await save.isEnabled(),false,'column changes discard the other column preview');
    const state=recommendationState('youtube-music-selection');
    const complex={preferences:[{id:'custom-weight',fields:['title'],mode:'any',terms:['现场'],weight:7}],order:'score'};
    state.document.overrides=complex;
    await panel.getByRole('button',{name:'撤销修改',exact:true}).click();
    const editor=panel.getByLabel('完整个人覆盖 JSON');await editor.waitFor();
    assert.deepEqual(JSON.parse(await editor.inputValue()),complex,'complex documents automatically open the complete editor');
    assert.equal(await panel.getByLabel('偏好关键词').isEnabled(),false,'the simple editor cannot overwrite a complex document');
    await panel.getByRole('checkbox',{name:'编辑完整个人覆盖',exact:true}).click();
    assert.equal(await editor.isVisible(),true,'unsupported simple conversion preserves the complete document');
    await editor.fill('{}');
    await panel.getByRole('button',{name:'预览效果',exact:true}).click();await panel.locator('.recommendation-preview').waitFor();
    await save.click();await panel.getByText('已保存；下一次推荐生效。',{exact:true}).waitFor();
    await panel.getByLabel('推荐栏目').selectOption('music-recommendation');
    await page.waitForFunction(()=>document.querySelector('[aria-label="偏好关键词"]')?.value==='现场');
    assert.equal(await panel.getByLabel('排除关键词').inputValue(),'伴奏\n其他','the previously saved column remains independent');
    await setViewport({width:320,height:900});
    await page.locator('.mobile-settings:not([hidden])').waitFor();
    await panel.locator('.recommendation-advanced>summary').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'expanded advanced fields also fit 320px');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:join(artifacts,'advanced-320.png'),fullPage:true});
    await setViewport({width:1440,height:1000});
    await closeSettings();await navigate(page,'发现');
  });

  await t.test('a fixed-batch shelf confirms everything it displays with the current batch token',async()=>{
    await navigate(page,'发现');const shelf=page.locator('[data-shelf-id="music-recommendation"]');
    await page.waitForFunction(()=>!document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled);
    assert.equal(await shelf.getByLabel('栏目 0展示数量').count(),0,'the B站 recommendation column has no count choice');
    const whole=page.waitForResponse(r=>r.url().endsWith('/api/recommendation/confirm')&&r.request().postDataJSON().column==='music-recommendation'&&r.request().postDataJSON().ids.length===12);
    await shelf.getByRole('button',{name:'栏目 0换一批',exact:true}).click();
    const last=(await whole).request().postDataJSON();
    assert.equal(last.ids.length,12,'only the visible songs are confirmed');
    assert(confirmations.length>0&&confirmations.every(confirmation=>confirmation.token&&confirmation.column==='music-recommendation'),'every confirmation carries the current batch token');
    await page.waitForFunction(()=>!document.querySelector('[data-shelf-id="music-recommendation"] .shelf-refresh').disabled);
  });

  await t.test('processed default results are visibly distinguished from the original source order',async()=>{
    await navigate(page,'发现');
    const shelf=page.locator('[data-shelf-id="music-recommendation"]'),note=shelf.locator('.recommendation-order');
    assert((await note.textContent()).includes('来源原顺序'));
    displayProcessed=true;await shelf.getByRole('button',{name:'栏目 0换一批',exact:true}).click();
    await note.getByText('筛选／去重／排序后的结果',{exact:false}).waitFor();
    assert(!(await note.textContent()).includes('来源原顺序'));
    displayProcessed=false;await page.reload();await page.locator('.music-card').first().waitFor();
  });

  await t.test('visible refresh replaces only B站 recommendations and remains usable on phones',async()=>{
    await navigate(page,'发现');const recommended=page.locator('[data-shelf-id="music-recommendation"]');
    const before=discoveryCalls,chartBefore=chartCalls.length;discoveryMode='changed';
    const refresh=recommended.getByRole('button',{name:'栏目 0换一批',exact:true});await refresh.click();
    await recommended.getByText('换批后的音乐',{exact:true}).waitFor();assert.equal(discoveryCalls,before+1);
    assert((await recommended.locator('.catalog-meta [role="status"]').innerText()).includes('1 首新音乐'));
    await refresh.click();await recommended.getByText('B站本次返回相同的音乐',{exact:false}).waitFor();
    assert.equal(chartCalls.length,chartBefore);assert.equal(await page.locator('[data-shelf-id="hot-chart"],[data-shelf-id="new-music"]').count(),0);
    await setViewport({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const mobileRefresh=recommended.getByRole('button',{name:'换一批音乐',exact:true});
    assert((await mobileRefresh.boundingBox()).height>=48);
    await mobileRefresh.click();await setViewport({width:1440,height:1000});
    discoveryMode='same';await page.reload();await page.locator('.music-card').first().waitFor();
  });

  await t.test('unavailable status is visible beside desktop and mobile track metadata', async () => {
    await page.reload();
    await navigate(page, '歌单');
    await selectPlaylist(page, '失效歌曲歌单');
    const warning = page.getByText('已失效 · 内容不存在或无法访问', { exact: true });
    await warning.waitFor();
    assert(await warning.isVisible());
    assert(await page.locator('.song-library-row .row-sub').isVisible());
    await setViewport({ width: 390, height: 844 });
    assert(await warning.isVisible());
    assert(await page.locator('.song-library-row .row-sub').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await setViewport({ width: 1440, height: 1000 });
  });

  await t.test('acceptance helpers operate playlist menus, queue drawers and the independent player page', async () => {
    await page.locator('.song-library-row').filter({hasText:part.title}).first().getByRole('button',{name:'更多操作 '+part.title,exact:true}).click();await page.locator('.song-row-menu [popover]:popover-open').getByRole('menuitem',{name:'编辑歌曲 '+part.title,exact:true}).click();const menu=page.getByRole('dialog',{name:'歌曲与版本'});
    await menu.getByRole('tab', { name: '播放版本', exact: true }).waitFor();
    assert(await menu.getByRole('tab', { name: '播放版本', exact: true }).isVisible());
    await menu.getByRole('button', { name: '关闭', exact: true }).click();
    await createPlaylist(page, '新验收歌单');
    await selectPlaylist(page, '新验收歌单');
    assert.equal(await page.locator('.playlist-copy :is(h1,h2)').textContent(), '新验收歌单');
    await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
    const firstActions = await queueTrackMenu(page, part.title);
    await firstActions.getByRole('menuitem', { name: '下移', exact: true }).click();
    const actions = await queueTrackMenu(page, second.title);
    assert.equal(await page.locator('.queue-actions [popover]:popover-open').count(), 1);
    assert.equal(await page.locator('.queue-track-main strong').first().getAttribute('title'), second.title);
    await actions.getByRole('menuitem', { name: '从播放队列移除', exact: true }).click();
    assert.equal(await page.locator('.queue-track').count(), 1);
    await page.getByRole('button', { name: '关闭播放队列', exact: true }).click();
    await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
    assert.equal(await page.locator('.playing-title h2').getAttribute('title'), part.title);
    await setViewport({ width: 1024, height: 768 });
    await navigate(page, '歌单');
    await setViewport({ width: 390, height: 844 });
    await selectPlaylist(page, '失效歌曲歌单');
    await navigate(page, '发现');
    await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
    const queueOpener=page.getByRole('button',{name:'播放队列',exact:true});
    await queueOpener.click();
    assert(await page.locator('.queue-panel').isVisible());
    const drawer=page.getByRole('dialog',{name:'播放队列',exact:true});
    assert(await drawer.isVisible(),'a phone queue is a modal drawer');
    const queued=await queueTrackMenu(page,part.title);
    await page.keyboard.press('Escape');
    assert.equal(await queued.locator('[popover]').isVisible(),false,'Escape first dismisses the track popover');
    assert(await drawer.isVisible(),'dismissing the popover keeps the queue open');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.queue-panel').isVisible(), false);
    assert.equal(await queueOpener.evaluate(el=>el===document.activeElement),true,'closing the modal restores focus to its opener');
    await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
  });
  await t.test('the player fits phones, tablets and desktops; queue dialogs trap focus and options stay reachable',async()=>{
    for(const width of [320,390,768,1024,1260,1440]){
      await setViewport({width,height:844});
      await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'the listening page fits '+width+'px');
      if(width>1050){
        await page.getByRole('button',{name:'播放队列',exact:true}).click();
        assert.equal(await page.locator('.queue-content').evaluate(el=>el.scrollWidth>el.clientWidth),false,'long queue titles fit the desktop panel');
        await page.getByRole('button',{name:'关闭播放队列',exact:true}).click();
      }
      assert(await page.locator(width>760?'.stage-controls':'.mobile-player-tools').evaluate(el=>[...el.children].every(child=>child.getBoundingClientRect().right<=el.getBoundingClientRect().right+1)),'auxiliary controls fit their group at '+width+'px');
      assert(await page.getByRole('button',{name:'下一首',exact:true}).isVisible());
      if(width<=760)assert(await page.locator('.listening-transport button').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().width>=44&&el.getBoundingClientRect().height>=44)),'all main playback targets are at least 44px');
      if(width===768){
        await page.getByRole('button',{name:'播放队列',exact:true}).click();
        const drawer=page.getByRole('dialog',{name:'播放队列',exact:true});
        assert.equal(await drawer.locator('.queue-content').evaluate(el=>el.scrollWidth>el.clientWidth),false,'long queue titles fit the drawer');
        for(let index=0;index<12;index++){
          await page.keyboard.press('Tab');
          assert(await drawer.evaluate(el=>el.contains(document.activeElement)),'Tab stays inside the queue dialog');
        }
        await page.keyboard.press('Escape');
        assert.equal(await drawer.count(),0);
      }
      await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'the dock fits '+width+'px');
      if(width>760){
        assert(await page.locator('.playbar-tools').evaluate(element => [...element.children].filter(child => child.getClientRects().length).every(child => child.getBoundingClientRect().right <= innerWidth)), 'dock tools fit ' + width + 'px');
        await page.locator('.playbar').getByRole('button',{name:'更多播放选项',exact:true}).click();
        const options=page.locator('.playbar .player-options > .control-popover-panel');
        assert.equal(await options.getByRole('button',{name:'播放速度',exact:true}).isVisible(), width<=1250);
        assert.equal(await options.getByRole('button',{name:'睡眠定时器',exact:true}).isVisible(), width<=1250);
        if(width<=1250){
          await selectRate(options, 1.5);
          assert(await options.isVisible(), 'choosing a speed keeps the parent options open');
          await options.getByRole('button',{name:'播放速度',exact:true}).click();
          await options.getByRole('menu',{name:'播放速度',exact:true}).waitFor();
          await page.keyboard.press('Escape');
          assert(await options.isVisible(), 'Escape dismisses the nested speed menu first');
          await selectRate(options, 1);
        }
        await page.keyboard.press('Escape');
        assert.equal(await options.isVisible(),false);
      }
    }
  });
  await t.test('timer controls remain usable in both themes and narrow screens', async () => {
    const artifacts = join(root, 'test-results/player-controls');
    mkdirSync(artifacts, { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390, 320]) {
        await setViewport({ width, height: 1000 });
        await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
        const stage = page.locator(width>760?'.listening-stage':'.mobile-player');
        await stage.waitFor();
        assert.equal(await stage.getByRole('button', { name: '播放模式', exact: true }).count(), 1);
        if(width<=760)await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
        await selectRate(page, 1.25);
        await page.waitForFunction(() => document.querySelector('audio').playbackRate === 1.25);
        assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 1.25, 'speed changes apply before a song starts');
        await page.getByRole('button', { name: '播放速度', exact: true }).click();
        const rateMenu = page.getByRole('menu', { name: '播放速度', exact: true });
        await rateMenu.waitFor();
        assert(await rateMenu.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; }), 'speed menu fits ' + width + 'px');
        assert.equal(await rateMenu.getByRole('menuitemradio', { name: '1.25×', exact: true }).getAttribute('aria-checked'), 'true');
        await page.screenshot({ path: join(artifacts, `${theme}-${width}-speed.png`) });
        if (width === 1440) {
          const menuBounds = await rateMenu.boundingBox(), triggerBounds = await stage.getByRole('button', { name: '播放速度', exact: true }).boundingBox();
          const x = Math.max(0, Math.min(menuBounds.x, triggerBounds.x) - 8), y = Math.max(0, Math.min(menuBounds.y, triggerBounds.y) - 8);
          await page.screenshot({ path: join(artifacts, `${theme}-speed-detail.png`), clip: { x, y, width: Math.max(menuBounds.x + menuBounds.width, triggerBounds.x + triggerBounds.width) - x + 8, height: Math.max(menuBounds.y + menuBounds.height, triggerBounds.y + triggerBounds.height) - y + 8 } });
        }
        await page.keyboard.press('Escape');
        if(width<=760)await page.keyboard.press('Escape');
        await page.screenshot({ path: join(artifacts, `${theme}-${width}-player.png`), fullPage: true });
        await stage.getByRole('button', { name: '睡眠定时器', exact: true }).click();
        const sleep = page.getByRole('dialog', { name: '睡眠定时器', exact: true });
        await sleep.locator('[data-field="duration"]').fill('45');
        await sleep.locator('[data-action="start-timer"]').click();
        await sleep.locator('.sleep-summary.is-running').waitFor();
        assert.equal(await sleep.evaluate(element => element.scrollWidth > element.clientWidth), false, 'timer fits ' + width + 'px');
        await page.screenshot({ path: join(artifacts, `${theme}-${width}-timer.png`) });
        await sleep.locator('[data-action="cancel-timer"]').click();
        await sleep.getByRole('button', { name: '关闭', exact: true }).click();
        if(width<=760)await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
        await selectRate(page, 1);
        if(width<=760)await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
      }
    }
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await setViewport({ width: 1440, height: 1000 });
  });
  await t.test('speed menus support keyboard selection, light dismissal and focus return', async () => {
    // Finish the preceding phone-to-desktop resize; popovers deliberately dismiss on resize/scroll.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const dock = page.locator('.playbar'), button = dock.getByRole('button', { name: '播放速度', exact: true });
    await button.focus();
    await button.press('ArrowDown');
    const menu = dock.getByRole('menu', { name: '播放速度', exact: true });
    await menu.waitFor();
    await menu.getByRole('menuitemradio', { name: '1×', exact: true }).waitFor();
    assert.equal(await menu.getByRole('menuitemradio', { name: '1×', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 1.25);
    assert.equal(await button.evaluate(element => element === document.activeElement), true);
    await button.press('ArrowUp');
    await menu.waitFor();
    await page.keyboard.press('End');
    assert.equal(await menu.getByRole('menuitemradio', { name: '2×', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Home');
    assert.equal(await menu.getByRole('menuitemradio', { name: '0.5×', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await button.evaluate(element => element === document.activeElement), true);
    await button.click();
    await menu.waitFor();
    await page.locator('h1').click();
    await menu.waitFor({ state: 'hidden' });
    await button.click();
    await menu.waitFor();
    await page.keyboard.press('Tab');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await page.locator(':popover-open').count(), 0);
    await selectRate(dock, 1);
  });
  await t.test('QR polling recovers from a transient error without generating a new challenge', async () => {
    await setViewport({width:1440,height:1000});
    await openSettings('B站账号');
    const dialog=settingsPanel('account');
    pollFailures.push('network');loginPhase='pending';
    const firstPoll=pollCalls.length;
    await dialog.getByRole('button',{name:'扫码登录 B站',exact:true}).click();
    await dialog.getByRole('img',{name:'B站登录二维码'}).waitFor();
    const index=qrIndex;
    await dialog.getByRole('alert').waitFor();
    loginPhase='authenticated';
    await dialog.getByText('测试音乐账号',{exact:true}).waitFor();
    assert.equal(qrIndex,index,'recovery reuses the original QR challenge');
    assert(pollCalls.length>=firstPoll+2);
    assert(pollCalls.slice(firstPoll).every(id=>id==='fixture-qr-'+index));
    assert.equal(await dialog.getByRole('alert').count(),0,'a successful poll clears the transient error');
    await dialog.getByRole('button',{name:'退出B站账号',exact:true}).click();
    await dialog.getByText('未登录 · 使用匿名音乐栏目',{exact:true}).waitFor();
    await closeSettings();
    await page.getByRole('heading',{name:'栏目 0',exact:true}).waitFor();
    loginPhase='pending';
  });
  await t.test('B站扫码登录: offline QR, scanned confirmation, personalized discovery, cancellation and disconnect', async () => {
    await setViewport({width:1440,height:1000});
    await openSettings('外观');
    await page.getByRole('group',{name:'明暗模式',exact:true}).getByRole('button',{name:'白天',exact:true}).click();
    await page.locator('.settings-nav').getByRole('button',{name:'B站账号',exact:true}).click();
    const dialog=settingsPanel('account');
    await dialog.getByRole('button',{name:'扫码登录 B站',exact:true}).click();
    const qr=dialog.getByRole('img',{name:'B站登录二维码'});
    await qr.waitFor();
    assert.match(await qr.getAttribute('src'),/^data:image\/png;base64,/,'QR is generated locally');
    const artifacts=join(root,'test-results/bilibili-login');mkdirSync(artifacts,{recursive:true});
    await qr.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(artifacts,'desktop-light-qr.png')});
    await page.locator('.settings-nav').getByRole('button',{name:'外观',exact:true}).click();
    await page.locator('.theme-mode-options').getByRole('button',{name:'黑夜',exact:true}).click();
    await page.locator('.settings-nav').getByRole('button',{name:'B站账号',exact:true}).click();
    await qr.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(artifacts,'desktop-dark-qr.png')});
    await setViewport({width:320,height:740});
    await dialog.getByRole('button',{name:'扫码登录 B站',exact:true}).click();
    await qr.waitFor();
    await qr.scrollIntoViewIfNeeded();
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'account controls fit a narrow phone');
    assert((await qr.boundingBox()).width<=240);
    await page.screenshot({path:join(artifacts,'phone-dark-qr.png')});
    loginPhase='scanned';
    await dialog.getByText('已扫码，请在B站客户端确认登录。',{exact:true}).waitFor();
    loginPhase='authenticated';
    await dialog.getByText('测试音乐账号',{exact:true}).waitFor();
    assert.equal(await qr.count(),0);
    await dialog.getByText('已登录 · 音乐推荐、音轨与收藏夹',{exact:true}).waitFor();
    assert(!(await page.evaluate(()=>JSON.stringify({...localStorage}))).includes('SESSDATA'));
    await page.screenshot({path:join(artifacts,'phone-dark-authenticated.png')});
    await openSettings('推荐偏好');
    assert.equal(await settingsPanel('recommendation').getByLabel('推荐栏目').inputValue(),'account-recommendation','a logged-in account defaults to the recommendation column it actually uses');
    await closeSettings();
    await page.getByRole('heading',{name:'为你推荐',exact:true}).waitFor();
    await setViewport({width:1440,height:1000});
    await page.getByRole('heading',{name:'为你推荐 · B站账号',exact:true}).waitFor();
    await openSettings('B站账号');
    loginPhase='pending';
    await dialog.getByRole('button',{name:'更换B站账号',exact:true}).click();
    await qr.waitFor();
    const pendingId='fixture-qr-'+qrIndex;
    const cancelledRequest=page.waitForResponse(r=>r.url().endsWith('/api/bilibili/cancel')&&r.request().postDataJSON()?.id===pendingId);
    await closeSettings();
    await cancelledRequest;
    assert(cancellations.includes(pendingId),'closing settings cancels the outstanding login');
    await openSettings('B站账号');
    assert(await dialog.getByText('测试音乐账号',{exact:true}).isVisible(),'cancel preserves the previous account');
    loginPhase='expired';pollFailures.push('timeout');
    await dialog.getByRole('button',{name:'更换B站账号',exact:true}).click();
    await qr.waitFor();
    await dialog.getByRole('alert').waitFor();
    await dialog.getByText('二维码已过期，请重新生成。',{exact:true}).waitFor();
    assert.equal(await qr.count(),0);
    assert.equal(await dialog.getByRole('alert').count(),0,'expiry still completes after a transient timeout');
    await dialog.getByRole('button',{name:'退出B站账号',exact:true}).click();
    await dialog.getByText('未登录 · 使用匿名音乐栏目',{exact:true}).waitFor();
    await closeSettings();
    await page.getByRole('heading',{name:'栏目 0',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'为你推荐 · B站账号',exact:true}).count(),0);
  });
  await t.test('YouTube music discovery: region persistence, stale requests, batch refresh, failure recovery and mobile layout',async()=>{
    youtubeAvailable=true;
    await setViewport({width:1440,height:1000});
    await page.reload();
    const youtube=page.locator('[data-shelf-id="youtube-music-selection"]');
    await youtube.getByText('HK精选 1',{exact:true}).waitFor();
    assert.equal(await page.locator('.discovery-shelf').count(),3,'the default view has recommendations and recent updates');
    assert.equal(await youtube.getByLabel('YouTube 音乐区地区').inputValue(),'HK');
    assert.equal(await youtube.locator('.music-card').count(),12);
    assert.equal(await youtube.locator('select[aria-label$="展示数量"]').count(),0);
    assert(confirmations.filter(c=>c.column==='youtube-music-selection').every(c=>c.ids.length<=12));
    const youtubeInfo=youtube.getByRole('button',{name:'YouTube 音乐精选栏目说明',exact:true});
    await youtubeInfo.click();
    assert.equal(await youtube.getByRole('link',{name:'Mando Flow',exact:true}).count(),1);
    await youtubeInfo.click();
    await navigate(page,'搜索');
    await navigate(page,'发现');
    await youtube.getByText('HK精选 1',{exact:true}).waitFor();
    assert.equal(await youtube.locator('.music-card').count(),12,'leaving and returning to the discover page keeps the chosen count');
    await youtube.getByLabel('YouTube 音乐区地区').selectOption('US');
    await youtube.getByText('US精选 1',{exact:true}).waitFor();
    await page.reload();
    await youtube.getByText('US精选 1',{exact:true}).waitFor();
    assert.equal(await youtube.getByLabel('YouTube 音乐区地区').inputValue(),'US');
    const slow=page.waitForRequest(request=>request.url().includes('/api/youtube/music?region=HK'));
    await youtube.getByLabel('YouTube 音乐区地区').selectOption('HK');
    await slow;
    await youtube.getByLabel('YouTube 音乐区地区').selectOption('JP');
    await youtube.getByText('JP精选 1',{exact:true}).waitFor();
    await page.waitForTimeout(250);
    assert.equal(await youtube.getByText('HK精选 1',{exact:true}).count(),0,'a cancelled regional response cannot replace the current region');
    const before=youtubeCalls.length;
    await youtube.getByRole('button',{name:'YouTube 音乐精选换一批',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-shelf-id="youtube-music-selection"] [role="status"]')?.textContent.includes('相同'));
    assert.equal(youtubeCalls.length,before+1);assert.equal(youtubeCalls.at(-1).refresh,'1');
    youtubeFailure=true;
    await youtube.getByRole('button',{name:'YouTube 音乐精选换一批',exact:true}).click();
    const status=youtube.getByRole('button',{name:'YouTube 音乐精选：暂未更新，查看详情',exact:true});
    await status.waitFor();
    assert.equal(await youtube.locator('.music-card').count(),12,'a failed batch keeps the displayed songs');
    youtubeFailure=false;
    await status.click();
    await youtube.locator('.discovery-status-popover [popover]:popover-open').getByRole('button',{name:'重试更新',exact:true}).click();
    await status.waitFor({state:'detached'});
    assert.equal(youtubeCalls.at(-1).region,'JP','the shelf retry refetches the region chosen in the shelf');
    assert.equal(youtubeCalls.at(-1).refresh,'1');
    await setViewport({width:320,height:740});
    await youtube.getByRole('button',{name:'YouTube 音乐精选栏目操作',exact:true}).click();
    const menu=page.getByRole('dialog',{name:'YouTube 音乐精选栏目操作',exact:true});
    await menu.getByLabel('YouTube 音乐区地区').scrollIntoViewIfNeeded();
    assert.equal(await menu.getByLabel('YouTube 音乐区地区').inputValue(),'JP','mobile column settings keep the chosen region');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const artifacts=join(root,'test-results/youtube-discovery');mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:join(artifacts,'phone-320.png')});
    for(const name of ['加入歌单','封面浏览','歌曲列表']){
      const button=menu.getByRole('button',{name,exact:true});
      assert(await button.isVisible(),'mobile column actions have visible labels');
      const bounds=await button.boundingBox();assert(bounds.height>=48&&bounds.width>=48,'mobile column actions keep a 48px touch target');
    }
    await menu.getByRole('button',{name:'封面浏览',exact:true}).click();
    await menu.waitFor({state:'detached'});
  });
  await t.test('saving the YouTube column from the settings page refetches its candidates without the discover shelf', async () => {
    await setViewport({ width: 1440, height: 1000 });
    await openSettings('推荐偏好');
    const panel = settingsPanel('recommendation');
    await panel.getByLabel('推荐栏目').selectOption('youtube-music-selection');
    await panel.getByRole('button', { name: '预览效果', exact: true }).click();
    await panel.locator('.recommendation-preview').waitFor();
    const before = youtubeCalls.length;
    await panel.getByRole('button', { name: '保存偏好', exact: true }).click();
    await page.getByText('已保存；下一次推荐生效。', { exact: true }).waitFor();
    for (let attempt = 0; attempt < 50 && youtubeCalls.length === before; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert(youtubeCalls.length > before, 'saving the YouTube column must refetch its candidates while the discover page is unmounted');
    assert.equal(youtubeCalls.at(-1).refresh, '1');
    assert.equal(youtubeCalls.at(-1).region, 'JP', 'the refetch reuses the region chosen in the discover shelf');
    await closeSettings();
    await navigate(page, '发现');
  });
  await t.test('an endpoint answering with the page document names the build mismatch instead of a network error', async t => {
    await page.route('**/api/discovery/bilibili*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><body>慢听</body></html>' }));
    t.after(() => page.unroute('**/api/discovery/bilibili*'));
    await page.reload();
    const feedback = page.locator('.discovery-unavailable').filter({ hasText: '服务端与当前页面不是同一次构建' });
    await feedback.waitFor();
    assert.match(await feedback.textContent(), /stop\.cmd/, 'the message names the restart entry point');
    await page.unroute('**/api/discovery/bilibili*');
    await feedback.getByRole('button', { name: '重新获取推荐', exact: true }).click();
    await feedback.waitFor({state:'detached'});
    assert.deepEqual((await verifyDefaultDiscovery(page, 3)).map(shelf => shelf.shown), [12, 12, 0], 'the recorded retry returns to the running service');
  });
  await t.test('a running service that predates the dist blocks the page with the restart steps', async () => {
    build = { ...build, stale: true, changed: ['client'], current: { server: build.current.server, client: 2 } };
    await page.reload();
    const notice = page.locator('.build-notice');
    await notice.waitFor();
    await notice.getByRole('heading', { name: '服务端仍是旧构建', exact: true }).waitFor();
    const text = await notice.textContent();
    for (const step of ['stop.cmd', '一键启动.cmd', '重新检查', '访问码']) assert.match(text, new RegExp(step), 'the notice states ' + step);
    assert.equal(await page.locator('.discovery-shelf').count(), 0, 'the mismatched page is not rendered next to the notice');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const artifacts = join(root, 'test-results/build-notice');
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: join(artifacts, 'mismatch.png') });
    build = { ...build, stale: false, changed: [] };
    await notice.getByRole('button', { name: '重新检查', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.build-notice'));
    assert.deepEqual((await verifyDefaultDiscovery(page, 3)).map(shelf => shelf.shown), [12, 12, 0], 'the current build renders once the service reports its own pair');
  });
  assert.deepEqual(errors, []);
});
