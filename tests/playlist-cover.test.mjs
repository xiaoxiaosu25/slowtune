import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSongModule } from './helpers/song-services.mjs';
import { coverImage } from './helpers/playlist-cover-image.mjs';

const { SongLibraryStore } = await loadSongModule('song-library-store');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { PlaylistCoverImages } = await loadSongModule('playlist-cover-images');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');
const { decodeSongLibrarySnapshot } = await loadSongModule('song-library-codec');
const { validatePlaylistCover, maxPlaylistCoverLength } = await loadSongModule('playlist-cover');
const signal = () => new AbortController().signal;
function setup(t) {
  const store = new SongLibraryStore(':memory:', 'cover-test'), library = new SongLibraryService(store);
  t.after(() => store.close());
  library.execute(null, [{ type: 'create-song', id: 'a', title: '甲', artwork: 'https://p1.music.126.net/cover.jpg' }, { type: 'create-song', id: 'b', title: '乙' }, { type: 'favorite', songId: 'a' }, { type: 'favorite', songId: 'b' }, { type: 'create-playlist', id: 'p', name: '歌单' }, { type: 'add-entry', playlistId: 'p', songId: 'a' }]);
  return library;
}
const set = (library, targetId, image) => library.execute(library.revision(), [{ type: 'set-playlist-cover', targetId, image }]);

test('independent covers survive member removal, reordering, refresh and portable restore; reset is scoped', t => {
  const library = setup(t), songs = structuredClone(library.read().snapshot.songs);
  set(library, 'system:favorites', coverImage); const old = library.revision(); set(library, 'p', coverImage);
  assert.throws(() => library.execute(old, [{ type: 'set-playlist-cover', targetId: 'p', image: null }]), { code: 'conflict' });
  const current = library.read();
  library.execute(current.revision, [{ type: 'reorder-favorites', favoriteIds: current.snapshot.favorites.map(f => f.favoriteId).reverse() }, { type: 'remove-entry', playlistId: 'p', entryId: current.snapshot.playlists[0].entries[0].entryId }, { type: 'remove-favorite', favoriteId: current.snapshot.favorites[0].favoriteId }]);
  assert.equal(library.read().snapshot.desktopFavoritesCover, coverImage);
  assert.equal(library.read().snapshot.playlists[0].desktopCover, coverImage);
  assert.deepEqual(library.read().snapshot.songs, songs);
  const exported = library.export(), preview = library.previewImport('browser', exported, 'replace', library.revision());
  library.commitImport('browser', preview.token, preview.revision);
  assert.deepEqual(library.read().snapshot, JSON.parse(exported));
  set(library, 'p', null); assert.equal(library.read().snapshot.playlists[0].desktopCover, undefined);
  assert.equal(library.read().snapshot.desktopFavoritesCover, coverImage);
  set(library, 'system:favorites', null); assert.equal(library.read().snapshot.desktopFavoritesCover, undefined);
  assert.throws(() => set(library, 'missing', coverImage), { code: 'not-found' });
});

test('backup append retains images and reports conflicting covers instead of silently replacing them', t => {
  const library = setup(t), before = library.read().snapshot;
  const incoming = structuredClone(before); incoming.desktopFavoritesCover = coverImage; incoming.playlists[0].desktopCover = coverImage;
  let preview = library.previewImport('browser', incoming, 'append', library.revision()); assert.deepEqual(preview.impact.conflicts, []);
  library.commitImport('browser', preview.token, preview.revision);
  assert.equal(library.read().snapshot.playlists[0].desktopCover, coverImage);
  // A changed JPEG metadata segment is a different valid portable image.
  const bytes = Buffer.from(coverImage.split(',')[1], 'base64'); bytes[13] ^= 1;
  const other = 'data:image/jpeg;base64,' + bytes.toString('base64'); validatePlaylistCover(other);
  incoming.desktopFavoritesCover = other; incoming.playlists[0].desktopCover = other;
  preview = library.previewImport('browser', incoming, 'append', library.revision());
  assert(preview.impact.conflicts.some(c => c.kind === 'favorites-cover'));
  assert(preview.impact.conflicts.some(c => c.kind === 'playlist-cover'));
  assert.throws(() => library.commitImport('browser', preview.token, preview.revision), { code: 'duplicate' });
  assert.equal(library.read().snapshot.desktopFavoritesCover, coverImage);
});

test('strict image shape, size, target and transaction validation rejects invalid writes and imports', t => {
  const library = setup(t), before = library.read(); validatePlaylistCover(coverImage);
  for (const image of ['', 'https://p1.music.126.net/x.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,aGVsbG8=', coverImage.slice(0, -4), 'data:image/jpeg;base64,' + 'a'.repeat(maxPlaylistCoverLength), 1, {}]) {
    assert.throws(() => set(library, 'p', image), { code: 'invalid-input' });
    assert.throws(() => decodeSongLibrarySnapshot({ ...before.snapshot, desktopFavoritesCover: image }), { code: 'invalid-input' });
    assert.deepEqual(library.read(), before);
  }
  const bytes = Buffer.from(coverImage.split(',')[1], 'base64'), marker = bytes.indexOf(Buffer.from([255, 192]));
  assert(marker > 0); bytes[marker + 6] = 1;
  assert.throws(() => validatePlaylistCover('data:image/jpeg;base64,' + bytes.toString('base64')), { code: 'invalid-input' });
  assert.throws(() => library.execute(before.revision, [{ type: 'set-playlist-cover', targetId: 'p' }]), { code: 'invalid-input' });
  assert.throws(() => library.execute(before.revision, [{ type: 'set-playlist-cover', targetId: 'p', image: 'invalid' }, { type: 'set-playlist-cover', targetId: 'p', image: null }]), { code: 'invalid-input' });
});

test('cover HTTP writes require the desktop surface and keep the usual origin/revision protections', async t => {
  const library = setup(t), app = createSongLibraryRouter(library, () => 'browser');
  const body = JSON.stringify({ revision: library.revision(), edits: [{ type: 'set-playlist-cover', targetId: 'p', image: coverImage }] });
  assert.equal((await app.request('/edits', { method: 'POST', headers: { 'X-Music-App': '1' }, body })).status, 400);
  assert.equal((await app.request('/edits', { method: 'POST', headers: { 'X-Music-App': '1', 'X-SlowTune-Surface': 'desktop', Origin: 'https://untrusted.invalid' }, body })).status, 403);
  assert.equal((await app.request('/edits', { method: 'POST', headers: { 'X-Music-App': '1', 'X-SlowTune-Surface': 'desktop' }, body })).status, 200);
  assert.equal((await app.request('/covers/source', { method: 'POST', headers: { 'X-Music-App': '1' }, body: '{}' })).status, 400);
});

test('source image reader uses current desktop artwork and bounded credential-free requests', async t => {
  const library = setup(t), requests = [], bytes = Buffer.from(coverImage.split(',')[1], 'base64');
  const images = new PlaylistCoverImages(library, async (url, options) => { requests.push({ url: String(url), options }); return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }); });
  const result = await images.source({ targetId: 'p', songId: 'a' }, signal()); assert.equal(result.image, coverImage);
  assert.equal(requests[0].options.redirect, 'error'); assert.equal(requests[0].options.headers.Cookie, undefined);
  assert.equal(requests[0].url, 'https://p1.music.126.net/cover.jpg');
  for (const input of [{ targetId: 'p', songId: 'b' }, { targetId: 'missing', songId: 'a' }, { targetId: 'p', songId: 'a', url: 'https://localhost/' }]) await assert.rejects(images.source(input, signal()));
  assert.equal(requests.length, 1);
  library.execute(library.revision(), [{ type: 'edit-song', songId: 'a', artwork: 'https://music.126.net.evil.invalid/image.jpg' }]);
  await assert.rejects(images.source({ targetId: 'p', songId: 'a' }, signal()), { code: 'unsupported' }); assert.equal(requests.length, 1);
  library.execute(library.revision(), [{ type: 'edit-song', songId: 'a', artwork: 'https://p1.music.126.net/image.jpg' }]);
  for (const response of [() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), () => new Response('not jpeg', { headers: { 'content-type': 'image/jpeg' } }), () => new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) } })]) {
    await assert.rejects(new PlaylistCoverImages(library, async () => response()).source({ targetId: 'p', songId: 'a' }, signal()), { code: 'invalid-input' });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(images.source({ targetId: 'p', songId: 'a' }, controller.signal), { code: 'cancelled' });
});

test('source streams enforce the actual byte limit and cancellation frees a stalled read', async t => {
  const library = setup(t); let cancelled = false;
  const large = new PlaylistCoverImages(library, async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } }));
  await assert.rejects(large.source({ targetId: 'p', songId: 'a' }, signal()), { code: 'invalid-input' }); assert(cancelled);
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const stalled = new PlaylistCoverImages(library, async () => new Response(new ReadableStream({ start() { entered(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } }));
  cancelled = false; const controller = new AbortController(), pending = stalled.source({ targetId: 'p', songId: 'a' }, controller.signal);
  await started; controller.abort(); await assert.rejects(pending, { code: 'cancelled' }); assert(cancelled);
});

test('source image format follows the body when CDN content types are aliases, wrong or absent', async t => {
  const library = setup(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from(coverImage.split(',')[1], 'base64');
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  for (const [bytes, mime] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']]) {
    for (const contentType of ['image/jpg', 'image/jpeg', 'application/octet-stream', undefined]) {
      const images = new PlaylistCoverImages(library, async () => new Response(bytes, { headers: contentType ? { 'content-type': contentType } : {} }));
      const result = await images.source({ targetId: 'p', songId: 'a' }, signal());
      assert.equal(result.image, 'data:' + mime + ';base64,' + bytes.toString('base64'));
    }
  }
  for (const body of ['<svg/>', '<html>upstream error</html>', 'RIFF']) {
    const images = new PlaylistCoverImages(library, async () => new Response(body, { headers: { 'content-type': 'image/jpg' } }));
    await assert.rejects(images.source({ targetId: 'p', songId: 'a' }, signal()), { code: 'invalid-input' });
  }
});
