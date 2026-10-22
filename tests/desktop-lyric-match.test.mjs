import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSongModule } from './helpers/song-services.mjs';

const { desktopLyricQuery, desktopLyricArtistKey } = await loadSongModule('desktop-lyric-match');
const { lyricQuery, automaticLyricCandidates } = await loadSongModule('lyrics-format');
const { LyricsStore } = await loadSongModule('lyrics-store');
const { LyricProviders } = await loadSongModule('lyrics-providers');
const { createLyricsRouter } = await loadSongModule('lyrics-http');
const sourceTitle = '《兰亭序》周杰伦 | 百万级录音棚试听 | 【Hi-Res无损】';
const row = { id: 18878863, trackName: '兰亭序', artistName: '周杰伦', duration: 253.96, albumName: '魔杰座', syncedLyrics: '[00:01]歌词' };

test('desktop extracts a trailing singer without treating promotional text or cover credits as a singer', () => {
  for (const title of [sourceTitle, '【Hi-Res无损】《兰亭序》周杰伦', '《兰亭序》- 周杰伦 | 录音棚试听']) {
    assert.deepEqual(desktopLyricQuery(title), { title: '兰亭序', artist: '周杰伦' });
  }
  assert.deepEqual(desktopLyricQuery('《兰亭序》Jay Chou | Hi-Res'), { title: '兰亭序', artist: 'Jay Chou' });
  assert.deepEqual(desktopLyricQuery('《兰亭序》周杰伦 (Live) | 现场'), { title: '兰亭序 (Live)', artist: '周杰伦' });
  assert.deepEqual(desktopLyricQuery(sourceTitle, ['翻唱歌手']), { title: '兰亭序', artist: '翻唱歌手' });
  assert.deepEqual(desktopLyricQuery('周杰伦《晴天》歌词版'), lyricQuery('周杰伦《晴天》歌词版'));
  for (const title of ['《兰亭序》百万级录音棚试听', '《兰亭序》无损音质', '《兰亭序》歌词版', '翻唱《兰亭序》周杰伦', '《兰亭序》原唱周杰伦', '《兰亭序》周杰伦 cover', '精选《兰亭序》《晴天》周杰伦']) {
    assert.equal(desktopLyricQuery(title).artist, '', title);
  }
  assert.deepEqual(lyricQuery(sourceTitle), { title: '兰亭序', artist: '' }, 'mobile retains its original parsing');
});

test('desktop uses registered aliases while preserving title, version, singer and duration requirements', () => {
  const query = { title: '兰亭序', artist: '周杰伦', durationSeconds: 253 };
  const candidate = { provider: 'lrclib', id: '1', title: '兰亭序', artists: ['Jay Chou'], durationSeconds: 253.96, synced: true };
  for (const artist of ['Jay Chou', 'JAY CHOU', '周傑倫', '周杰倫', '周杰伦']) {
    assert.equal(automaticLyricCandidates([{ ...candidate, artists: [artist] }], query, desktopLyricArtistKey).length, 1);
  }
  for (const patch of [{ title: '兰亭序 (Live)' }, { title: '兰亭序 Remix' }, { title: '晴天' }, { artists: ['Jay Chou Tribute'] }, { artists: ['另一歌手'] }, { durationSeconds: 230 }]) {
    assert.equal(automaticLyricCandidates([{ ...candidate, ...patch }], query, desktopLyricArtistKey).length, 0);
  }
  assert.equal(automaticLyricCandidates([candidate], query).length, 0, 'mobile does not gain alias matching');
});

test('desktop resolves the reported source and alias-only records; genuine ambiguity and mobile behavior remain protected', async t => {
  const resolve = async (records, query, desktop = true, failed = false) => {
    const store = new LyricsStore(':memory:', 'matching');
    const provider = new LyricProviders(store, async input => new URL(input).hostname === 'music.163.com'
      ? failed ? new Response('', { status: 503 }) : Response.json({ code: 200, result: { songs: [] } })
      : Response.json(records));
    t.after(() => { provider.dispose(); store.close(); });
    const app = createLyricsRouter(store, provider, () => 'matching');
    const ref = { provider: 'bilibili', kind: 'video', id: 'BV1hRnJ6fE3K', part: '1' };
    const response = await app.request('http://localhost/resolve', { method: 'POST', headers: { 'X-Music-App': '1', 'Content-Type': 'application/json', ...(desktop ? { 'X-SlowTune-Surface': 'desktop' } : {}) }, body: JSON.stringify({ ref, durationSeconds: 253, ...query }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const aliases = [row, { ...row, id: 17992468, artistName: 'Jay Chou' }];
  const reported = await resolve(aliases, desktopLyricQuery(sourceTitle));
  assert.equal(reported.matched, true); assert.equal(reported.state.document.id, '18878863');
  assert.equal((await resolve(aliases, { title: '兰亭序', artist: '' })).matched, true, 'registered aliases do not create ambiguity');
  assert.equal((await resolve(aliases, { title: '兰亭序', artist: '' }, false)).matched, false, 'mobile keeps the old ambiguity decision');
  assert.equal((await resolve([aliases[1]], { title: '兰亭序', artist: '周傑倫' })).matched, true, 'document recheck also accepts aliases');
  const different = [row, { ...row, id: 3, artistName: '另一歌手' }];
  assert.equal((await resolve(different, { title: '兰亭序', artist: '' })).matched, false, 'different singers stay ambiguous');
  assert.equal((await resolve(aliases, { title: '兰亭序', artist: '' }, true, true)).matched, false, 'unknown singer plus incomplete search stays manual');
});
