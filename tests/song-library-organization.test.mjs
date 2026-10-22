import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { songServices, loadSongModule, ref } from './helpers/song-services.mjs';

const { planSongOrganization } = await loadSongModule('song-library-organization');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');

function seed(f, { id = 'song', title = '周杰伦《晴天》', source = 'parsed', artists, factsArtists, contentKind } = {}) {
  const number = f.library.read().snapshot.versions.length + 1;
  f.edit([{ type: 'create-song', id, title, source, ...(artists ? { artists } : {}), ...(contentKind ? { contentKind } : {}) }, {
    type: 'add-version', version: { id: 'v-' + id, songId: id, ref: ref(number), label: '', kind: 'other', facts: { title, ...(factsArtists ? { artists: factsArtists } : {}) }, availability: { state: 'unknown' } },
  }, { type: 'favorite', songId: id }]);
}
const preview = (f, owner = 'browser', songId = 'song') => f.library.previewOrganization(owner, songId, f.library.revision());
const adopt = (f, p, fields = ['title', 'artists'], owner = 'browser', candidateId = p.candidates[0].id) => f.library.adoptOrganization(owner, p.token, candidateId, fields, p.revision);

test('local suggestions are read-only; human field selection preserves versions, defaults, pins, members and sync authority', t => {
  const f = songServices(t); seed(f); seed(f, { id: 'same-work' });
  f.edit([{ type: 'create-playlist', id: 'p', name: '重复成员' }, { type: 'add-entry', playlistId: 'p', songId: 'song', pinnedVersionId: 'v-song' }, { type: 'add-entry', playlistId: 'p', songId: 'song' }]);
  f.state.metadata = () => { throw new Error('organization must never request sources'); };
  const before = f.library.read(), document = f.store.read().document, events = f.store.events();
  const p = preview(f);
  assert.deepEqual(p.candidates.map(c => c.patch), [{ title: '晴天', artists: ['周杰伦'] }]);
  assert.deepEqual(f.library.read(), before); assert.deepEqual(f.store.events(), events);
  p.candidates[0].patch.title = '页面伪造'; p.current.title = '页面伪造';
  const saved = adopt(f, p, ['title']);
  const song = saved.snapshot.songs.find(s => s.id === 'song');
  assert.equal(song.title, '晴天'); assert.equal(song.artists, undefined);
  assert.deepEqual(song.fields.title, { source: 'manual', protected: true });
  assert.deepEqual(song.fields.artists, before.snapshot.songs[0].fields.artists);
  assert.equal(song.organization, 'organized'); assert(song.aliases.includes('周杰伦《晴天》'));
  for (const key of ['versions', 'favorites', 'playlists', 'catalogLinks', 'redirects']) assert.deepEqual(saved.snapshot[key], before.snapshot[key]);
  assert.deepEqual(saved.snapshot.songs[1], before.snapshot.songs[1]);
  for (const key of ['origins', 'syncMappings', 'syncLinks']) assert.deepEqual(f.store.read().document[key], document[key]);
  assert.throws(() => adopt(f, p, ['title']), { code: 'expired' });
  const next = preview(f); assert.deepEqual(next.candidates[0].patch, { artists: ['周杰伦'] });
  const filled = adopt(f, next, ['artists']); assert.equal(filled.snapshot.songs[0].title, '晴天'); assert.deepEqual(filled.snapshot.songs[0].artists, ['周杰伦']);
  assert.equal(preview(f).candidates.length, 0);
});

test('manual protection is per field and catalog precedence survives parsed candidates', t => {
  const f = songServices(t); seed(f);
  f.edit([{ type: 'edit-song', songId: 'song', title: '人工保留歌名' }]);
  const p = preview(f); assert.deepEqual(p.candidates[0].patch, { artists: ['周杰伦'] });
  const before = f.library.read();
  assert.throws(() => adopt(f, p, ['title']), { code: 'invalid-input' }); assert.deepEqual(f.library.read(), before);
  const saved = adopt(f, p, ['artists']); assert.equal(saved.snapshot.songs[0].title, '人工保留歌名');
  seed(f, { id: 'catalog', title: '目录原名', source: 'catalog', artists: ['目录歌手'] });
  f.library.transaction(f.library.revision(), c => { c.document.snapshot.versions.find(v => v.songId === 'catalog').facts.title = '其他歌手《其他歌名》'; });
  assert.equal(preview(f, 'browser', 'catalog').candidates.length, 0);
});

test('explicit quotes and known metadata produce candidates; ambiguous orders, collections and multiple titles never merge', t => {
  const f = songServices(t);
  for (const [id, title, expected] of [
    ['quoted', '【Hi-Res】周杰伦《晴天》', [{ title: '晴天', artists: ['周杰伦'] }]],
    ['reverse', '《晴天》 - 周杰伦', [{ title: '晴天', artists: ['周杰伦'] }]],
    ['unknown-order', '周杰伦 - 晴天', [{ title: '晴天', artists: ['周杰伦'] }, { title: '周杰伦', artists: ['晴天'] }]],
    ['collection', '周杰伦歌曲合集《晴天》', []],
    ['medley', '周杰伦《晴天》《七里香》', []],
    ['uploader', '《晴天》', [{ title: '晴天' }]],
  ]) {
    seed(f, { id, title });
    const snapshot = f.library.read().snapshot, p = planSongOrganization(snapshot, id);
    assert.deepEqual(p.candidates.map(c => c.patch), expected, id);
    assert.equal(snapshot.songs.length, f.library.read().snapshot.songs.length);
    if (id === 'unknown-order') assert(p.warnings.some(w => w.includes('多种解释')));
  }
  seed(f, { id: 'known', title: '晴天 - 周杰伦', factsArtists: ['周杰伦'] });
  assert.deepEqual(preview(f, 'browser', 'known').candidates.map(c => c.patch), [{ title: '晴天', artists: ['周杰伦'] }]);
  seed(f, { id: 'manual-collection', title: '周杰伦《晴天》', contentKind: 'collection' });
  assert.equal(preview(f, 'browser', 'manual-collection').candidates.length, 0);
  assert.equal(f.library.read().snapshot.redirects.length, 0);
});

test('title descriptions never become protected artist suggestions; explicit names and metadata remain usable', t => {
  const f = songServices(t);
  const titles = [
    '《晴天》官方MV', '《晴天》歌词版', '《晴天》这首歌真的太好听了',
    '《晴天》 - 官方MV', '《晴天》 - 歌词版', '《晴天》 - Official Music Video',
    '《晴天》 - Lyric Video', '官方MV《晴天》', '歌词版《晴天》',
  ];
  for (const [index, title] of titles.entries()) {
    const id = 'description-' + index;
    seed(f, { id, title });
    const before = f.library.read().snapshot.songs.find(s => s.id === id);
    const p = preview(f, 'browser', id);
    assert.deepEqual(p.candidates.map(c => c.patch), [{ title: '晴天' }], title);
    assert(p.warnings.some(w => w.includes('多种解释')), title);
    assert.throws(() => adopt(f, p, ['artists']), { code: 'invalid-input' });
    const saved = adopt(f, p, ['title']).snapshot.songs.find(s => s.id === id);
    assert.equal(saved.title, '晴天');
    assert.equal(saved.artists, undefined);
    assert.deepEqual(saved.fields.artists, before.fields.artists);
  }
  seed(f, { id: 'metadata-description', title: '《晴天》官方MV', factsArtists: ['周杰伦'] });
  assert.deepEqual(preview(f, 'browser', 'metadata-description').candidates.map(c => c.patch), [{ title: '晴天', artists: ['周杰伦'] }]);
});

test('preview tokens are session-owned, replaceable, expiring, bounded and cleared on revocation', t => {
  const f = songServices(t); seed(f);
  let now = Date.now() + 1000;
  const service = new SongLibraryService(f.store, () => now), revision = service.revision();
  const first = service.previewOrganization('one', 'song', revision);
  assert.throws(() => service.adoptOrganization('two', first.token, '1', ['title'], revision), { code: 'expired' });
  const second = service.previewOrganization('one', 'song', revision);
  assert.throws(() => service.adoptOrganization('one', first.token, '1', ['title'], revision), { code: 'expired' });
  now += 5 * 60000;
  assert.throws(() => service.adoptOrganization('one', second.token, '1', ['title'], revision), { code: 'expired' });
  for (let i = 0; i < 32; i++) service.previewOrganization('owner-' + i, 'song', revision);
  assert.throws(() => service.previewOrganization('extra', 'song', revision), { code: 'busy' });
  service.cancelOwner('owner-0');
  const extra = service.previewOrganization('extra', 'song', revision); service.cancelOwner('extra');
  assert.throws(() => service.adoptOrganization('extra', extra.token, '1', ['title'], revision), { code: 'expired' });
  assert.equal(f.library.revision(), revision);
});

test('stale, cancelled and invalid selections cannot overwrite concurrent edits or partially apply fields', t => {
  const f = songServices(t); seed(f); const p = preview(f), before = f.library.read();
  for (const fields of [[], ['title', 'title'], ['organization'], ['title', 'artists', 'defaultVersionId'], null]) assert.throws(() => adopt(f, p, fields), { code: 'invalid-input' });
  assert.throws(() => adopt(f, p, ['title'], 'browser', 'forged'), { code: 'invalid-input' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => f.library.previewOrganization('browser', 'song', p.revision, controller.signal), { code: 'cancelled' });
  assert.throws(() => f.library.adoptOrganization('browser', p.token, '1', ['title'], p.revision, controller.signal), { code: 'cancelled' });
  assert.deepEqual(f.library.read(), before);
  f.edit([{ type: 'edit-song', songId: 'song', artists: ['并发人工歌手'] }]);
  const concurrent = f.library.read(); assert.throws(() => adopt(f, p), { code: 'conflict' }); assert.deepEqual(f.library.read(), concurrent);
  assert.throws(() => f.library.previewOrganization('browser', 'song', p.revision), { code: 'conflict' });
  const fresh = preview(f); assert.deepEqual(fresh.candidates[0].patch, { title: '晴天' });
  assert.equal(adopt(f, fresh, ['title']).snapshot.songs[0].artists[0], '并发人工歌手');
});

test('candidate work and retained evidence are bounded without truncating values into a different identity', t => {
  const f = songServices(t); seed(f);
  f.library.transaction(f.library.revision(), c => {
    for (let i = 1; i < 30; i++) c.document.snapshot.versions.push({ ...structuredClone(c.document.snapshot.versions[0]), id: 'extra-' + i, ref: ref(i + 1), facts: { title: '歌手' + i + '《歌曲' + i + '》' } });
  });
  const p = preview(f); assert.equal(p.candidates.length, 6); assert.equal(p.limited, true); assert(p.candidates.every(c => c.evidence.length <= 3));
  seed(f, { id: 'long', title: '歌手《' + '长'.repeat(201) + '》' });
  assert.equal(preview(f, 'browser', 'long').candidates.length, 0);
});

test('HTTP organization uses the host identity, same-origin and strict bodies, and never accepts client candidate values', async t => {
  const f = songServices(t); seed(f);
  const app = new Hono(); app.route('/api/song-library', createSongLibraryRouter(f.library, c => c.req.header('X-Test-Owner') ?? ''));
  const call = async (path, body, headers = {}) => {
    const response = await app.request('http://local/api/song-library/organization/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1', 'X-Test-Owner': 'one', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const revision = f.library.revision(), request = { revision, songId: 'song' };
  assert.equal((await call('preview', request, { 'X-Test-Owner': '' })).status, 401);
  assert.equal((await call('preview', request, { Origin: 'http://evil' })).status, 403);
  assert.equal((await call('preview', request, { 'X-Music-App': '' })).status, 403);
  assert.equal((await call('preview', { ...request, userSpace: 'another' })).status, 400);
  const result = await call('preview', request); assert.equal(result.status, 200);
  const adoption = { revision, token: result.data.token, candidateId: '1', fields: ['title'] };
  assert.equal((await call('adopt', adoption, { 'X-Test-Owner': 'two' })).status, 410);
  assert.equal((await call('adopt', { ...adoption, patch: { title: '伪造' } })).status, 400);
  assert.equal((await call('adopt', { ...adoption, fields: ['defaultVersionId'] })).status, 400);
  const saved = await call('adopt', adoption); assert.equal(saved.status, 200); assert.equal(saved.data.snapshot.songs[0].title, '晴天');
});
