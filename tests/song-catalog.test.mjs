import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { songServices, loadSongModule, ref } from './helpers/song-services.mjs';

const { SongCatalogService, NeteaseSongCatalog, automaticCatalogMatch, songCatalogQuery } = await loadSongModule('song-catalog');
const { desktopCatalogLibrary } = await loadSongModule('song-catalog-display');
const { decodeSongLibrarySnapshot } = await loadSongModule('song-library-codec');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');
const cover = 'https://p2.music.126.net/album.jpg', sourceCover = 'https://i0.hdslb.com/video.jpg';
const record = (patch = {}) => ({ provider: 'netease', id: '100', title: '晴天', artists: ['周杰伦'], album: '叶惠美', artwork: cover, durationSeconds: 269, url: 'https://music.163.com/song?id=100', ...patch });
function seed(f, { id = 'song', title = '【Hi-Res】周杰伦《晴天》', artists, source = 'parsed', contentKind, keep = true } = {}) {
  f.edit([{ type: 'create-song', id, title, source, artwork: sourceCover, ...(artists ? { artists } : {}), ...(contentKind ? { contentKind } : {}) },
    { type: 'add-version', version: { id: 'v-' + id, songId: id, ref: ref(f.library.read().snapshot.versions.length + 1), label: '现场', kind: 'live', facts: { title, artwork: sourceCover, uploader: '上传者', durationSeconds: 270 }, availability: { state: 'unknown' } } },
    ...(keep ? [{ type: 'favorite', songId: id }] : [])]);
}
function catalog(f, records = [record()], options = {}) {
  const calls = [];
  const provider = { search: async (query, signal) => { calls.push(query); return typeof records === 'function' ? records(query, signal) : structuredClone(records); }, records: async ids => ids.map(id => record({ id, url: 'https://music.163.com/song?id=' + id })), dispose() {}, ...options };
  return { service: new SongCatalogService(f.library, provider), calls, provider };
}

test('background enriches desktop presentation while raw/mobile facts, versions, members and defaults survive', async t => {
  const f = songServices(t); seed(f); seed(f, { id: 'unretained', keep: false });
  const before = f.store.read().document, c = catalog(f);
  const saved = await c.service.backfill(f.signal), view = desktopCatalogLibrary(saved), song = view.snapshot.songs[0];
  assert.deepEqual(c.calls, ['晴天 周杰伦']); assert.equal(song.title, '晴天'); assert.deepEqual(song.artists, ['周杰伦']); assert.equal(song.artwork, cover);
  assert.equal(saved.snapshot.songs[0].title, before.snapshot.songs[0].title); assert.equal(saved.snapshot.songs[0].artwork, sourceCover);
  assert.equal(saved.snapshot.songs[1].desktopCatalog, undefined);
  for (const key of ['versions', 'favorites', 'playlists', 'catalogLinks', 'redirects']) assert.deepEqual(saved.snapshot[key], before.snapshot[key]);
  for (const key of ['origins', 'syncMappings', 'syncLinks']) assert.deepEqual(f.store.read().document[key], before[key]);
  assert.equal(song.defaultVersionId, 'v-song'); assert.equal(desktopCatalogLibrary(saved), view);
  assert.equal((await c.service.backfill(f.signal)).more, false); assert.equal(c.calls.length, 1);
  const desktopPlayback = await f.sources.playback({ kind: 'song', songId: 'song' }, f.signal, 'title-artists');
  const mobilePlayback = await f.sources.playback({ kind: 'song', songId: 'song' }, f.signal);
  assert.equal(desktopPlayback.song.title, '晴天'); assert.equal(desktopPlayback.song.artwork, cover);
  assert.equal(mobilePlayback.song.title, before.snapshot.songs[0].title); assert.equal(mobilePlayback.song.artwork, sourceCover);
});

test('automatic matches require exact artist and title and a unique studio release', () => {
  const query = { title: '晴天（Live）', artists: ['周杰伦'] };
  assert.equal(automaticCatalogMatch(query, [record(), record({ id: '101', title: '晴天 (Live)', album: '演唱会' }), record({ id: '102', artists: ['其他歌手'] })]).id, '100');
  for (const candidates of [[record({ artists: ['其他歌手'] })], [record({ artwork: undefined })], [record(), record({ id: '101', album: '再发行' })], [record({ title: '晴天 (Remastered)' })]]) assert.equal(automaticCatalogMatch(query, candidates), undefined);
  assert.equal(automaticCatalogMatch({ title: '晴天', artists: [] }, [record()]), undefined);
});

test('ambiguous separators, conflicting evidence and medleys need review without guessing artists from uploaders', async t => {
  const f = songServices(t); seed(f, { title: '周杰伦 - 晴天' });
  const c = catalog(f); await c.service.backfill(f.signal);
  assert.equal(f.library.read().snapshot.songs[0].desktopCatalog.state, 'review'); assert.equal(c.calls.length, 0);
  seed(f, { id: 'collection', title: '周杰伦《晴天》', contentKind: 'medley' });
  await c.service.backfill(f.signal); assert.equal(c.calls.length, 0);
  const snapshot = f.library.read().snapshot;
  assert.equal(songCatalogQuery(snapshot.songs[1], snapshot), undefined);
});

test('manual name, artist and cover stay protected; unexplained legacy artwork stays intact', async t => {
  const f = songServices(t); seed(f, { title: '晴天', artists: ['周杰伦'] });
  f.edit([{ type: 'edit-song', songId: 'song', title: '我的晴天', artists: ['我的歌手'], artwork: 'https://example.com/my-cover.jpg' }]);
  const c = catalog(f); const saved = await c.service.select(f.library.revision(), { songId: 'song', id: '100' }, f.signal);
  const song = desktopCatalogLibrary(saved).snapshot.songs[0];
  assert.equal(song.title, '我的晴天'); assert.deepEqual(song.artists, ['我的歌手']); assert.equal(song.artwork, 'https://example.com/my-cover.jpg');
  const legacy = structuredClone(saved); delete legacy.snapshot.songs[0].fields.artwork;
  assert.equal(desktopCatalogLibrary(legacy).snapshot.songs[0].artwork, 'https://example.com/my-cover.jpg');
  legacy.snapshot.songs[0].artwork = sourceCover;
  assert.equal(desktopCatalogLibrary(structuredClone(legacy)).snapshot.songs[0].artwork, cover);
});

test('manual selection re-reads provider metadata; disabling restores source presentation and prevents repeat matching', async t => {
  const f = songServices(t); seed(f); const c = catalog(f);
  const selected = await c.service.select(f.library.revision(), { songId: 'song', id: '100' }, f.signal);
  assert.equal(selected.snapshot.songs[0].desktopCatalog.selection, 'manual');
  const disabled = await c.service.select(selected.revision, { songId: 'song', disabled: true }, f.signal);
  assert.equal(desktopCatalogLibrary(disabled).snapshot.songs[0].artwork, sourceCover);
  await c.service.backfill(f.signal); assert.equal(c.calls.length, 0);
  await assert.rejects(c.service.select(disabled.revision, { songId: 'song', id: '100', record: record({ title: '伪造' }) }, f.signal), { code: 'invalid-input' });
  await assert.rejects(c.service.select('old', { songId: 'song', id: '100' }, f.signal), { code: 'conflict' });
});

test('slow automatic results never overwrite concurrently edited, merged or deleted songs', async t => {
  for (const action of ['edit', 'delete', 'merge']) {
    const f = songServices(t); seed(f); seed(f, { id: 'target' });
    let finish; const c = catalog(f, () => new Promise(resolve => { finish = resolve; }));
    const pending = c.service.backfill(f.signal);
    if (action === 'edit') f.edit([{ type: 'edit-song', songId: 'song', title: '手工更新' }]);
    else {
      const preview = f.library.previewMaintenance('browser', action === 'delete' ? { type: 'delete-song', songId: 'song' } : { type: 'merge-songs', sourceId: 'song', targetId: 'target' }, f.library.revision());
      f.library.commitMaintenance('browser', preview.token, preview.revision);
    }
    finish([record()]); await pending;
    assert(f.library.read().snapshot.songs.every(song => !song.desktopCatalog));
  }
});

test('cancellation, disposal and concurrent background calls cannot commit late records', async t => {
  for (const dispose of [false, true]) {
    const f = songServices(t); seed(f); let finish;
    const c = catalog(f, () => new Promise(resolve => { finish = resolve; })), controller = new AbortController();
    const before = f.library.read(), pending = c.service.backfill(controller.signal);
    await assert.rejects(c.service.backfill(f.signal), { code: 'busy' });
    if (dispose) c.service.dispose(); else controller.abort(); finish([record()]);
    await assert.rejects(pending); assert.deepEqual(f.library.read(), before);
  }
});

test('matching never merges distinct songs with the same directory identity', async t => {
  const f = songServices(t); seed(f); seed(f, { id: 'another' }); const c = catalog(f);
  await c.service.backfill(f.signal); await c.service.backfill(f.signal);
  const snapshot = f.library.read().snapshot;
  assert.equal(snapshot.songs.length, 2); assert.equal(snapshot.versions.length, 2); assert.equal(snapshot.redirects.length, 0);
  assert(snapshot.songs.every(song => song.desktopCatalog.record.id === '100'));
});

test('network failure keeps source cover, reports retry status and does not spin immediately', async t => {
  const f = songServices(t); seed(f);
  const c = catalog(f, async () => { throw new Error('offline'); });
  const result = await c.service.backfill(f.signal);
  assert.equal(result.snapshot.songs[0].desktopCatalog.state, 'error'); assert.equal(result.retryAfterMs, 60000);
  assert.equal(desktopCatalogLibrary(result).snapshot.songs[0].artwork, sourceCover);
  await c.service.backfill(f.signal); assert.equal(c.calls.length, 1);
});

test('failed and empty songs retry only after their persisted cooldown; manual selection retains revision checks after I/O', async t => {
  const f = songServices(t); seed(f); let now = Date.now(), calls = 0, failure = true;
  const provider = { search: async () => { calls++; if (failure) throw new Error('offline'); return []; }, records: async () => [record()], dispose() {} };
  const service = new SongCatalogService(f.library, provider, () => now);
  await service.backfill(f.signal); await service.backfill(f.signal); assert.equal(calls, 1);
  now += 3600000; failure = false; await service.backfill(f.signal); assert.equal(calls, 2);
  now += 86400000; await service.backfill(f.signal); assert.equal(calls, 2);
  now += 6 * 86400000; await service.backfill(f.signal); assert.equal(calls, 3);
  let finish; provider.records = async () => new Promise(resolve => { finish = resolve; });
  const selecting = service.select(f.library.revision(), { songId: 'song', id: '100' }, f.signal);
  f.edit([{ type: 'edit-song', songId: 'song', title: '并发歌名' }]);
  finish([record()]); await assert.rejects(selecting, { code: 'conflict' });
  assert.equal(f.library.read().snapshot.songs[0].title, '并发歌名');
  assert.equal(f.library.read().snapshot.songs[0].desktopCatalog.state, 'not-found');
});

test('old and enriched backups round-trip with strict nested catalogue decoding', async t => {
  const f = songServices(t); seed(f); const old = f.library.read().snapshot; delete old.songs[0].fields.artwork;
  assert.deepEqual(decodeSongLibrarySnapshot(JSON.stringify(old)), old);
  await catalog(f).service.backfill(f.signal);
  const saved = f.library.read().snapshot;
  assert.deepEqual(decodeSongLibrarySnapshot(f.library.export()), saved);
  for (const mutate of [s => s.songs[0].desktopCatalog.record.id = '../1', s => s.songs[0].desktopCatalog.record.url = 'https://example.com/song', s => s.songs[0].desktopCatalog.record.extra = true, s => s.songs[0].desktopCatalog.state = 'disabled']) {
    const invalid = structuredClone(saved); mutate(invalid); assert.throws(() => decodeSongLibrarySnapshot(invalid), { code: 'invalid-input' });
  }
});

test('Netease adapter obtains real artwork from detail, caches complete searches and retries failures', async () => {
  const calls = []; let failure = false;
  const provider = new NeteaseSongCatalog(async url => {
    calls.push(url.href); if (failure) return new Response('{}', { status: 429 });
    return Response.json(url.pathname.includes('search') ? { code: 200, result: { songs: [{ id: 100 }] } } : { code: 200, songs: [{ id: 100, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美', picUrl: cover }, duration: 269000 }] });
  });
  assert.deepEqual(await provider.search('晴天 周杰伦', new AbortController().signal), [record()]);
  await provider.search('晴天 周杰伦', new AbortController().signal); assert.equal(calls.length, 2);
  failure = true; await assert.rejects(provider.search('其他', new AbortController().signal), { code: 'rate-limited' });
  failure = false; await provider.search('其他', new AbortController().signal); assert.equal(calls.length, 5); provider.dispose();
});

test('malformed upstream rows are skipped and oversized or invalid response bodies remain retryable', async () => {
  const signal = new AbortController().signal;
  const malformed = new NeteaseSongCatalog(async () => Response.json({ code: 200, songs: [{ id: 100, name: '晴天', artists: { name: '周杰伦' } }] }));
  assert.deepEqual(await malformed.records(['100'], signal), []); malformed.dispose();
  for (const body of ['{', ' '.repeat(2 * 1024 * 1024 + 1)]) {
    const provider = new NeteaseSongCatalog(async () => new Response(body));
    await assert.rejects(provider.search('晴天', signal), { code: 'upstream' }); provider.dispose();
  }
});

test('HTTP catalogue endpoints retain authentication/origin/revision boundaries and require desktop backfill', async t => {
  const f = songServices(t); seed(f); const c = catalog(f), app = new Hono();
  app.route('/library', createSongLibraryRouter(f.library, () => 'browser', f.sources, f.maintenance, undefined, c.service));
  const post = (path, body, headers = {}) => app.request('/library/catalog/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('backfill', {})).status, 400); assert.equal(c.calls.length, 0);
  assert.equal((await post('search', { query: '晴天' }, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await post('search', { query: '' })).status, 400);
  const background = await post('backfill', { surface: 'desktop' }); assert.equal(background.status, 200);
  assert.deepEqual(Object.keys(await background.json()).sort(), ['more', 'revision']);
  assert.equal((await post('select', { revision: 'stale', selection: { songId: 'song', id: '100' } })).status, 409);
  const selected = await post('select', { revision: f.library.revision(), selection: { songId: 'song', id: '100' } }); assert.equal(selected.status, 200);
  assert.equal((await selected.json()).snapshot.songs[0].desktopCatalog.selection, 'manual');
  const unauthenticated = new Hono(); unauthenticated.route('/library', createSongLibraryRouter(f.library, () => '', f.sources, f.maintenance, undefined, c.service));
  assert.equal((await unauthenticated.request('/library/catalog/search', { method: 'POST', headers: { 'X-Music-App': '1' }, body: JSON.stringify({ query: '晴天' }) })).status, 401);
});
