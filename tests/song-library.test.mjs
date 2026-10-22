import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = process.env.MUSIC_APP_TEST_BUILD ?? fileURLToPath(new URL('..', import.meta.url));
const moduleUrl = pathToFileURL(join(root, 'dist/server/song-library-store.js')).href;
const load = name => import(pathToFileURL(join(root, 'dist/server', name + '.js')).href);
const { SongLibraryStore, decodeSongDocument } = await load('song-library-store');
const { SongLibraryService } = await load('song-library-service');
const { decodeSongLibrarySnapshot: decode, encodeSongLibrarySnapshot: encode, emptySongLibrary } = await load('song-library-codec');
const { updateAutomaticSong, updateVersionFacts } = await load('song-library-edits');
const { createSongLibraryRouter, readSongBody } = await load('song-library-http');
const { catalogSongKey, chooseSongVersion } = await load('song-library-policy');
const { maxSongLibrarySnapshotBytes: maxBytes } = await load('song-library-types');
const { initializeSongLibrary } = await import('../scripts/song-library-init.mjs');
const version = (id = 'v1', songId = 's1', part = '10', bvid = 'BV0000000001') => ({ id, songId, ref: { provider: 'bilibili', kind: 'video', id: bvid, part }, label: '录音室', kind: 'studio', performers: ['演唱者'], facts: { title: '视频原标题', uploader: '上传者', durationSeconds: 123, url: 'https://www.bilibili.com/video/' + bvid }, availability: { state: 'unknown' } });
const song = (id = 's1') => ({ id, title: '标准歌名', artists: ['歌手'], contentKind: 'single', fields: { title: { source: 'manual', protected: true }, artists: { source: 'catalog', protected: false } }, originals: [{ title: '初始名', artists: ['原歌手'] }], aliases: ['历史人工名'], defaultVersionId: null, organization: 'organized', createdAt: 1, updatedAt: 2 });
function fixture() {
  return { ...emptySongLibrary(), songs: [{ ...song(), defaultVersionId: 'v1' }, { ...song('s2'), title: '另一首', defaultVersionId: 'v2' }], versions: [version(), version('v2', 's2', '20')], favorites: [{ favoriteId: 'f1', songId: 's1', position: 0, addedAt: 30 }, { favoriteId: 'f2', songId: 's2', position: 1, addedAt: 5 }], playlists: [{ id: 'p1', name: '重复成员', createdAt: 1, updatedAt: 2, entries: [{ entryId: 'e1', songId: 's1', position: 0, addedAt: 1, pinnedVersionId: 'v1' }, { entryId: 'e2', songId: 's1', position: 1, addedAt: 2, pinnedVersionId: null }] }] };
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'slowtune-song-v1-')), path = join(directory, 'songs.sqlite');
  const stores = []; const open = (scope = 'alice') => { const store = new SongLibraryStore(path, scope, () => 100); stores.push(store); return new SongLibraryService(store, () => 100); };
  t.after(async () => { for (const store of stores) store.close(); assert(directory.startsWith(join(tmpdir(), 'slowtune-song-v1-'))); await rm(directory, { recursive: true, force: true }); });
  return { path, open, directory };
}
function restore(service, data = fixture(), mode = 'replace', owner = 'browser') { const p = service.previewImport(owner, data, mode, service.read().revision); assert.deepEqual(p.impact.conflicts, []); return service.commitImport(owner, p.token, p.revision); }
function syncDocument(context) {
  context.document.syncLinks.push({ id: 'link', accountId: '123', folderId: '10', targetId: 'p1', state: 'ready', issues: [] });
  for (const entryId of ['e1', 'e2']) context.document.syncMappings.push({ linkId: 'link', member: { kind: 'playlist-entry', playlistId: 'p1', entryId }, bvid: 'BV0000000001', versionId: 'v1' });
}

test('strict new format roundtrip preserves manual fields, exact P, member IDs, pins, time and explicit order', () => {
  const original = fixture(), decoded = decode(encode(original)); assert.deepEqual(decoded, original); decoded.songs[0].title = 'mutated'; assert.equal(original.songs[0].title, '标准歌名');
  assert.deepEqual(original.favorites.map(f => f.addedAt), [30, 5]);
  assert.throws(() => decode({ format: 'studio-music-library', version: 1, playlists: [], favorites: [] }), { code: 'invalid-input' });
  assert.throws(() => decode({ ...original, version: 2 }), { code: 'unknown-version' });
});

test('all nested untrusted schema, enum, number, URL and relation violations are rejected', async t => {
  const corruptions = {
    'unknown top-level': d => { d.credentials = 'secret'; },
    'unknown song field': d => { d.songs[0].token = 'secret'; },
    'unknown field state': d => { d.songs[0].fields.title.extra = true; },
    'manual unprotected': d => { d.songs[0].fields.title.protected = false; },
    'bad original': d => { d.songs[0].originals[0].artists = [null]; },
    'bad aliases': d => { d.songs[0].aliases = [1]; },
    'missing default': d => { delete d.songs[0].defaultVersionId; },
    'bad timestamp': d => { d.songs[0].updatedAt = 0; },
    'foreign default': d => { d.songs[0].defaultVersionId = 'v2'; },
    'foreign pin': d => { d.playlists[0].entries[0].pinnedVersionId = 'v2'; },
    'bad order': d => { d.favorites[1].position = 0; },
    'duplicate member': d => { d.playlists[0].entries[1].entryId = 'e1'; },
    'duplicate song favorite': d => { d.favorites[1].songId = 's1'; },
    'duplicate exact source': d => { d.versions[1].ref = { ...d.versions[0].ref }; },
    'missing cid': d => { delete d.versions[0].ref.part; },
    'non-numeric cid': d => { d.versions[0].ref.part = 'first'; },
    'youtube part': d => { d.versions[0].ref = { provider: 'youtube', kind: 'video', id: 'abcdefghijk', part: '10' }; },
    'source runtime field': d => { d.versions[0].ref.token = 'bad'; },
    'unsupported provider': d => { d.versions[0].ref.provider = 'unknown'; },
    'unsupported source kind': d => { d.versions[0].ref.kind = 'playlist'; },
    'facts credentials': d => { d.versions[0].facts.cookie = 'bad'; },
    'temporary url': d => { d.versions[0].facts.url = 'https://x.invalid/?token=secret'; },
    'media delivery': d => { d.versions[0].facts.url = 'https://a.bilivideo.com/audio.mp4'; },
    'bad cover': d => { d.songs[0].artwork = 'javascript:alert(1)'; },
    'infinite duration': d => { d.versions[0].facts.durationSeconds = Infinity; },
    'availability extras': d => { d.versions[0].availability = { state: 'unknown', checkedAt: 1 }; },
    'availability missing code': d => { d.versions[0].availability = { state: 'uncertain', checkedAt: 1 }; },
    'dangling redirect': d => { d.redirects = [{ from: 'gone', to: 'missing' }]; },
    'redirect cycle': d => { d.redirects = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]; },
    'catalog mismatch': d => { d.catalogLinks = [{ id: 'c', songId: 's1', key: 'wrong', context: { source: 'qq', title: '歌' } }]; },
    'missing arrays': d => { delete d.versions; },
    'wrong primitive': d => { d.songs = [null]; },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) await t.test(name, () => { const d = fixture(); corrupt(d); assert.throws(() => decode(d)); });
  for (const value of [null, [], 1, 'null', '{', JSON.parse('{"__proto__":{},"format":"slowtune-library"}')]) assert.throws(() => decode(value));
});

test('64 MiB includes UTF-8 bytes and whitespace; encoder uses the same bound', () => {
  const base = encode(emptySongLibrary()), exact = base + ' '.repeat(maxBytes - Buffer.byteLength(base));
  assert.deepEqual(decode(exact), emptySongLibrary()); assert.throws(() => decode(exact + ' '), { code: 'invalid-input' });
  assert.throws(() => decode(exact + '歌'), { code: 'invalid-input' });
  const large = emptySongLibrary(); large.songs = Array.from({ length: 7 }, (_, i) => ({ ...song('large-' + i), aliases: Array(10000).fill('x'.repeat(999)) }));
  assert.throws(() => encode(large), { code: 'invalid-input' });
});

test('SQLite isolates users; snapshot, contributions, mappings, events and revision commit or roll back together', async t => {
  const { open } = await setup(t), a = open(), b = open('bob'); restore(a);
  assert.equal(b.read().snapshot.songs.length, 0);
  const before = a.read();
  assert.throws(() => a.transaction(before.revision, c => { syncDocument(c); c.events.push({ type: 'sync-review', linkId: 'link' }); throw new Error('injected'); }));
  assert.deepEqual(a.read(), before); assert.equal(a.store.events().filter(e => e.type === 'sync-review').length, 0);
  const controller = new AbortController();
  assert.throws(() => a.transaction(before.revision, c => { syncDocument(c); controller.abort(); }, controller.signal), { code: 'cancelled' });
  assert.deepEqual(a.read(), before);
  assert.throws(() => a.transaction(before.revision, c => { syncDocument(c); c.document.snapshot.songs[0].title = 'must roll back after SQL write'; c.events.push({ type: 'sync-intent', linkId: 'link', bvid: 'BV0000000009', action: 'add' }); }), { code: 'invalid-input' });
  assert.deepEqual(a.read(), before);
  const committed = a.transaction(before.revision, c => { syncDocument(c); c.events.push({ type: 'sync-review', linkId: 'link' }); });
  assert.equal(committed.document.syncMappings.length, 2); assert.equal(a.store.events().at(-1).revision, committed.revision);
  const stale = before.revision; assert.throws(() => a.execute(stale, [{ type: 'edit-song', songId: 's1', title: 'lost' }]), { code: 'conflict', currentRevision: committed.revision });
  assert.equal(a.read().snapshot.songs[0].title, '标准歌名'); assert.deepEqual(b.store.events(), []);
  const changed = a.read(); changed.snapshot.songs[0].title = 'external'; assert.equal(a.read().snapshot.songs[0].title, '标准歌名');
});

test('revision probes skip document reads; cached snapshots remain isolated and observe other writers', async t => {
  const {open}=await setup(t),a=open(),b=open();
  assert.equal(a.revision(),null);restore(a);
  const first=a.read();
  assert.equal(a.revision(),first.revision);
  first.snapshot.songs[0].title='caller mutation';
  assert.equal(a.read().snapshot.songs[0].title,'标准歌名');
  const saved=b.execute(b.revision(),[{type:'edit-song',songId:'s1',title:'另一个实例'}]);
  assert.equal(a.revision(),saved.revision);assert.equal(a.read().snapshot.songs[0].title,'另一个实例');
  saved.snapshot.songs[0].title='returned transaction mutation';
  assert.equal(b.read().snapshot.songs[0].title,'另一个实例');
  assert.throws(()=>a.transaction(a.revision(),c=>{c.document.snapshot.songs[0].title='rollback';throw new Error('rollback');}));
  assert.equal(a.read().snapshot.songs[0].title,'另一个实例');
  const revision=a.revision();
  a.read=()=>{throw new Error('revision endpoint must not decode a snapshot');};
  const response=await createSongLibraryRouter(a,()=> 'browser').request('/events');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{revision});
});

test('normal edits preserve manual fields, exact source ownership, duplicate playlist instances and full permutations', async t => {
  const { open } = await setup(t), service = open();
  let state = service.execute(null, [{ type: 'create-song', id: 's1', title: '原名', source: 'parsed' }, { type: 'add-version', version: version() }, { type: 'favorite', songId: 's1' }, { type: 'create-playlist', id: 'p', name: '列表' }, { type: 'add-entry', playlistId: 'p', entryId: 'a', songId: 's1' }, { type: 'add-entry', playlistId: 'p', entryId: 'b', songId: 's1' }]);
  const originalFavorite = state.snapshot.favorites[0];
  assert.equal(service.execute(state.revision, [{ type: 'favorite', songId: 's1' }]).revision, state.revision, 'repeated local favorite is an idempotent no-op');
  state = service.execute(state.revision, [{ type: 'favorite', songId: 's1' }, { type: 'edit-song', songId: 's1', title: '人工名' }, { type: 'add-version', version: version('alternate', 's1', '20') }, { type: 'reorder-entries', playlistId: 'p', entryIds: ['b', 'a'] }]);
  assert.deepEqual(state.snapshot.favorites[0], originalFavorite); assert.equal(state.snapshot.songs[0].defaultVersionId, 'v1'); assert.deepEqual(state.snapshot.playlists[0].entries.map(e => e.entryId), ['b', 'a']);
  service.transaction(state.revision, c => { updateAutomaticSong(c, 's1', { title: '自动名', artists: ['补充歌手'] }, 'catalog', 110); updateVersionFacts(c, 'v1', { title: '刷新来源' }, { state: 'available', checkedAt: 110 }); });
  state = service.read(); assert.equal(state.snapshot.songs[0].title, '人工名'); assert.deepEqual(state.snapshot.songs[0].artists, ['补充歌手']); assert.equal(state.snapshot.versions[0].label, '录音室');
  for (const edit of [{ type: 'reorder-entries', playlistId: 'p', entryIds: ['a', 'a'] }, { type: 'create-song', id: 's2', title: '第二首', injected: true }]) assert.throws(() => service.execute(state.revision, [edit]));
  assert.deepEqual(service.read(), state);
  assert.throws(() => service.execute(state.revision, [{ type: 'create-song', id: 's2', title: '同名' }, { type: 'add-version', version: version('steal', 's2') }]), { code: 'duplicate' }); assert.deepEqual(service.read(), state);
});

test('manual title editing leaves absent artists available for enrichment and preserves original catalog identity', async t => {
  const { open } = await setup(t), service = open(), context = { source: 'qq', title: '榜单原名', artists: ['原歌手'], rank: 1 };
  let state = service.execute(null, [{ type: 'create-song', id: 's', title: '人工标题', context }]);
  service.transaction(state.revision, c => updateAutomaticSong(c, 's', { title: '自动标题', artists: ['补充歌手'] }, 'catalog', 101));
  state = service.read(); assert.equal(state.snapshot.songs[0].title, '人工标题'); assert.deepEqual(state.snapshot.songs[0].artists, ['补充歌手']); assert.equal(state.snapshot.catalogLinks[0].key, catalogSongKey(context));
  const exported = service.export(); restore(service, exported); assert.deepEqual(service.read().snapshot, state.snapshot);
  service.transaction(service.read().revision, c => updateAutomaticSong(c, 's', { artists: ['低优先级'] }, 'parsed', 102)); assert.deepEqual(service.read().snapshot.songs[0].artists, ['补充歌手']);
});

test('duplicate version commands are fully decoded and reject invalid unused facts', async t => {
  const { open } = await setup(t), service = open(); restore(service); const state = service.read(), invalid = version('duplicate'); invalid.facts.durationSeconds = 'invalid';
  assert.throws(() => service.execute(state.revision, [{ type: 'add-version', version: invalid }]), { code: 'invalid-input' }); assert.deepEqual(service.read(), state);
});

test('mapping checks bind account/link/target/member/song/version and disallow dangling contributions', async t => {
  const { open } = await setup(t), service = open(); restore(service); service.transaction(service.read().revision, syncDocument);
  const good = service.store.read().document;
  for (const mutate of [d => { d.syncMappings[0].versionId = 'v2'; }, d => { d.syncMappings[0].linkId = 'absent'; }, d => { d.syncMappings[0].bvid = 'BV0000000009'; }, d => { d.syncLinks[0].targetId = 'system:favorites'; }, d => { d.origins.pop(); }, d => { d.syncMappings.push({ ...d.syncMappings[0] }); }, d => { d.origins[0].local = 'unknown'; }]) { const value = structuredClone(good); mutate(value); assert.throws(() => decodeSongDocument(value)); }
});

test('removing one duplicate member preserves BV; last reference queues one durable intent for its link', async t => {
  const { open } = await setup(t), service = open(); restore(service); service.transaction(service.read().revision, syncDocument);
  service.execute(service.read().revision, [{ type: 'remove-entry', playlistId: 'p1', entryId: 'e1' }]);
  assert.equal(service.store.read().document.syncMappings.length, 1); assert.equal(service.store.events().filter(e => e.type === 'sync-intent').length, 0);
  service.execute(service.read().revision, [{ type: 'remove-entry', playlistId: 'p1', entryId: 'e2' }]);
  assert.deepEqual(service.store.events().filter(e => e.type === 'sync-intent').map(e => [e.linkId, e.bvid, e.action]), [['link', 'BV0000000001', 'remove']]);
  assert.equal(service.read().snapshot.songs.length, 2);
});

test('append preserves existing favorite identity/time/order and appends backup order; conflicts block all writes', async t => {
  const { open } = await setup(t), service = open(), initial = fixture(); initial.favorites = [initial.favorites[1]]; initial.favorites[0].position = 0; restore(service, initial);
  const incoming = fixture(); incoming.favorites[1].favoriteId = 'other-f2';
  const p = service.previewImport('browser', incoming, 'append', service.read().revision); assert.equal(p.impact.reusedFavorites, 1);
  service.commitImport('browser', p.token, p.revision);
  assert.deepEqual(service.read().snapshot.favorites.map(f => [f.favoriteId, f.addedAt, f.position]), [['f2', 5, 0], ['f1', 30, 1]]);
  const before = service.read(), conflicting = fixture(); conflicting.songs[0].title = 'overwrite human';
  const blocked = service.previewImport('browser', conflicting, 'append', before.revision); assert(blocked.impact.conflicts.some(c => c.kind === 'song'));
  assert.throws(() => service.commitImport('browser', blocked.token, before.revision), { code: 'duplicate' }); assert.deepEqual(service.read(), before);
});

test('replace restores all portable data, makes every member local, suspends affected sync and cancels old intents atomically', async t => {
  const { open } = await setup(t), service = open(); restore(service);
  service.transaction(service.read().revision, c => { syncDocument(c); c.document.origins.filter(o => o.member.kind === 'playlist-entry').forEach(o => o.local = 'absent'); c.events.push({ type: 'sync-intent', linkId: 'link', bvid: 'BV0000000001', action: 'add' }); });
  const exported = service.export(); assert(!exported.includes('accountId')); assert(!exported.includes('syncMappings'));
  restore(service, exported);
  const d = service.store.read().document; assert.deepEqual(d.snapshot, fixture()); assert(d.origins.every(o => o.local === 'present')); assert.equal(d.syncMappings.length, 0); assert.equal(d.syncLinks[0].state, 'review');
  assert.equal(service.store.events().filter(e => e.type === 'sync-intent').length, 0); assert(service.store.events().some(e => e.type === 'sync-review'));
});

test('append marks only affected associations for confirmation and keeps local order, mappings and manual metadata', async t => {
  const { open } = await setup(t), service = open(); restore(service);
  service.transaction(service.read().revision, c => { syncDocument(c); c.document.syncLinks.push({ id: 'unaffected', accountId: '456', folderId: '99', targetId: 'system:favorites', state: 'ready', issues: [] }); });
  const incoming = fixture(); incoming.favorites = []; const before = service.read().snapshot;
  const p = service.previewImport('browser', incoming, 'append', service.read().revision); assert.deepEqual(p.impact.reviewLinks, ['link']); service.commitImport('browser', p.token, p.revision);
  const current = service.store.read().document; assert.equal(current.syncLinks.find(l => l.id === 'unaffected').state, 'ready'); assert.equal(current.syncMappings.length, 2); assert.deepEqual(current.snapshot, before);
});

test('deleting a linked target suppresses remote intents and persists only a confirmation event', async t => {
  const { open } = await setup(t), service = open(); restore(service); service.transaction(service.read().revision, syncDocument);
  service.execute(service.read().revision, [{ type: 'delete-playlist', playlistId: 'p1' }]); assert.equal(service.store.events().filter(e => e.type === 'sync-intent').length, 0); assert(service.store.events().some(e => e.type === 'sync-review')); assert.equal(service.store.read().document.syncLinks[0].state, 'review');
});

test('preview is session-owned, expiring, bounded, single-use, and cannot overwrite changes after preview', async t => {
  const { open } = await setup(t), service = open(); const p = service.previewImport('one', fixture(), 'replace', null);
  assert.throws(() => service.commitImport('two', p.token, null), { code: 'expired' });
  service.execute(null, [{ type: 'create-song', id: 'new', title: 'new' }]); assert.throws(() => service.commitImport('one', p.token, null), { code: 'conflict' });
  const fresh = service.previewImport('one', fixture(), 'replace', service.read().revision); service.commitImport('one', fresh.token, fresh.revision); assert.throws(() => service.commitImport('one', fresh.token, fresh.revision), { code: 'expired' });
  let now = 0; const expiring = new SongLibraryService(service.store, () => now), old = expiring.previewImport('one', fixture(), 'append', service.read().revision); now = 300001; assert.throws(() => expiring.commitImport('one', old.token, old.revision), { code: 'expired' });
  service.previewImport('owner', fixture(), 'append', service.read().revision); service.cancelOwner('owner');
});

test('HTTP requires identity, same origin and business header; directly reads new backup with CAS preview/commit', async t => {
  const { open } = await setup(t), service = open(), app = createSongLibraryRouter(service, c => c.req.header('Cookie') === 'session=valid' ? 'browser' : '');
  const headers = { Cookie: 'session=valid', 'X-Music-App': '1', 'Content-Type': 'application/json', 'X-SlowTune-Revision': 'null' };
  assert.equal((await app.request('/')).status, 401);
  assert.equal((await app.request('/edits', { method: 'POST', headers: { Cookie: 'session=valid' }, body: '{}' })).status, 403);
  assert.equal((await app.request('/edits', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.invalid' }, body: '{}' })).status, 403);
  const preview = await (await app.request('/imports/preview?mode=replace', { method: 'POST', headers, body: encode(fixture()) })).json();
  const response = await app.request('/imports/commit', { method: 'POST', headers, body: JSON.stringify({ token: preview.token, revision: null }) }); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).snapshot, fixture()); assert.deepEqual(decode(await (await app.request('/export', { headers })).text()), fixture());
  assert.equal((await app.request('/edits', { method: 'POST', headers, body: JSON.stringify({ revision: null, edits: [{ type: 'favorite', songId: 's1' }] }) })).status, 409);
  assert.equal((await app.request('/imports/preview?mode=replace', { method: 'POST', headers: { ...headers, 'Content-Length': String(maxBytes + 1) }, body: '{}' })).status, 400);
  assert.equal((await app.request('/unknown', { headers })).status, 404);
});

test('HTTP streaming byte boundary, malformed UTF-8, overflow and stalled cancellation', async () => {
  assert.equal(await readSongBody(new Request('http://localhost', { method: 'POST', body: '1234567890' }), 10), '1234567890');
  await assert.rejects(readSongBody(new Request('http://localhost', { method: 'POST', body: '12345678901' }), 10), { code: 'invalid-input' });
  await assert.rejects(readSongBody(new Request('http://localhost', { method: 'POST', body: new Uint8Array([0xff]) }), 10), { code: 'invalid-input' });
  const controller = new AbortController(), body = new ReadableStream({ start() {} });
  const work = readSongBody(new Request('http://localhost', { method: 'POST', body, signal: controller.signal, duplex: 'half' })); controller.abort(); await assert.rejects(work, { code: 'cancelled' });
});

test('two real processes compete at the same revision and exactly one commits', async t => {
  const { open, path } = await setup(t), service = open(); restore(service); const expected = service.read().revision;
  const code = `import {SongLibraryStore} from ${JSON.stringify(moduleUrl)}; const s=new SongLibraryStore(process.argv[1],'alice'); process.send('ready'); process.on('message',()=>{try{s.transaction(process.argv[2],c=>{c.document.snapshot.songs[0].title=process.argv[3]});process.send('committed')}catch(e){process.send(e.code)}finally{s.close();process.disconnect()}});`;
  const children = ['left', 'right'].map(name => spawn(process.execPath, ['--input-type=module', '-e', code, path, expected, name], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  const exits = children.map(child => new Promise(resolve => child.once('exit', resolve)));
  const onceMessage = child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('child exit ' + code)); }); });
  await Promise.all(children.map(onceMessage)); const results = children.map(onceMessage); children.forEach(child => child.send('go'));
  assert.deepEqual((await Promise.all(results)).sort(), ['committed', 'conflict']); await Promise.all(exits);
  assert(['left', 'right'].includes(service.read().snapshot.songs[0].title));
});

test('process termination inside an uncommitted SQLite transaction leaves the committed model and events intact', async t => {
  const { open, path } = await setup(t), service = open(); restore(service); const before = service.read(), events = service.store.events();
  const code = `import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');d.prepare('UPDATE song_library SET document=? WHERE scope=?').run('{}','alice');d.prepare('DELETE FROM song_library_events WHERE scope=?').run('alice');process.exit(9);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, path], { stdio: 'ignore' }); assert.equal(await new Promise(resolve => child.on('exit', resolve)), 9);
  assert.deepEqual(service.read(), before); assert.deepEqual(service.store.events(), events);
});

test('initialization rejects foreign/old structures; explicit rebuild operates only in isolated local paths', async t => {
  const { directory } = await setup(t), oldPath = join(directory, 'old.sqlite'), db = new DatabaseSync(oldPath); db.exec('CREATE TABLE old_data(value TEXT)'); db.close();
  assert.throws(() => new SongLibraryStore(oldPath, 'alice'), { code: 'invalid-input' });
  await assert.rejects(initializeSongLibrary({ database: '../outside.sqlite', userSpace: 'test', build: root }));
  const project = fileURLToPath(new URL('..', import.meta.url)), relative = 'local/song-library-stage1/init-test-' + process.pid + '.sqlite';
  t.after(async () => { for (const suffix of ['', '-wal', '-shm']) await rm(join(project, relative) + suffix, { force: true }); });
  assert.equal((await initializeSongLibrary({ database: relative, userSpace: 'test', build: root, reset: true })).modelVersion, 1);
  const development = new DatabaseSync(join(project, relative)); development.exec('CREATE TABLE discarded_development_table(value TEXT)'); development.close();
  await initializeSongLibrary({ database: relative, userSpace: 'test', build: root, reset: true });
  const rebuilt = new DatabaseSync(join(project, relative), { readOnly: true }); assert.deepEqual(rebuilt.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name), ['song_library', 'song_library_events']); rebuilt.close();
});

test('catalog identity and playback precedence retain exact source semantics without historical query/queue branches', () => {
  const base = { source: 'netease', title: ' Ａ Song (Live) ', artists: ['Singer B', ' Singer A ', 'Singer A'] };
  assert.equal(catalogSongKey(base), catalogSongKey({ ...base, title: 'a song (live)', artists: ['singer a', 'singer b'], rank: 5, periodId: 9 }));
  assert.notEqual(catalogSongKey(base), catalogSongKey({ ...base, title: 'A Song Live' })); assert.notEqual(catalogSongKey(base), catalogSongKey({ ...base, source: 'qq' }));
  const data = fixture(), alternate = { ...version('alt', 's1', '30'), availability: { state: 'unavailable', checkedAt: 1, code: 'not-found' } };
  const resolve = input => chooseSongVersion({ kind: 'song', songId: 's1', ...input }, data.songs, [...data.versions, alternate]);
  assert.equal(resolve({ explicitVersionId: 'alt', pinnedVersionId: 'v1' }).versionId, 'alt'); assert.equal(resolve({ pinnedVersionId: 'alt' }).versionId, 'alt'); assert.equal(resolve({}).versionId, 'v1');
  data.songs[0].defaultVersionId = null; assert.equal(resolve({}).kind, 'search'); assert.deepEqual(chooseSongVersion({ kind: 'source', ref: alternate.ref }, data.songs, data.versions).ref, alternate.ref);
});
