import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSongModule } from './helpers/song-services.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const { SongLibraryStore } = await loadSongModule('song-library-store');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
async function setup(t) {
  const parent = join(developmentPaths().testRuntime, 'library-worker-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'isolated-'));
  const store = new SongLibraryStore(join(directory, 'library.sqlite'), 'fixture');
  const service = new SongLibraryService(store);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await store.close(); } };
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = (operation, signal) => store.onSurface(true, () => store.desktopResponse(operation, signal));
  return { store, service, request, close };
}

test('desktop worker shares the real database, validates edits, and preserves CAS and event atomicity', async t => {
  const { store, service, request } = await setup(t);
  assert.equal(store.desktopResponse({ type: 'read' }), undefined, 'default/mobile surface remains synchronous');
  const first = decode(await request({ type: 'edit', revision: null, edits: [{ type: 'create-song', id: 's', title: 'Original' }, { type: 'favorite', songId: 's' }] }));
  assert.equal(service.read().revision, first.revision);
  assert.equal(store.events().filter(event => event.type === 'library-changed').length, 1);
  const results = await Promise.allSettled(['One', 'Two'].map(title => request({ type: 'edit', revision: first.revision, edits: [{ type: 'edit-song', songId: 's', title }] })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'conflict');
  const current = service.read();
  await assert.rejects(request({ type: 'edit', revision: current.revision, edits: [{ type: 'edit-song', songId: 's', title: 'Changed' }, { type: 'favorite', songId: 'missing' }] }), { code: 'not-found' });
  assert.deepEqual(service.read(), current, 'a failed multi-edit rolls back entirely');
  const next = service.execute(current.revision, [{ type: 'edit-song', songId: 's', title: 'Main writer' }]);
  assert.deepEqual(decode(await request({ type: 'read' })), next, 'worker invalidates its cache after an external writer');
});

test('desktop HTTP uses the worker without changing response, origin, revision or mobile contracts', async t => {
  const { store, service } = await setup(t);
  const router = createSongLibraryRouter(service, () => 'owner');
  const post = (revision, edits, surface = 'desktop') => router.request('/edits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1', 'X-SlowTune-Surface': surface }, body: JSON.stringify({ revision, edits }) });
  const created = await post(null, [{ type: 'create-song', id: 's', title: 'From desktop' }]);
  assert.equal(created.status, 200);
  const state = await created.json();
  assert.deepEqual(await (await router.request('/', { headers: { 'X-SlowTune-Surface': 'desktop' } })).json(), state);
  const mobile = await post(state.revision, [{ type: 'edit-song', songId: 's', title: 'Mobile' }], 'mobile');
  assert.equal(mobile.status, 200);
  const stale = await post(state.revision, [{ type: 'edit-song', songId: 's', title: 'Stale' }]);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.currentRevision, store.revision());
  assert.equal((await router.request('/', { headers: { Origin: 'https://foreign.invalid', 'X-SlowTune-Surface': 'desktop' } })).status, 403);
});

test('large desktop edits leave the host responsive; cancellation drains without committing and admission stays bounded', { timeout: 30000 }, async t => {
  const { store, service, request, close } = await setup(t);
  service.transaction(null, ({ document }) => {
    for (let i = 0; i < 10000; i++) document.snapshot.songs.push({ id: 's-' + i, title: 'Synthetic ' + i, artists: ['Artist'], contentKind: 'single', fields: { title: { source: 'manual', protected: true }, artists: { source: 'manual', protected: true } }, originals: [], aliases: [], defaultVersionId: null, organization: 'organized', createdAt: 1, updatedAt: 1 });
  });
  await request({ type: 'read' });
  const revision = store.revision(), stop = new AbortController();
  const cancelled = request({ type: 'edit', revision, edits: [{ type: 'edit-song', songId: 's-0', title: 'Cancelled' }] }, stop.signal);
  const rejected = assert.rejects(cancelled, { code: 'cancelled' });
  setTimeout(() => stop.abort(), 1); await rejected;
  assert.equal(decode(await request({ type: 'read' })).snapshot.songs[0].title, 'Synthetic 0');
  assert.equal(store.revision(), revision);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    await request({ type: 'edit', revision, edits: [{ type: 'edit-song', songId: 's-0', title: 'Saved' }] });
  } finally { clearInterval(timer); }
  assert(ticks > 2, 'host timers advance during the full validated write');
  const queued = Array.from({ length: 17 }, () => request({ type: 'read' }));
  const results = await Promise.allSettled(queued);
  assert.equal(results[16].status, 'rejected');
  assert.equal(results[16].reason.code, 'busy');
  const last = service.read();
  const closing = request({ type: 'edit', revision: last.revision, edits: [{ type: 'edit-song', songId: 's-0', title: 'Not saved on exit' }] });
  const closed = assert.rejects(closing, { code: 'cancelled' });
  await close(); await closed;
  const reopened = new SongLibraryStore(store.path, store.userSpace);
  try { assert.deepEqual(new SongLibraryService(reopened).read(), last); } finally { await reopened.close(); }
});
