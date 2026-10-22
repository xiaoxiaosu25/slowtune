import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { chromium } from './helpers/browser.mjs';
import { loadSongModule } from './helpers/song-services.mjs';
import { startupFixture } from './helpers/startup-fixture.mjs';

const { SongLibraryStore } = await loadSongModule('song-library-store');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');
const root = resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.');

test('organization is on demand, cancellable and local; adoption preserves playback and rejects stale suggestions on desktop and narrow screens', { timeout: 45000 }, async t => {
  const parent = resolve('local/song-library-organization-ui'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'run-')), store = new SongLibraryStore(join(directory, 'songs.sqlite'), 'ui'), service = new SongLibraryService(store);
  const mediaRef = { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' };
  service.execute(null, [
    { type: 'create-song', id: 'song', title: '周杰伦《晴天》', source: 'parsed' },
    { type: 'add-version', version: { id: 'v-song', songId: 'song', ref: mediaRef, label: '', kind: 'other', facts: { title: '周杰伦《晴天》' }, availability: { state: 'unknown' } } },
    { type: 'favorite', songId: 'song' },
    { type: 'create-song', id: 'other', title: '不需整理的歌曲' }, { type: 'favorite', songId: 'other' },
  ]);
  const app = new Hono(), sourceState = { revision: 'sources', sequence: 1, youtube: { enabled: false, available: false, checking: false, disabledDisplay: 'dim' } };
  app.route('/api/song-library', createSongLibraryRouter(service, () => 'ui'));
  app.get('/api/bootstrap', c => c.json({ ...startupFixture('/api/bootstrap'), authenticated: true }));
  app.get('/api/status', c => c.json({ version: 'organization-fixture', node: process.version, providers: { bilibili: { available: true }, youtube: sourceState.youtube }, sourceSettings: sourceState, delivery: { leases: 0, activeReads: 0 }, tool: { active: 0 } }));
  app.get('/api/settings/sources', c => c.json(sourceState));
  app.get('/api/settings/sources/events', c => streamSSE(c, async stream => { await stream.writeSSE({ event: 'sources', data: JSON.stringify(sourceState) }); await new Promise(resolve => stream.onAbort(resolve)); }));
  app.get('/api/bilibili/account', c => c.json({ state: 'anonymous' })); app.get('/api/follows', c => c.json({ revision: 'f', creators: [] })); app.get('/api/follows/feed', c => c.json({ items: [] })); app.get('/api/discovery/bilibili', c => c.json([]));
  app.get('/v1/handshake', c => c.json({ protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata', 'prepare'], anonymous: true, limitations: [] }] }));
  const entry = { ref: mediaRef, resourceId: 'source', title: '周杰伦《晴天》', durationSeconds: 60, uploader: { name: '夹具上传者' }, url: 'https://www.bilibili.com/video/' + mediaRef.id };
  let sourceReads = 0;
  app.post('/v1/call/metadata', c => { sourceReads++; return c.json({ protocol: 2, result: entry }); });
  app.post('/v1/call/prepare', c => { sourceReads++; return c.json({ protocol: 2, result: { entry, resourceId: 'source', format: { id: 'wav', codec: 'pcm', mimeType: 'audio/wav', container: 'wav' }, delivery: { url: new URL('/fixture.wav', c.req.url).href, requiresHost: false } } }); });
  const audio = Buffer.alloc(44 + 8000 * 60 * 2); audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let i = 0; i < 8000 * 60; i++) audio.writeInt16LE(Math.round(Math.sin(i / 8000 * 440 * 2 * Math.PI) * 5000), 44 + i * 2);
  app.get('/fixture.wav', c => c.body(audio, 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' }));
  app.all('/api/*', c => c.json({ error: { code: 'not-found' } }, 404)); app.use('/*', serveStatic({ root: join(root, 'dist/client') }));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  let release;
  t.after(async () => { release?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
  const sourceRequests = [];
  page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.url().includes('/organization/')) requests.push(r.url()); if (r.url().includes('/v1/')) sourceRequests.push(new URL(r.url()).pathname); });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const openEditor = async title => {
    const row = page.locator('.song-library-row').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    await row.getByRole('button',{name:'更多操作 '+title,exact:true}).click();
    await page.locator('.song-row-menu [popover]:popover-open').getByRole('button', { name: '编辑歌曲 ' + title, exact: true }).click();
    await page.getByRole('tab',{name:'歌曲资料',exact:true}).click();
  };
  await page.goto(origin); await page.locator('.sidebar-nav').getByRole('button', { name: '歌单', exact: true }).click();
  await page.getByRole('button', { name: '播放 周杰伦《晴天》', exact: true }).click();
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > .1; }).catch(async error => { throw new Error('Fixture playback: ' + JSON.stringify({ sourceRequests, feedback: await page.locator('.feedback').allTextContents(), media: await page.locator('audio').evaluate(a => ({ paused: a.paused, time: a.currentTime, readyState: a.readyState, error: a.error?.message })) }), { cause: error }); });
  const initial = await page.evaluate(() => ({ src: document.querySelector('audio').currentSrc, current: JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current }));
  await openEditor('周杰伦《晴天》'); assert.equal(requests.length, 0, 'entering and ordinary playback do not generate suggestions');
  const gate = new Promise(resolve => release = resolve);
  await page.route('**/organization/preview', async route => { await gate; await route.continue().catch(() => {}); });
  await page.getByRole('button', { name: '查看整理建议', exact: true }).click(); await page.getByText('正在处理整理建议…', { exact: false }).waitFor();
  const beforeWait = await page.locator('audio').evaluate(a => a.currentTime);
  await page.waitForFunction(time => document.querySelector('audio').currentTime > time + .2, beforeWait);
  await page.getByRole('button', { name: '收起建议', exact: true }).click(); release(); await page.unroute('**/organization/preview');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '取消收藏 不需整理的歌曲', exact: true }).click();
  await page.getByRole('button', { name: '取消收藏 不需整理的歌曲', exact: true }).waitFor({ state: 'detached' });
  assert.equal(service.read().snapshot.favorites.length, 1, 'cancelling generation leaves ordinary writes usable');
  const noChanges = service.read(), sourceCount = sourceReads;
  await openEditor('周杰伦《晴天》');
  await page.route('**/organization/preview', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage' } }) }));
  await page.getByRole('button', { name: '查看整理建议', exact: true }).click(); await page.getByRole('region', { name: '整理建议', exact: true }).getByRole('alert').waitFor();
  assert.equal(await page.locator('audio').evaluate(a => a.paused), false);
  await page.unroute('**/organization/preview'); await page.getByRole('button', { name: '重新生成建议', exact: true }).click();
  await page.getByRole('button', { name: '采用建议 1', exact: true }).waitFor();
  assert.deepEqual(service.read(), noChanges, 'viewing is read-only'); assert.equal(sourceReads, sourceCount, 'generation does not request metadata');
  await page.getByText('查看建议依据', { exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.getByRole('button', { name: '采用建议 1', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(directory, 'organization-' + width + '.png') });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('checkbox', { name: '采用建议 1 的歌手', exact: true }).uncheck();
  const beforeAdopt = await page.locator('audio').evaluate(a => a.currentTime);
  await page.getByRole('button', { name: '采用建议 1', exact: true }).click(); await page.getByText('已采用所选建议，人工字段已保护。', { exact: true }).waitFor();
  assert.equal(service.read().snapshot.songs[0].title, '晴天'); assert.equal(service.read().snapshot.songs[0].artists, undefined);
  assert.equal(sourceReads, sourceCount); assert.equal(await page.locator('audio').evaluate(a => a.currentSrc), initial.src);
  assert((await page.locator('audio').evaluate(a => a.currentTime)) >= beforeAdopt); assert.equal(await page.locator('audio').evaluate(a => a.paused), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('slow-listening:playback:v3')).current), initial.current);
  assert.deepEqual(service.read().snapshot.versions, noChanges.snapshot.versions);
  await page.getByRole('button', { name: '重新生成建议', exact: true }).click(); await page.getByRole('button', { name: '采用建议 1', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '采用建议 1 的歌名', exact: true }).count(), 0, 'protected title cannot be selected');
  service.execute(service.revision(), [{ type: 'edit-song', songId: 'song', artists: ['并发人工歌手'] }]);
  await page.getByRole('button', { name: '采用建议 1', exact: true }).click();
  await page.getByText('资料已变化，请重新生成建议后核对，现有资料和播放保持。', { exact: true }).waitFor();
  assert.deepEqual(service.read().snapshot.songs[0].artists, ['并发人工歌手']); assert.equal(await page.locator('audio').evaluate(a => a.paused), false);
  await page.getByRole('button', { name: '重新生成建议', exact: true }).click(); await page.getByText('没有可采用的明确建议，可以保留现有资料或手动编辑。', { exact: true }).waitFor();
  const beforeReloadRequests = requests.length;
  await page.reload(); await page.locator('.sidebar-nav').getByRole('button', { name: '歌单', exact: true }).click(); await openEditor('晴天');
  assert.equal(requests.length, beforeReloadRequests, 'reopening does not regenerate suggestions');
  assert.equal(await page.locator('audio').evaluate(a => a.paused), true); assert.deepEqual(errors, []);
});
