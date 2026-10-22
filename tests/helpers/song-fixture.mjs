import { MusicSourceError } from '@studio/music-sources';
import { loadSongModule } from './song-services.mjs';
const { SongLibraryStore } = await loadSongModule('song-library-store');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { SongLibrarySources } = await loadSongModule('song-library-sources');
const { SongLibraryMaintenance } = await loadSongModule('song-library-maintenance');
const { createSongLibraryRouter } = await loadSongModule('song-library-http');
const { emptySongLibrary } = await loadSongModule('song-library-codec');
// Fixture seeds describe source facts, never a portable backup or a product API.
export const fromMusicRef = ref => ({ ...ref });
export function queueRecord(tracks, options = {}) {
  return { version: 3, items: tracks.map(track => ({ instanceId: track.resourceId, selection: { kind: 'source', ref: track.ref }, title: track.title, ...(track.artists ? { artists: track.artists } : {}) })), current: tracks[0]?.resourceId, order: 'sequential', repeat: 'off', volume: .5, rate: 1, muted: false, ...options };
}
export function seedSongs(seed = {}) {
  if (seed.format === 'slowtune-library') return structuredClone(seed);
  const snapshot = emptySongLibrary(), ids = new Map();
  const adopt = value => {
    const ref = { ...value.ref, ...(value.ref.provider === 'bilibili' && !value.ref.part ? { part: '900' } : {}) }, key = JSON.stringify(ref);
    if (ids.has(key)) return ids.get(key);
    const id = 'song-' + ids.size, versionId = 'version-' + ids.size, metadata = value.metadata ?? value;
    snapshot.songs.push({ id, title: metadata.title || ref.id, ...(metadata.artists ? { artists: metadata.artists } : {}), ...(metadata.artwork ? { artwork: metadata.artwork.replace(/^http:/, 'https:') } : {}), contentKind: 'unknown', fields: { title: { source: 'parsed', protected: false }, artists: { source: 'parsed', protected: false } }, originals: [{ title: metadata.title || ref.id, ref }], aliases: [], defaultVersionId: versionId, organization: 'pending', createdAt: 1, updatedAt: 1 });
    snapshot.versions.push({ id: versionId, songId: id, ref, label: '', kind: 'other', facts: { title: metadata.title || ref.id, ...(metadata.uploader ? { uploader: typeof metadata.uploader === 'string' ? metadata.uploader : metadata.uploader.name } : {}), ...(metadata.durationSeconds !== undefined ? { durationSeconds: metadata.durationSeconds } : {}) }, availability: value.availability ?? { state: 'unknown' } });
    ids.set(key, id); return id;
  };
  for (const value of seed.favorites ?? []) { const songId = adopt(value); if (!snapshot.favorites.some(f => f.songId === songId)) snapshot.favorites.push({ favoriteId: 'favorite-' + snapshot.favorites.length, songId, position: snapshot.favorites.length, addedAt: value.addedAt ?? 1 }); }
  for (const p of seed.playlists ?? []) snapshot.playlists.push({ id: p.id, name: p.name, createdAt: 1, updatedAt: 1, entries: p.entries.map((value, position) => { const songId = adopt(value); return { entryId: value.entryId ?? value.id ?? p.id + '-' + position, songId, position, addedAt: value.addedAt ?? 1, pinnedVersionId: null }; }) });
  return snapshot;
}
export function installSongFixture(server, { seed, beforeWrite, onRead } = {}) {
  const store = new SongLibraryStore(':memory:', 'browser'), library = new SongLibraryService(store);
  const reset = value => { const p = library.previewImport('seed', seedSongs(value), 'replace', library.read().revision); library.commitImport('seed', p.token, p.revision); };
  let seeded = typeof seed !== 'function'; if (seeded) reset(seed);
  const call = async (path, input, signal) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
    const data = await response.json(); if (data.error) throw new MusicSourceError(data.error); return data.result ?? data.entry ?? data;
  };
  const access = { metadata: (ref, signal) => call('/v1/call/metadata', { protocol: 2, ref }, signal), resolve: (query, signal) => call('/api/search/resolve', query, signal), generation: () => 'browser', enabled: () => true };
  const sources = new SongLibrarySources(library, access), maintenance = new SongLibraryMaintenance(library, access), router = createSongLibraryRouter(library, () => 'browser', sources, maintenance);
  const originals = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/song-library')) return originals.forEach(listener => listener.call(server, req, res));
    if (req.method === 'GET' && path === '/api/song-library') onRead?.();
    if (!seeded) { seeded = true; reset(seed()); }
    if (path === '/api/song-library/sync' && req.method === 'GET') { res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({accountId:'123',revision:library.read().revision,links:[],busy:false,...(new URL(req.url,'http://localhost').searchParams.get('folders')==='1'?{folders:[]}:{})})); }
    const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (req.method !== 'GET' && beforeWrite) { const rejection = await beforeWrite(path, chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined); if (rejection) { res.writeHead(rejection.status ?? 409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: rejection.code ?? 'conflict' } })); } }
      const url = new URL(req.url, 'http://127.0.0.1:' + server.address().port); url.pathname = path.slice('/api/song-library'.length) || '/';
      const response = await router.fetch(new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { if (!res.destroyed) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code ?? 'storage', message: error.message } })); } }
  });
  server.once('close', () => store.close());
  return { store, library, sources, reset };
}
