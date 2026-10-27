import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSongModule } from './helpers/song-services.mjs';
const { parseLyrics, activeLyricLine, lyricQuery, automaticLyricCandidates } = await loadSongModule('lyrics-format');
const { LyricsStore, lyricSource, lyricOffset } = await loadSongModule('lyrics-store');
const { LyricProviders } = await loadSongModule('lyrics-providers');
const { createLyricsRouter } = await loadSongModule('lyrics-http');

const ref = { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' };
const signal = () => new AbortController().signal;
const document = { provider: 'netease', id: '123', title: '测试歌曲', artists: ['歌手'], synced: true, lines: [{ startMs: 1000, text: '第一行' }, { startMs: 3000, text: '第二行' }] };
const code = expected => error => error.code === expected;

test('LRC keeps repeated timestamps, file offset, empty interludes and translations; plain text has no fabricated timing', () => {
  const lines = parseLyrics('[ar:歌手]\n[offset:500]\n[00:03.25][00:09.250]重复\n[00:01.00]开始\n[00:05] \n[00:01.000]合唱', '[offset:500]\n[00:03.25]翻译');
  assert.deepEqual(lines, [{ startMs: 500, text: '开始\n合唱' }, { startMs: 2750, text: '重复', translation: '翻译' }, { startMs: 4500, text: '' }, { startMs: 8750, text: '重复' }]);
  assert.deepEqual(parseLyrics('[ti:歌名]\n普通文本\n另一行'), [{ startMs: null, text: '普通文本' }, { startMs: null, text: '另一行' }]);
  assert.equal(activeLyricLine(lines, 3, 500), 0);
  assert.equal(activeLyricLine(lines, 3.25, 500), 1);
  assert.equal(activeLyricLine(lines, 2.5, -500), 1);
  assert.equal(activeLyricLine(lines, 0, 0), -1);
  assert.equal(activeLyricLine(parseLyrics('普通文本'), 100, 0), -1);
  assert.throws(() => parseLyrics('字'.repeat(50000)), code('invalid-input'));
  assert.throws(() => parseLyrics('[00:00]'.repeat(4100)), code('invalid-input'));
  assert.throws(() => parseLyrics(Array.from({ length: 20 }, () => '[00:01]'.repeat(30) + 'x'.repeat(1000)).join('\n')), code('invalid-input'), 'multiple stamps cannot expand a small input into unbounded text');
  assert.deepEqual(lyricQuery('周杰伦《晴天》歌词版'), { title: '晴天', artist: '周杰伦' });
  assert.deepEqual(lyricQuery('晴天', ['周杰伦']), { title: '晴天', artist: '周杰伦' });
  assert.deepEqual(lyricQuery('许茹芸《如果云知道》百万豪装录音棚大声听'), { title: '如果云知道', artist: '许茹芸' });
  assert.deepEqual(lyricQuery('【Hi-Res无损音质】周杰伦《晴天》现场'), { title: '晴天 (Live)', artist: '周杰伦' });
  assert.equal(lyricQuery('精选合集《晴天》《七里香》').artist, '');
  assert.equal(lyricQuery('翻唱《晴天》').artist, '');
});

test('automatic matching requires exact title, version and supporting metadata', () => {
  const row = { provider: 'lrclib', id: '1', title: '晴天', artists: ['周杰伦'], durationSeconds: 269, synced: true };
  const query = { title: '晴天', artist: '周杰伦', durationSeconds: 270 };
  assert.deepEqual(automaticLyricCandidates([row], query), [row]);
  for (const patch of [{ title: '晴天 (Live)' }, { artists: ['翻唱歌手'] }, { durationSeconds: 210 }, { title: '晴天 Remix' }]) assert.equal(automaticLyricCandidates([{ ...row, ...patch }], query).length, 0);
  assert.equal(automaticLyricCandidates([row], { title: '晴天', artist: '' }).length, 0);
  assert.equal(automaticLyricCandidates([row], { title: '晴天', artist: '', durationSeconds: 270 }).length, 1);
  assert.equal(automaticLyricCandidates([row], { title: '晴天', artist: '', durationSeconds: 280 }).length, 0);
});

test('choices survive restart and cache refresh, are scoped to exact part and user, and use CAS even after clearing', t => {
  const parent = resolve('local/lyrics-tests'); mkdirSync(parent, { recursive: true });
  const path = join(mkdtempSync(join(parent, 'run-')), 'lyrics.sqlite');
  const store = new LyricsStore(path, 'first');
  const other = new LyricsStore(path, 'second'); t.after(() => other.close());
  const saved = store.update(ref, null, state => { state.document = document; state.offsetMs = 500; }, signal());
  assert.equal(store.read({ ...ref, part: '901' }).document, null);
  assert.equal(other.read(ref).document, null);
  store.cache({ ...document, title: '缓存已变化' }, Date.now());
  assert.equal(store.read(ref).document.title, document.title);
  assert.throws(() => store.update(ref, null, () => {}, signal()), code('conflict'));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => store.update(ref, saved.revision, state => { state.offsetMs = 600; }, controller.signal), code('cancelled'));
  assert.deepEqual(store.read(ref), saved);
  store.close();
  const reopened = new LyricsStore(path, 'first'); t.after(() => reopened.close());
  assert.deepEqual(reopened.read(ref), saved);
  const cleared = reopened.update(ref, saved.revision, state => { state.document = null; state.offsetMs = 0; }, signal());
  assert.notEqual(cleared.revision, null);
  assert.throws(() => reopened.update(ref, saved.revision, () => {}, signal()), code('conflict'));
  assert.throws(() => lyricSource({ ...ref, url: 'https://example.com' }), code('invalid-input'));
  assert.throws(() => lyricSource({ ...ref, part: undefined }), code('invalid-input'));
  assert.throws(() => lyricOffset(NaN), code('invalid-input'));
  assert.throws(() => lyricOffset(600001), code('invalid-input'));
});

function fixture(t, fetcher) {
  const store = new LyricsStore(':memory:', 'test'), provider = new LyricProviders(store, fetcher);
  t.after(async () => { await provider.dispose(); store.close(); });
  return { store, provider };
}
const lrcRow = { id: 123, trackName: '测试歌曲', artistName: '歌手', duration: 60, albumName: '专辑', syncedLyrics: '[00:01]第一行\n[00:03]第二行', plainLyrics: '第一行\n第二行' };

test('providers preserve partial success and retry failures, sort candidates and fetch/cache trusted metadata', async t => {
  let calls = [], fail = true;
  const { store, provider } = fixture(t, async (input, options) => {
    const url = new URL(input); calls.push(url.href);
    assert.equal(new Headers(options.headers).has('Cookie'), false); assert.equal(options.redirect, 'error');
    if (url.hostname === 'music.163.com') return new Response('{}', { status: fail ? 503 : 200 });
    if (url.pathname === '/api/search') return Response.json([{ ...lrcRow, id: 124, trackName: '测试歌曲 Live', duration: 200 }, lrcRow]);
    return Response.json(lrcRow);
  });
  const result = await provider.search({ title: '测试歌曲', artist: '歌手', durationSeconds: 60 }, signal());
  assert.equal(result.candidates[0].id, '123'); assert.equal('lines' in result.candidates[0], false);
  assert.deepEqual(result.issues, [{ provider: 'netease', code: 'upstream' }]);
  await provider.search({ title: '测试歌曲', artist: '歌手', durationSeconds: 60 }, signal());
  assert.equal(calls.length, 4, 'partial failure must not be cached');
  const body = await provider.document({ provider: 'lrclib', id: '123' }, signal());
  assert.equal(body.lines[1].startMs, 3000); assert.equal(body.title, '测试歌曲');
  assert.equal(calls.length, 4, 'LRCLIB previews reuse text already returned by search');
  const count = calls.length;
  assert.deepEqual(await provider.document({ provider: 'lrclib', id: '123' }, signal()), body);
  assert.equal(calls.length, count);
  assert.equal(store.read(ref).document, null, 'preview/cache never adopts a choice');
  await assert.rejects(provider.document({ provider: 'lrclib', id: 'https://example.com' }, signal()), code('invalid-input'));
  await assert.rejects(provider.search({ title: 'x', durationSeconds: Infinity }, signal()), code('invalid-input'));
});

test('NetEase searches then reads metadata and LRC with translation', async t => {
  const { provider } = fixture(t, async input => {
    const url = new URL(input);
    if (url.hostname === 'lrclib.net') return Response.json([]);
    if (url.pathname.includes('search')) return Response.json({ code: 200, result: { songs: [{ id: 123, name: '测试歌曲', artists: [{ name: '歌手' }], duration: 60000 }] } });
    if (url.pathname.endsWith('detail')) return Response.json({ code: 200, songs: [{ id: 123, name: '测试歌曲', artists: [{ name: '歌手' }], duration: 60000 }] });
    return Response.json({ code: 200, lrc: { lyric: '[00:01]原文' }, tlyric: { lyric: '[00:01]译文' } });
  });
  const results = await provider.search({ title: '测试歌曲' }, signal());
  assert.equal(results.issues.length, 0); assert.equal(results.candidates[0].provider, 'netease');
  const body = await provider.document({ provider: 'netease', id: '123' }, signal());
  assert.deepEqual(body.lines, [{ startMs: 1000, text: '原文', translation: '译文' }]);
});

test('upstream response limits and cancellation reject late responses without caching or adoption', async t => {
  const first = fixture(t, async () => new Response(' '.repeat(4 * 1024 * 1024 + 1)));
  await assert.rejects(first.provider.document({ provider: 'lrclib', id: '123' }, signal()), code('upstream'));
  let release;
  const gate = new Promise(resolve => release = resolve);
  const second = fixture(t, async () => { await gate; return Response.json(lrcRow); });
  const controller = new AbortController(), pending = second.provider.document({ provider: 'lrclib', id: '123' }, controller.signal);
  controller.abort(); release(); await assert.rejects(pending, code('cancelled'));
  assert.equal(second.store.cached('lrclib:123', Date.now()), undefined);
});

test('missing lyrics, malformed metadata and instrumental records retain distinct outcomes', async t => {
  for (const [row, expected] of [[{ ...lrcRow, syncedLyrics: null, plainLyrics: null }, 'not-found'], [{ ...lrcRow, id: 999 }, 'not-found'], [{ ...lrcRow, syncedLyrics: 42, plainLyrics: '' }, 'not-found']]) {
    const { provider } = fixture(t, async () => Response.json(row));
    await assert.rejects(provider.document({ provider: 'lrclib', id: '123' }, signal()), code(expected));
  }
  const { provider } = fixture(t, async () => Response.json({ ...lrcRow, instrumental: true, syncedLyrics: null, plainLyrics: null }));
  const body = await provider.document({ provider: 'lrclib', id: '123' }, signal());
  assert.equal(body.instrumental, true); assert.deepEqual(body.lines, []);
});

test('HTTP enforces auth/origin/strict input; preview is read-only, import/offset/select use revisions and exact source', async t => {
  const { store, provider } = fixture(t, async () => Response.json(lrcRow));
  const app = createLyricsRouter(store, provider, c => c.req.header('X-Test-Owner') ?? '');
  const post = (path, body, headers = {}) => app.request('http://localhost' + path, { method: 'POST', headers: { 'X-Test-Owner': 'user', 'X-Music-App': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/state', { ref }, { 'X-Test-Owner': '' })).status, 401);
  assert.equal((await post('/state', { ref }, { Origin: 'http://evil' })).status, 403);
  assert.equal((await post('/state', { ref }, { 'X-Music-App': '' })).status, 403);
  assert.equal((await post('/state', { ref, user: 'other' })).status, 400);
  assert.equal((await post('/select', { ref, revision: null, candidate: { provider: 'local', id: 'x' } })).status, 400);
  assert.equal((await post('/document', { provider: 'lrclib', id: '123' })).status, 200);
  assert.equal(store.read(ref).revision, null);
  const selected = await (await post('/select', { ref, revision: null, candidate: { provider: 'lrclib', id: '123' } })).json();
  assert.equal(selected.document.id, '123');
  assert.equal((await post('/offset', { ref, revision: null, offsetMs: 300 })).status, 409);
  const shifted = await (await post('/offset', { ref, revision: selected.revision, offsetMs: 500 })).json();
  assert.equal(shifted.offsetMs, 500);
  assert.equal((await post('/import', { ref, revision: shifted.revision, title: '标题', text: '字'.repeat(50000) })).status, 400);
  const imported = await (await post('/import', { ref, revision: shifted.revision, title: '标题', text: '[00:01]本地歌词' })).json();
  assert.equal(imported.document.provider, 'local'); assert.equal(imported.offsetMs, 0);
  assert.equal(store.read({ ...ref, part: '901' }).document, null);
  const plain = await (await post('/import', { ref, revision: imported.revision, title: '标题', text: '纯文本' })).json();
  assert.equal((await post('/offset', { ref, revision: plain.revision, offsetMs: 100 })).status, 400);
});

test('automatic resolution adopts a reliable result, preserves manual choices and offsets, and skips unavailable documents', async t => {
  let searches = 0;
  const { store, provider } = fixture(t, async input => {
    const url = new URL(input);
    if (url.hostname === 'music.163.com') return new Response('{}', { status: 503 });
    searches++;
    return Response.json([{ ...lrcRow, id: 124, syncedLyrics: null, plainLyrics: null }, lrcRow]);
  });
  const app = createLyricsRouter(store, provider, () => 'test');
  const post = body => app.request('http://localhost/resolve', { method: 'POST', headers: { 'X-Music-App': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { ref, title: '测试歌曲', artist: '歌手', durationSeconds: 60 };
  const selected = await (await post(input)).json();
  assert.equal(selected.matched, true); assert.equal(selected.state.document.id, '123');
  const saved = store.update(ref, selected.state.revision, state => { state.offsetMs = 1500; }, signal());
  const before = searches;
  assert.deepEqual((await (await post(input)).json()).state, saved); assert.equal(searches, before);
  assert.equal((await post({ ...input, ref: { ...ref, part: '901' }, artist: '其他歌手' })).status, 200);
  assert.equal(store.read({ ...ref, part: '901' }).document, null);
  assert.equal((await post({ ...input, durationSeconds: -1, ref: { ...ref, part: '902' } })).status, 400);
});

test('automatic resolution leaves ambiguous singers for manual choice and cannot overwrite a concurrent edit', async t => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const { store, provider } = fixture(t, async input => {
    const url = new URL(input);
    if (url.hostname === 'music.163.com') return new Response('{}', { status: 503 });
    await gate;
    return Response.json([lrcRow, { ...lrcRow, id: 124, artistName: '同名歌手' }]);
  });
  const app = createLyricsRouter(store, provider, () => 'test');
  const post = body => app.request('http://localhost/resolve', { method: 'POST', headers: { 'X-Music-App': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const pending = post({ ref, title: '测试歌曲', artist: '歌手', durationSeconds: 60 });
  await new Promise(resolve => setImmediate(resolve));
  const saved = store.update(ref, null, state => { state.document = document; state.offsetMs = -500; }, signal());
  release();
  assert.deepEqual((await (await pending).json()).state, saved);
  const ambiguous = await (await post({ ref: { ...ref, part: '901' }, title: '测试歌曲', durationSeconds: 60 })).json();
  assert.equal(ambiguous.matched, false); assert.equal(ambiguous.state.document, null); assert.equal(ambiguous.candidates.length, 2);
});
