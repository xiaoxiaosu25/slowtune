import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { fromMusicRef,queueRecord } from './helpers/song-fixture.mjs';
import { navigate, selectRate, selectPlaylist } from '../scripts/browser-ui.mjs';
import {installSearchFixture} from './helpers/search-fixture.mjs';

const root = process.env.MUSIC_APP_TEST_BUILD ?? fileURLToPath(new URL('..', import.meta.url));
const storageKey = 'slow-listening:playback:v3';

// Real, seekable PCM audio exercises native playback without platform/network dependencies.
function audioFixture(seconds) {
  const sampleRate = 16000, samples = seconds * sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(2000 * Math.sin(i * 2 * Math.PI * 440 / sampleRate)), 44 + i * 2);
  return bytes;
}

test('Song playback: fresh selections, live pause/resume and silent queue restoration', async t => {
  const first = {
    ref: { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' },
    resourceId: 'bilibili:video:BV1tX4y1W7Xm:900', title: '从头听的第一首',
    url: 'https://www.bilibili.com/video/BV1tX4y1W7Xm?p=1', durationSeconds: 16,
  };
  const second = {
    ref: { provider: 'youtube', kind: 'video', id: 'kK0CRZ0wvvc' },
    resourceId: 'youtube:video:kK0CRZ0wvvc', title: '从头听的第二首',
    url: 'https://www.youtube.com/watch?v=kK0CRZ0wvvc', durationSeconds: 16,
  };
  const inserted = {
    ref: { provider: 'bilibili', kind: 'video', id: 'BV0000000003', part: '902' },
    resourceId: 'bilibili:video:BV0000000003:902', title: '插在当前歌曲后的一首',
    url: 'https://www.bilibili.com/video/BV0000000003?p=1', durationSeconds: 16,
  };
  const tracks = [first, second], audio = audioFixture(16), preparations = [], metadataCalls = [];
  let unavailable;
  const snapshot = {
    playlists: [{ id: 'p1', name: '播放规则歌单', createdAt: 1, updatedAt: 1, entries: tracks.map((track, index) => ({
      id: 'e' + index, ref: fromMusicRef(track.ref), metadata: { title: track.title, durationSeconds: 16 },
      availability: { state: 'unknown' }, addedAt: 1,
    })) }],
    favorites: [...tracks, inserted].map(track => ({ ref: fromMusicRef(track.ref), metadata: { title: track.title, durationSeconds: 16 }, availability: { state: 'unknown' }, addedAt: 1 })),
  };
  const shelf = { id: 'music-recommendation', title: '播放规则推荐', kind: 'recommendation', page: { items: [first] } };
  let base, browser;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json((await import('./helpers/startup-fixture.mjs')).startupFixture(url.pathname));
    if (url.pathname === '/api/status') return json({ version: 'fixture', providers: { youtube: { available: true } }, delivery: { leases: 0, activeReads: 0 }, tool: { active: 0 } });
    if (url.pathname === '/api/bilibili/account') return json({ state: 'anonymous' });
    if (url.pathname === '/api/discovery/bilibili') return json([shelf]);
    if (url.pathname === '/api/bilibili/chart') return json({ shelf: { ...shelf, id: 'hot-chart', kind: 'chart' }, periods: [{ id: 1, number: 1, publishedAt: 1 }], period: { id: 1, number: 1, publishedAt: 1 }, sourceUrl: first.url, fetchedAt: 1 });
    if (url.pathname === '/v1/handshake') return json({ protocol: 2, capabilities: ['bilibili', 'youtube'].map(provider => ({ provider, operations: ['metadata', 'discover', 'search', 'prepare'], limitations: [], anonymous: true })) });
    if (url.pathname.startsWith('/v1/call/')) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const result = value => json({ protocol: 2, result: value });
      if (url.pathname.endsWith('/discover')) return result([shelf]);
      if (url.pathname.endsWith('/search')) return result({ items: tracks.filter(track => track.ref.provider === input.provider) });
      const ref = input.ref ?? input.request?.ref;
      const track = [...tracks, inserted].find(track => track.ref.provider === ref?.provider && track.ref.id === ref?.id);
      if (track && url.pathname.endsWith('/metadata')) {
        metadataCalls.push(track.ref.id);
        if(track.ref.id===unavailable)return json({protocol:2,error:{code:'not-found',provider:track.ref.provider,retryable:false}},400);
        return result(track);
      }
      if (track && url.pathname.endsWith('/prepare')) {
        if(track.ref.id===unavailable)return json({protocol:2,error:{code:'not-found',provider:track.ref.provider,retryable:false}},400);
        preparations.push(track.resourceId);
        return result({ entry: track, resourceId: track.resourceId, format: { codec: 'pcm', mimeType: 'audio/wav', container: 'wav' }, delivery: { url: base + '/media/fixture.wav?request=' + preparations.length, requiresHost: false } });
      }
      return json({ protocol: 2, error: { code: 'unsupported', retryable: false } }, 400);
    }
    if (url.pathname === '/media/fixture.wav') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      return response.end(audio.subarray(start, end + 1));
    }
    try {
      const path = join(root, 'dist/client', url.pathname === '/' ? 'index.html' : url.pathname);
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream');
      response.end(readFileSync(path));
    } catch { response.writeHead(404); response.end(); }
  });
  const {libraryFixture}=installSearchFixture(server,{librarySeed:snapshot});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ tracks, storageKey, record }) => {
    if (!localStorage.getItem(storageKey)) {
      localStorage.setItem(storageKey, JSON.stringify(record));
      for (const track of tracks) localStorage.setItem('slow-progress:' + track.resourceId, JSON.stringify({ positionSeconds: 6, durationSeconds: 16, updatedAt: 1234 }));
    }
  }, { tracks, storageKey,record:queueRecord(tracks,{volume:.37}) });
  const playbar = page.locator('.playbar');
  const savedQueue = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  const modeButton = playbar.getByRole('button', { name: '播放模式', exact: true });
  async function setMode(mode) {
    for (let index = 0; index < 4 && await modeButton.getAttribute('data-mode') !== mode; index++) await modeButton.click();
    assert.equal(await modeButton.getAttribute('data-mode'), mode);
  }
  const oldProgress = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('slow-progress:'))));
  async function observeAudio() {
    await page.locator('audio[data-product-media]').waitFor({ state: 'attached' });
    await page.evaluate(() => {
      window.__songStarts = [];
      document.querySelector('audio').addEventListener('playing', event => window.__songStarts.push({ position: event.target.currentTime, title: document.querySelector('.now-playing strong')?.textContent }));
    });
  }
  async function startsFresh(action, track = first, afterResume = false) {
    const count = await page.evaluate(() => window.__songStarts.length) + (afterResume ? 1 : 0);
    await action();
    await page.waitForFunction(({ count, title }) => window.__songStarts.length > count && document.querySelector('.now-playing strong')?.textContent === title && !document.querySelector('audio').paused, { count, title: track.title });
    const started = await page.evaluate(count => window.__songStarts[count], count);
    assert.equal(started.title, track.title);
    assert(started.position < 0.5, 'selected song starts at zero: ' + JSON.stringify(started));
  }
  async function pauseSeek(position) {
    if (!await page.locator('audio').evaluate(audio=>audio.paused)) await playbar.getByRole('button', { name: '暂停', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').paused);
    const input = playbar.getByRole('slider', { name: '播放进度' });
    const box = await input.boundingBox(), duration = Number(await input.getAttribute('max')), current = Number(await input.inputValue());
    const x = value => box.x + 4 + (box.width - 8) * value / duration;
    await page.mouse.move(x(current), box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(x(position), box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(position => { const audio = document.querySelector('audio'); return audio.paused && Math.abs(audio.currentTime - position) < 0.4; }, position);
    return page.locator('audio').evaluate(audio => audio.currentTime);
  }
  await page.goto(base); await observeAudio();
  const legacyProgress = await oldProgress();

  await t.test('old progress is ignored; restored queue stays silent until play starts at zero', async () => {
    assert.deepEqual(preparations, []);
    assert.deepEqual(await page.locator('audio').evaluate(audio => ({ paused: audio.paused, position: audio.currentTime, src: audio.getAttribute('src') })), { paused: true, position: 0, src: null });
    assert.equal(await playbar.locator('.now-playing strong').textContent(), first.title);
    assert.equal((await savedQueue()).volume, 0.37);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click());
  });

  await t.test('pause and play continue the live position without preparing another source', async () => {
    const position = await pauseSeek(6), before = preparations.length;
    await playbar.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(position => { const audio = document.querySelector('audio'); return !audio.paused && audio.currentTime > position; }, position);
    const continued = await page.locator('audio').evaluate(audio => audio.currentTime);
    assert(continued >= position && continued < position + 1);
    assert.equal(preparations.length, before);
    assert.deepEqual(await oldProgress(), legacyProgress, 'no progress is written during playback or pause');
  });

  await t.test('changing the player shell leaves the live audio, progress and queue intact', async () => {
    const before = await savedQueue(), count = preparations.length;
    await page.evaluate(() => { window.__styleAudio = document.querySelector('audio'); window.__styleProgress = document.querySelector('.playbar input[aria-label="播放进度"]'); window.__stylePosition = window.__styleAudio.currentTime; });
    await playbar.getByRole('button', { name: '更多播放选项', exact: true }).click();
    const options = playbar.locator('.player-options > .control-popover-panel');
    await options.getByRole('radio', { name: '底部长条', exact: true }).check();
    await page.waitForFunction(() => document.querySelector('.app').dataset.playerStyle === 'bar');
    await options.getByRole('radio', { name: '悬浮播放岛', exact: true }).check();
    await page.waitForFunction(() => document.querySelector('.app').dataset.playerStyle === 'floating');
    assert(await page.evaluate(() => document.querySelector('audio') === window.__styleAudio && document.querySelector('.playbar input[aria-label="播放进度"]') === window.__styleProgress && !window.__styleAudio.paused && window.__styleAudio.currentTime >= window.__stylePosition), 'appearance changes preserve the live elements and uninterrupted playback');
    assert.equal(preparations.length, count);
    const after = await savedQueue();
    for (const key of ['items', 'current', 'volume', 'rate', 'order', 'repeat']) assert.deepEqual(after[key], before[key]);
    await page.keyboard.press('Escape');
  });

  await t.test('clicking the current queue song restarts both paused and playing songs', async () => {
    await pauseSeek(6);
    await playbar.getByRole('button', { name: '打开播放队列', exact: true }).click();
    const song = page.getByRole('button', { name: '播放队列歌曲 ' + first.title, exact: true });
    await startsFresh(() => song.click());
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 1);
    await startsFresh(() => song.click());
    await page.getByRole('button', { name: '关闭播放队列', exact: true }).click();
  });

  await t.test('next and previous start at zero even when revisiting playback history', async () => {
    await pauseSeek(6);
    await startsFresh(() => playbar.getByRole('button', { name: '下一首', exact: true }).click(), second);
    await pauseSeek(6);
    await startsFresh(() => playbar.getByRole('button', { name: '上一首', exact: true }).click());
    await startsFresh(() => playbar.getByRole('button', { name: '下一首', exact: true }).click(), second);
  });

  await t.test('discovery, search, favorites, playlist songs and play-all start fresh', async () => {
    await pauseSeek(6);
    await startsFresh(() => page.locator('[data-shelf-kind="recommendation"]').getByRole('button', { name: '播放 ' + first.title, exact: true }).click());
    await pauseSeek(6);
    await page.getByLabel('搜索歌曲或视频').fill(first.title);
    await page.getByRole('button', { name: '开始搜索', exact: true }).click();
    await startsFresh(() => page.locator('.track-row.normal').getByRole('button', { name: '播放 ' + first.title, exact: true }).click());
    await page.getByRole('dialog',{name:'搜索音乐',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
    await pauseSeek(6); await navigate(page, '收藏');
    await startsFresh(() => page.locator('.song-library-row').getByRole('button', { name: '播放 ' + first.title, exact: true }).click());
    await pauseSeek(6);
    await startsFresh(() => page.getByRole('button', { name: '播放全部', exact: true }).click());
    await pauseSeek(6); await navigate(page, '歌单');
    await selectPlaylist(page,'播放规则歌单');
    await startsFresh(() => page.locator('.song-library-row').getByRole('button', { name: '播放 ' + first.title, exact: true }).click());
    await pauseSeek(6);
    await startsFresh(() => page.locator('.playlist-intro').getByRole('button', { name: '播放全部', exact: true }).click());
    assert.equal((await savedQueue()).items.length, 2);
    await navigate(page, '发现');
  });

  await t.test('single-song selection keeps unavailable neighbours lazy in discovery and playlists', async () => {
    shelf.page.items=tracks;await page.reload();await observeAudio();
    unavailable=second.ref.id;metadataCalls.length=0;
    try{
      const retained=await savedQueue();
      await startsFresh(()=>page.locator('[data-shelf-id="music-recommendation"]').getByRole('button',{name:'播放 '+first.title,exact:true}).click());
      const selected=await savedQueue();assert.deepEqual(selected.items.filter(item=>retained.items.some(old=>old.instanceId===item.instanceId)),retained.items);assert.equal(selected.items.find(item=>item.instanceId===selected.current).selection.ref.id,first.ref.id);
      assert(!metadataCalls.includes(second.ref.id),'unselected songs are not resolved before playback');
      const before=await savedQueue();
      await page.locator('[data-shelf-id="music-recommendation"]').getByRole('button',{name:'播放 '+second.title,exact:true}).click();
      await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).click();
      await page.getByText('来源内容不存在或无法访问。',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      assert.deepEqual(await savedQueue(),before,'an unavailable selected song preserves the current queue');
      await navigate(page,'歌单');
      await selectPlaylist(page,'播放规则歌单');
      await startsFresh(()=>page.locator('.playlist-intro .play-all').click());
      assert.deepEqual((await savedQueue()).items.map(t=>t.title),tracks.map(t=>t.title));
      const count=preparations.length;
      await playbar.getByRole('button',{name:'下一首',exact:true}).click();
      await page.getByRole('button',{name:'播放失败，查看详情',exact:true}).click();
      await page.getByText('来源内容不存在或无法访问。',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(preparations.length,count,'an unavailable neighbour fails only when it is actually selected');
      await startsFresh(()=>playbar.getByRole('button',{name:'上一首',exact:true}).click());
    }finally{unavailable=undefined;}
    await navigate(page,'发现');
  });

  await t.test('deferred songs save the canonical Bilibili part when they start', async () => {
    shelf.page.items=[second,{...first,ref:{provider:'bilibili',kind:'video',id:first.ref.id},resourceId:'unresolved-bilibili-video'}];
    await page.addInitScript(({storageKey,record})=>{if(localStorage.getItem('slow-test:deferred')){localStorage.removeItem('slow-test:deferred');localStorage.setItem(storageKey,JSON.stringify(record));}},{storageKey,record:queueRecord(shelf.page.items)});
    await page.evaluate(()=>localStorage.setItem('slow-test:deferred','1'));
    await page.reload();await observeAudio();
    await startsFresh(()=>page.locator('[data-shelf-id="music-recommendation"]').getByRole('button',{name:'播放 '+second.title,exact:true}).click(),second);
    assert.equal((await savedQueue()).items[1].selection.ref.part,undefined);
    await page.reload();await observeAudio();
    assert.equal(await page.locator('audio').evaluate(audio=>audio.paused&&!audio.getAttribute('src')),true);
    await startsFresh(()=>playbar.getByRole('button',{name:'播放',exact:true}).click(),second);
    await startsFresh(()=>playbar.getByRole('button',{name:'下一首',exact:true}).click());
    assert.equal((await savedQueue()).items[1].selection.ref.part,first.ref.part,'resolved part identity is preserved in browser playback data');
    shelf.page.items=tracks;await navigate(page,'歌单');await selectPlaylist(page,'播放规则歌单');
    await startsFresh(()=>page.locator('.playlist-intro .play-all').click());
    await navigate(page,'发现');
  });

  await t.test('one mode button cycles through mutually exclusive queue modes', async () => {
    assert.equal(await modeButton.count(), 1);
    for (const [mode, order, repeat] of [['shuffle','shuffle','off'],['all','sequential','all'],['one','sequential','one'],['sequential','sequential','off']]) {
      await modeButton.click();
      await page.waitForFunction(({storageKey,order,repeat}) => { const value = JSON.parse(localStorage.getItem(storageKey)); return value.order === order && value.repeat === repeat; }, {storageKey,order,repeat});
      assert.equal(await modeButton.getAttribute('data-mode'), mode);
    }
  });

  await t.test('shuffle history also returns to the beginning', async () => {
    await setMode('shuffle');
    await pauseSeek(6);
    await startsFresh(() => playbar.getByRole('button', { name: '下一首', exact: true }).click(), second);
    await pauseSeek(6);
    await startsFresh(() => playbar.getByRole('button', { name: '上一首', exact: true }).click());
    await setMode('sequential');
  });

  await t.test('a new song inserts after the current song and continues to its former successor', async () => {
    await navigate(page, '歌单'); await selectPlaylist(page, '播放规则歌单');
    await startsFresh(() => page.locator('.playlist-intro .play-all').click());
    const before = await savedQueue();
    await navigate(page, '收藏');
    await startsFresh(() => page.locator('.song-library-row').getByRole('button', { name: '播放 ' + inserted.title, exact: true }).click(), inserted);
    const saved = await savedQueue();
    assert.deepEqual(saved.items.map(track => track.title), [first.title, inserted.title, second.title]);
    assert.equal(saved.current, saved.items[1].instanceId);
    assert.deepEqual([saved.items[0], saved.items[2]], before.items, 'retained songs keep their identities and selections');
    await pauseSeek(14);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click(), second, true);
    await selectPlaylist(page, '播放规则歌单');
  });

  await t.test('picking an already queued song retains its position and continues naturally', async () => {
    await navigate(page, '歌单');
    await startsFresh(()=>page.locator('.playlist-intro').getByRole('button',{name:'播放全部',exact:true}).click());
    const before = await savedQueue();
    await startsFresh(() => page.locator('.song-library-row').getByRole('button', { name: '播放 ' + first.title, exact: true }).click());
    const saved = await savedQueue();
    assert.deepEqual(saved.items, before.items, 'single playback reuses the existing queue occurrence');
    assert.equal(saved.current, saved.items[0].instanceId);
    await pauseSeek(14);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click(), second, true);
    await pauseSeek(14);
    await playbar.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').ended);
    await page.waitForFunction(() => document.querySelector('.playbar button[aria-label="下一首"]').disabled);
    assert.equal(await playbar.getByRole('button', { name: '上一首', exact: true }).isDisabled(), false, 'only the unavailable direction is disabled');
    await startsFresh(() => page.locator('.playlist-intro .play-all').click());
    await navigate(page, '发现');
  });

  await t.test('natural continuation, list loop and single-song loop restart at zero', async () => {
    await pauseSeek(14);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click(), second, true);
    await setMode('all');
    await pauseSeek(14);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click(), first, true);
    await setMode('one');
    await pauseSeek(14);
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click(), first, true);
  });

  await t.test('reload preserves queue, current song, modes and volume while resetting progress', async () => {
    await pauseSeek(6);
    const before = await savedQueue(), count = preparations.length;
    await page.reload(); await observeAudio();
    assert.equal(preparations.length, count, 'reload does not prepare media or autoplay');
    assert.deepEqual(await savedQueue(), before);
    assert.deepEqual(await page.locator('audio').evaluate(audio => ({ paused: audio.paused, position: audio.currentTime, src: audio.getAttribute('src') })), { paused: true, position: 0, src: null });
    await startsFresh(() => playbar.getByRole('button', { name: '播放', exact: true }).click());
    assert.deepEqual(await oldProgress(), legacyProgress, 'legacy progress is ignored and never overwritten');
  });
  await t.test('sleep countdown, playback rate, mute, skipped seek and drag preview stay on the live session', async () => {
    if (await page.locator('audio').evaluate(audio => audio.paused)) await playbar.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return !audio.paused; });
    await selectRate(playbar, 1.5);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).rate === 1.5, storageKey);
    assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 1.5);
    await selectRate(playbar, 1);
    await playbar.getByRole('button', { name: '静音', exact: true }).click();
    assert.equal(await page.locator('audio').evaluate(audio => audio.muted), true);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).muted === true, storageKey);
    await playbar.getByRole('button', { name: '取消静音', exact: true }).click();
    assert.equal(await page.locator('audio').evaluate(audio => audio.muted), false);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).muted === false, storageKey);
    await pauseSeek(4);
    const input = playbar.getByRole('slider', { name: '播放进度' });
    const box = await input.boundingBox(), duration = Number(await input.getAttribute('max'));
    const x = value => box.x + 4 + (box.width - 8) * value / duration;
    await page.mouse.move(x(4), box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(x(12), box.y + box.height / 2, { steps: 4 });
    assert.equal(await page.locator('audio').evaluate(audio => Math.round(audio.currentTime)), 4, 'holding the handle previews without seeking');
    await page.mouse.up();
    await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 12) < 0.5);
    await pauseSeek(4);
    await playbar.getByRole('button', { name: '更多播放选项', exact: true }).click();
    await playbar.getByRole('button', { name: '快进 10 秒', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 14) < 0.5);
    await pauseSeek(1);
    if (await page.locator('audio').evaluate(audio => audio.paused)) await playbar.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return !audio.paused && audio.currentTime > 1; });
    await playbar.getByRole('button', { name: '睡眠定时器', exact: true }).click();
    const sleep = page.locator('dialog.modal');
    await sleep.getByRole('button', { name: '30 分钟', exact: true }).click();
    await sleep.locator('.sleep-summary.is-running').waitFor();
    assert.equal(await sleep.locator('[data-field="duration"]').inputValue(), '30');
    await sleep.locator('[data-field="duration"]').fill('7');
    await page.waitForFunction(() => document.querySelector('.sleep-summary strong')?.textContent !== '30:00');
    assert.equal(await sleep.locator('[data-field="duration"]').inputValue(), '7', 'timer ticks preserve an unfinished custom duration');
    await sleep.locator('[data-action="cancel-timer"]').click();
    assert.equal(await sleep.locator('.sleep-summary.is-running').count(), 0);
    await sleep.locator('[data-field="duration"]').fill('2');
    await sleep.locator('[data-field="unit"]').selectOption('1000');
    await sleep.locator('[data-action="start-timer"]').click();
    assert.equal(await sleep.locator('[data-field="unit"]').inputValue(), '1000');
    assert.equal(await sleep.locator('[data-field="duration"]').inputValue(), '2');
    await page.waitForFunction(() => document.querySelector('audio').paused, undefined, { timeout: 10000 });
    assert((await page.locator('audio').evaluate(audio => audio.currentTime)) < 5, 'the countdown pauses the live song instead of running it to the end');
    await sleep.getByRole('button', { name: '关闭', exact: true }).click();
    await sleep.waitFor({ state: 'detached' });
    assert.equal(await playbar.getByRole('button', { name: '睡眠定时器', exact: true }).getAttribute('aria-pressed'), 'false', 'an expired rule stops reporting a running countdown');
  });
  await t.test('listening shortcuts work from focused controls and stop/reset preserves the queue',async()=>{
    await pauseSeek(4);
    const before=await savedQueue();
    await playbar.getByRole('button',{name:'打开正在播放',exact:true}).click();
    const stage=page.locator('.listening-stage');
    await stage.getByRole('button',{name:'播放',exact:true}).press('ArrowRight');
    await page.waitForFunction(()=>Math.abs(document.querySelector('audio').currentTime-9)<0.4);
    await stage.getByRole('button',{name:'播放',exact:true}).press('ArrowLeft');
    await page.waitForFunction(()=>Math.abs(document.querySelector('audio').currentTime-4)<0.4);
    await stage.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await stage.getByRole('button',{name:'停止播放',exact:true}).click();
    await stage.getByRole('status').filter({hasText:'已停止'}).waitFor();
    await stage.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await stage.getByRole('button',{name:'停止并归零',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('audio').paused&&document.querySelector('audio').currentTime===0);
    assert.deepEqual((await savedQueue()).items,before.items,'transport operations keep the queue intact');
    await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
  });
  await t.test('conflicting queue modes restore as one mode without autoplay', async () => {
    const value = await savedQueue();
    for (const repeat of ['all', 'one']) {
      const restored = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      try {
        // Seed a cold browser so pagehide cannot replace the conflicting mode flags.
        await restored.addInitScript(({storageKey,value,repeat}) => localStorage.setItem(storageKey, JSON.stringify({...value,order:'shuffle',repeat})), {storageKey,value,repeat});
        await restored.goto(base);
        await restored.locator('.mode-control[data-mode="shuffle"]').waitFor();
        assert.equal(await restored.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)).repeat, storageKey), 'off');
        assert.equal(await restored.locator('audio').evaluate(audio => audio.paused && !audio.getAttribute('src')), true);
      } finally { await restored.close(); }
    }
  });
  assert.deepEqual(errors, []);
});
