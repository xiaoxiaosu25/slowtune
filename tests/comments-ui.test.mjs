import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';

test('desktop player and read-only comments: sort, pagination, replies, failures and mobile drawers', async t => {
  const root = resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.'), artifacts = resolve(process.env.MUSIC_APP_TEST_ARTIFACTS ?? 'local/verification/comments-player-2026-10-13'); mkdirSync(artifacts, { recursive: true });
  const track = { ref: { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' }, resourceId: 'bilibili-test', title: '【孙燕姿】精选歌单合集《尚好的青春》《我怀念的》《180度》《雨还是不停地落下》《绿光》完整音乐视频', artwork: 'https://i1.hdslb.com/fixture-cover.png', uploader: { name: 'Music_精选合集' }, durationSeconds: 2654 };
  const second = { ...track, ref: { provider: 'youtube', kind: 'video', id: 'kK0CRZ0wvvc' }, resourceId: 'youtube-test', title: 'YouTube 音乐视频' };
  const calls = []; let failMore = false;
  const item = (id, order = 'hot') => ({ id, author: '@读者 ' + id, text: `${order === 'hot' ? '热门评论' : '最新评论'} ${id}\n<script>原样显示</script> 音乐让日常有了不同的色彩。`.repeat(2), time: '2026/10/13', likes: '12', ...(id === '1' ? { replyCount: '2', replyCursor: 'reply' } : {}) });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status') return json({ version: 'fixture', providers: { youtube: { enabled: true, available: false } }, delivery: { leases: 0 }, tool: {}, build: { stale: false } });
    if (url.pathname === '/v1/handshake') return json({ protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata','discover','prepare'], limitations: [], anonymous: true }, { provider: 'youtube', operations: ['metadata','prepare'], limitations: [], anonymous: true }] });
    if (url.pathname === '/api/song-library') return json({ revision: '1', snapshot: { format:'slowtune-library',version:1,songs:[],versions:[],catalogLinks:[],redirects:[], playlists: [], favorites: [] } });
    if (url.pathname === '/api/follows') return json({ revision: '1', creators: [] });
    if (url.pathname === '/api/bilibili/account') return json({ state: 'anonymous' });
    if (url.pathname === '/api/discovery/bilibili') return json([]);
    if (url.pathname === '/api/bilibili/chart') return json({ periods: [{ id: 1, number: 1, publishedAt: 1 }], period: { id: 1, number: 1, publishedAt: 1 }, shelf: { id: 'hot-chart', title: 'B站热歌榜', kind: 'chart', page: { items: [] } } });
    if (url.pathname === '/api/comments') {
      assert.equal(req.method, 'GET'); const params = Object.fromEntries(url.searchParams); calls.push(params);
      if (params.parent) return json({ status: 'available', items: [item('reply-1'), item('reply-2')] });
      if (params.cursor && failMore) return json({ error: { code: 'network' } }, 503);
      await new Promise(resolve => setTimeout(resolve, params.order === 'new' ? 80 : 10)); if (res.destroyed) return;
      return json({ status: 'available', total: '42', items: params.cursor ? [item('21', params.order)] : Array.from({ length: 20 }, (_, index) => item(String(index + 1), params.order)), ...(params.cursor ? {} : { nextCursor: 'next' }) });
    }
    if (url.pathname === '/v1/call/metadata') { let body = ''; for await (const chunk of req) body += chunk; const input = JSON.parse(body); return json({ protocol: 2, result: input.ref?.provider === 'youtube' ? second : track }); }
    if (url.pathname.startsWith('/v1/')) return json({ protocol: 2, error: { code: 'unsupported', retryable: false } }, 400);
    try { const path = join(root, 'dist/client', url.pathname === '/' ? 'index.html' : url.pathname); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream'); res.end(readFileSync(path)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1920, height: 880 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://i1.hdslb.com/fixture-cover.png', route => route.fulfill({ contentType: 'image/png', body: readFileSync(join(root, 'dist/client/assets/coast.png')) }));
  await page.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord([track,second]));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  assert.equal(calls.length, 0, 'comments only load on opening');
  const measurements = [];
  for (const [width, height] of [[1920,880],[1440,900],[1100,768],[1024,600],[800,600]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.listening-stage').waitFor();
    const bounds = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
      return { width: innerWidth, height: innerHeight, docHeight: document.documentElement.scrollHeight, docWidth: document.documentElement.scrollWidth, stage: rect(document.querySelector('.listening-stage')), controls: rect(document.querySelector('.stage-controls')), title: rect(document.querySelector('.playing-title')), transport: rect(document.querySelector('.listening-transport')), art: rect(document.querySelector('.playing-art-frame')), header: rect(document.querySelector('.listening-header')) };
    });
    assert(bounds.docHeight <= height + 1 && bounds.docWidth <= width + 1, JSON.stringify(bounds));
    for (const name of ['controls','title','transport','art']) assert(bounds[name].top >= bounds.stage.top && bounds[name].bottom <= bounds.stage.bottom + 1 && bounds[name].left >= 0 && bounds[name].right <= width, name + ': ' + JSON.stringify(bounds));
    await page.screenshot({ path: join(artifacts, `player-${width}x${height}.png`) });
    const options = page.locator('.listening-stage .player-options');
    await options.getByRole('button', { name: '更多播放选项', exact: true }).click();
    const menu = options.locator('.control-popover-panel:popover-open'); await menu.waitFor();
    await page.waitForFunction(() => document.querySelector('.listening-stage .player-options button').getAttribute('aria-expanded') === 'true');
    const menuBounds = await menu.evaluate(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }; });
    assert(menuBounds.top >= 12 && menuBounds.bottom <= height - 12 + 1 && menuBounds.left >= 12 && menuBounds.right <= width - 12 + 1, 'playback options: ' + JSON.stringify({ width, height, ...menuBounds }));
    measurements.push({ ...bounds, options: menuBounds });
    if (height < 660) {
      for (const control of [menu.getByRole('button', { name: '快退 10 秒', exact: true }), menu.getByRole('button', { name: '快进 10 秒', exact: true }), menu.getByRole('slider', { name: '音量', exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        const reachable = await control.evaluate(element => { const r = element.getBoundingClientRect(), p = element.closest('.control-popover-panel').getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom && r.left >= p.left && r.right <= p.right; });
        assert(reachable, 'compact playback control stays reachable: ' + await control.getAttribute('aria-label'));
      }
      await menu.getByRole('slider', { name: '音量', exact: true }).press('End');
      await page.waitForFunction(() => document.querySelector('.listening-stage .player-options .popover-volume input').getAttribute('aria-valuetext') === '100%');
      assert.equal(await menu.getByRole('slider', { name: '音量', exact: true }).inputValue(), '1');
      await page.screenshot({ path: join(artifacts, `player-options-${width}x${height}.png`) });
    }
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.listening-header').waitFor();
  assert.equal(await page.locator('.listening-header button').count(), 1, 'the desktop header keeps the back button');
  await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
  await page.locator('.desktop-tools').waitFor();
  assert.equal(await page.locator('.desktop-tools button').count(), 3, 'returning to browsing exposes the global tools');
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.locator('.listening-panel-tabs').getByRole('button', { name: '评论', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '视频评论', exact: true }); await panel.locator('.comment-thread').first().waitFor();
  assert.equal(await panel.locator('.comment-thread').count(), 20); assert.equal(await panel.locator('script').count(), 0); assert(await panel.textContent().then(text => text.includes('<script>原样显示</script>')));
  await panel.getByRole('button', { name: '展开回复 · 2', exact: true }).click(); await panel.locator('.comment-reply-list .comment-row').first().waitFor(); assert.equal(await panel.locator('.comment-reply-list .comment-row').count(), 2);
  failMore = true; await panel.getByRole('button', { name: '加载更多评论', exact: true }).click(); await panel.getByRole('button', { name: '重试评论', exact: true }).waitFor(); assert.equal(await panel.locator('.comment-thread').count(), 20);
  failMore = false; await panel.getByRole('button', { name: '重试评论', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.comment-thread').length === 21);
  await panel.getByRole('button', { name: '最新', exact: true }).click(); await panel.getByRole('button', { name: '热门', exact: true }).click(); await panel.getByRole('button', { name: '最新', exact: true }).click(); await panel.getByText(/最新评论 1/).first().waitFor(); assert(!await panel.textContent().then(text => text.includes('热门评论')));
  await page.screenshot({ path: join(artifacts, 'desktop-comments.png') });
  await page.setViewportSize({ width: 390, height: 667 });
  const drawer = page.getByRole('dialog', { name: '视频评论', exact: true }); await drawer.waitFor(); await drawer.locator('.comment-thread').first().waitFor();
  assert.equal(await page.locator('body').evaluate(element => element.style.overflow), 'hidden');
  await page.screenshot({ path: join(artifacts, 'phone-comments.png') }); await drawer.getByRole('button', { name: '关闭评论', exact: true }).click(); await drawer.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  await page.getByRole('button', { name: '播放队列歌曲 ' + second.title, exact: true }).click();
  await page.locator('.listening-panel-tabs').getByRole('button', { name: '评论', exact: true }).click(); await panel.locator('.comment-thread').first().waitFor();
  assert.equal(calls.at(-1).provider, 'youtube'); assert.equal(calls.at(-1).id, second.ref.id);
  assert.equal(errors.length, 0, errors.join('\n'));
  const { writeFileSync } = await import('node:fs'); writeFileSync(join(artifacts, 'layout.json'), JSON.stringify({ measurements, errors, requests: calls }, null, 2));
});
