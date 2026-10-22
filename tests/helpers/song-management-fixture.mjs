import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { startupFixture } from './startup-fixture.mjs';
import { loadSongModule, ref, entry } from './song-services.mjs';

export async function startSongManagementFixture({ clientRoot, catalogProvider } = {}) {
  const { SongLibraryStore } = await loadSongModule('song-library-store'), { SongLibraryService } = await loadSongModule('song-library-service');
  const { SongLibrarySources } = await loadSongModule('song-library-sources'), { SongLibraryMaintenance } = await loadSongModule('song-library-maintenance');
  const { createSongLibraryRouter } = await loadSongModule('song-library-http');
  const store = new SongLibraryStore(':memory:', 'desktop-song-fixture'), library = new SongLibraryService(store);
  const { SongCatalogService } = await loadSongModule('song-catalog');
  const catalog = catalogProvider ? new SongCatalogService(library, catalogProvider) : undefined;
  const track = (reference, title) => ({ ...entry(reference), title, durationSeconds: 240, uploader: { name: '音乐现场' } });
  const access = { metadata: async reference => {
    if (reference.id === ref(4).id) throw Object.assign(new Error('missing'), { code: 'not-found' });
    if (reference.id === ref(5).id) throw Object.assign(new Error('network'), { code: 'network' });
    return track(reference, reference.id === ref(6).id ? '晴天 · 2026音乐会' : '来源 ' + reference.id);
  }, resolve: async () => track(ref(6), '晴天 · 2026音乐会'), enabled: () => true, generation: () => 'one' };
  const sources = new SongLibrarySources(library, access), maintenance = new SongLibraryMaintenance(library, access);
  const edits = [
    { type: 'create-song', id: 'sun', title: '晴天', artists: ['周杰伦'] },
    { type: 'create-song', id: 'duplicate', title: '晴天（重复保存）', artists: ['周杰伦'] },
    { type: 'create-song', id: 'orphan', title: '稻香', artists: ['周杰伦'] },
    { type: 'create-song', id: 'missing', title: '已失效现场', artists: ['测试歌手'] },
    { type: 'create-song', id: 'uncertain', title: '暂待确认', artists: ['测试歌手'] },
  ];
  const version = (id, songId, reference, label, kind = 'live', availability = { state: 'unknown' }) => ({ type: 'add-version', version: { id, songId, ref: reference, label, kind, performers: ['周杰伦'], facts: { title: label + ' · 来源原始标题', uploader: '音乐现场', durationSeconds: 240, url: entry(reference).url }, availability } });
  edits.push(version('studio', 'sun', ref(1), '原唱 · 录音室', 'studio', { state: 'available', checkedAt: Date.now() - 3600000 }), version('live', 'sun', ref(2), '演唱会现场', 'live'),
    version('cover', 'sun', { provider: 'youtube', kind: 'video', id: 'fixtureSong' }, '吉他翻唱', 'cover'),
    version('duplicate-version', 'duplicate', ref(3), '重复保存的现场'), version('missing-version', 'missing', ref(4), '已失效的来源', 'live', { state: 'unavailable', code: 'not-found', checkedAt: Date.now() - 3600000 }),
    version('uncertain-version', 'uncertain', ref(5), '网络暂时无法确认', 'live', { state: 'uncertain', code: 'network', checkedAt: Date.now() - 3600000 }),
    { type: 'favorite', songId: 'sun' }, { type: 'favorite', songId: 'duplicate' }, { type: 'favorite', songId: 'missing' }, { type: 'favorite', songId: 'uncertain' },
    { type: 'create-playlist', id: 'repeat', name: '周杰伦精选' }, { type: 'add-entry', playlistId: 'repeat', entryId: 'first', songId: 'sun' }, { type: 'add-entry', playlistId: 'repeat', entryId: 'second', songId: 'sun', pinnedVersionId: 'live' });
  for (let i = 0; i < 32; i++) edits.push({ type: 'create-song', id: 'extra-' + i, title: '收藏的旋律 ' + String(i + 1).padStart(2, '0'), artists: ['独立音乐人'] }, { type: 'favorite', songId: 'extra-' + i });
  library.execute(null, edits);
  const app = new Hono(), root = resolve(clientRoot ?? process.env.MUSIC_APP_TEST_BUILD ?? '.');
  app.route('/api/song-library', createSongLibraryRouter(library, () => 'browser', sources, maintenance, undefined, catalog));
  app.get('/api/bootstrap', c => c.json(startupFixture('/api/bootstrap')));
  app.get('/api/status', c => c.json({ version: 'fixture', providers: { bilibili: { available: true }, youtube: { available: false } }, delivery: { leases: 0 }, tool: { active: 0 }, build: { stale: false } }));
  app.get('/api/bilibili/account', c => c.json({ state: 'anonymous' })); app.get('/api/follows', c => c.json({ revision: 'f', creators: [] }));
  app.get('/api/follows/feed', c => c.json({ items: [] })); app.get('/api/discovery/bilibili', c => c.json([]));
  app.get('/api/charts', c => c.json({ source: 'netease', chart: 'hot', title: '热歌榜', fetchedAt: Date.now(), items: [{ rank: 1, title: '晴天', artists: ['周杰伦'] }] }));
  app.post('/api/search', c => c.json({ items: [track(ref(6), '晴天 · 2026音乐会')] }));
  app.get('/v1/handshake', c => c.json({ protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata', 'prepare', 'search'], anonymous: true, limitations: [] }] }));
  app.post('/v1/call/metadata', async c => c.json({ protocol: 2, result: await access.metadata((await c.req.json()).ref) }));
  const audio = Buffer.alloc(44 + 8000 * 60 * 2); audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  app.post('/v1/call/prepare', async c => { const r = (await c.req.json()).request.ref; return c.json({ protocol: 2, result: { entry: track(r, '晴天'), resourceId: r.id, format: { id: 'wav', codec: 'pcm', mimeType: 'audio/wav', container: 'wav' }, delivery: { url: new URL('/fixture.wav?id=' + r.id, c.req.url).href, requiresHost: false } } }); });
  app.get('/fixture.wav', c => c.body(audio, 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' }));
  app.all('/api/*', c => c.json({ error: { code: 'not-found' } }, 404)); app.use('/*', serveStatic({ root: join(root, 'dist/client') }));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await new Promise(r => server.once('listening', r));
  return { library, origin: 'http://127.0.0.1:' + server.address().port, close: async () => { catalog?.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startSongManagementFixture(); console.log(fixture.origin);
  process.on('SIGINT', async () => { await fixture.close(); process.exit(); });
}
