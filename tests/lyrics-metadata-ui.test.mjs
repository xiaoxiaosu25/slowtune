import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright-core';
import { loadSongModule } from './helpers/song-services.mjs';

const { LyricsStore } = await loadSongModule('lyrics-store');
const { LyricProviders } = await loadSongModule('lyrics-providers');
const { createLyricsRouter } = await loadSongModule('lyrics-http');

test('saved-version lyrics wait for metadata while saved choices and manual actions remain available', { timeout: 30000 }, async t => {
  const artifact = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: { target: 'esnext', write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('./helpers/lyrics-metadata-probe.tsx', import.meta.url)), formats: ['es'] },
    rollupOptions: { output: { inlineDynamicImports: true } } } });
  const bundle = (Array.isArray(artifact) ? artifact : [artifact]).flatMap(row => row.output).find(row => row.isEntry).code;
  const store = new LyricsStore(':memory:', 'metadata');
  const records = new Map();
  const providers = new LyricProviders(store, async input => {
    const url = new URL(input);
    if (url.hostname === 'music.163.com') return Response.json({ code: 200, result: { songCount: 0 } });
    const title = url.searchParams.get('track_name'), artist = url.searchParams.get('artist_name'), key = JSON.stringify([title, artist]);
    if (!records.has(key)) records.set(key, records.size + 123);
    return Response.json([{ id: records.get(key), trackName: title, artistName: artist, duration: 60, syncedLyrics: '[00:01]当前版本歌词' }]);
  });
  const app = new Hono(); app.route('/api/lyrics', createLyricsRouter(store, providers, () => 'metadata'));
  app.get('/probe.js', c => c.body(bundle, 200, { 'Content-Type': 'text/javascript' }));
  app.get('/', c => c.html('<!doctype html><div id="root"></div><script type="module" src="/probe.js"></script>'));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.MUSIC_APP_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); providers.dispose(); store.close(); });
  const errors = [];
  const ref = part => ({ provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part });
  const open = async (part, savedVersion = true, options = {}) => {
    const page = await browser.newPage(options.viewport ? { viewport: options.viewport } : {}), matches = [];
    page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('/resolve')) matches.push(request.postDataJSON()); });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(track => window.lyricTrack = track, { ref: ref(part), resourceId: part, title: '测试歌曲', artists: ['原唱'], ...(savedVersion ? { songId: 'song', versionId: 'version-' + part } : {}), durationSeconds: 60, ...options.track });
    await page.goto(origin);
    await page.waitForFunction(() => window.lyricsMetadataProbe?.lyrics.state && !window.lyricsMetadataProbe.lyrics.busy);
    return { page, matches };
  };
  const version = (part, kind, performers) => ({ id: 'version-' + part, songId: 'song', ref: ref(part), label: kind, kind, ...(performers ? { performers } : {}), facts: { title: '版本来源' }, availability: { state: 'unknown' } });
  const supply = async (page, value) => {
    await page.evaluate(value => window.lyricsMetadataProbe.setVersion(value), value);
    await page.waitForFunction(id => window.lyricsMetadataProbe.version?.id === id && !window.lyricsMetadataProbe.lyrics.busy, value.id);
  };

  await t.test('unknown cover performer blocks adoption before and after metadata; manual import remains usable', async () => {
    const { page, matches } = await open('900');
    assert.deepEqual(matches, []); assert.equal(store.read(ref('900')).revision, null);
    await supply(page, version('900', 'cover'));
    assert.deepEqual(matches, []); assert.equal(store.read(ref('900')).document, null);
    await page.evaluate(() => window.lyricsMetadataProbe.lyrics.setText('[00:01]人工选择的翻唱歌词'));
    await page.evaluate(() => window.lyricsMetadataProbe.lyrics.importText());
    assert.equal(store.read(ref('900')).document.provider, 'local');
    await page.close();
  });
  await t.test('saved lyrics and offset restore even if version metadata is unavailable', async () => {
    const saved = store.update(ref('901'), null, state => { state.offsetMs = 1500; state.document = { provider: 'local', id: 'saved', title: '已选歌词', artists: [], synced: true, lines: [{ startMs: 1000, text: '保留正文' }] }; }, new AbortController().signal);
    const { page, matches } = await open('901');
    assert.equal(await page.evaluate(() => window.lyricsMetadataProbe.lyrics.offsetMs), 1500);
    assert.equal(await page.evaluate(() => window.lyricsMetadataProbe.lyrics.document.id), 'saved');
    await supply(page, version('901', 'cover'));
    assert.deepEqual(matches, []); assert.deepEqual(store.read(ref('901')), saved);
    await page.close();
  });
  for (const [part, kind, suffix, performers] of [['902', 'studio', ''], ['903', 'live', ' (Live)'], ['904', 'remix', ' (Remix)'], ['905', 'cover', '', ['翻唱歌手']]]) {
    await t.test(kind + ' matches only after the version metadata supplies the correct query', async () => {
      const { page, matches } = await open(part);
      assert.deepEqual(matches, []); assert.equal(store.read(ref(part)).revision, null);
      await supply(page, version(part, kind, performers));
      await page.waitForFunction(() => !!window.lyricsMetadataProbe.lyrics.document);
      assert.equal(matches.length, 1); assert.equal(matches[0].title, '测试歌曲' + suffix); assert.equal(matches[0].artist, performers?.[0] ?? '原唱');
      assert.equal(store.read(ref(part)).document.title, '测试歌曲' + suffix);
      await page.close();
    });
  }
  await t.test('an unsaved source still matches without a library version', async () => {
    const { page, matches } = await open('906', false);
    await page.waitForFunction(() => !!window.lyricsMetadataProbe.lyrics.document);
    assert.equal(matches.length, 1); assert.equal(store.read(ref('906')).document.title, '测试歌曲');
    await page.close();
  });
  for (const [part, width, artist] of [['907', 1280, '周杰伦'], ['908', 390, '']]) {
    await t.test(`trailing singer extraction at ${width}px preserves the intended surface behavior`, async () => {
      const { page, matches } = await open(part, false, { viewport: { width, height: 844 }, track: { title: '《兰亭序》周杰伦 | 百万级录音棚试听 | 【Hi-Res无损】', artists: [] } });
      assert.equal(matches.length, 1); assert.equal(matches[0].title, '兰亭序'); assert.equal(matches[0].artist, artist);
      assert.equal(await page.evaluate(() => window.lyricsMetadataProbe.lyrics.artist), artist);
      await page.close();
    });
  }
  assert.deepEqual(errors, []);
});
