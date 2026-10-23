import { Hono, type Context } from 'hono';
import { SongLibraryService } from './song-library-service.js';
import { SongLibraryError } from './song-library-errors.js';
import { object } from './song-library-codec.js';
import { maxSongLibrarySnapshotBytes } from './song-library-types.js';
import { MusicSourceError } from '@studio/music-sources';
import type { SongLibrarySources } from './song-library-sources.js';
import { MusicSearchError } from './music-search.js';
import type { SongLibraryMaintenance } from './song-library-maintenance.js';
import type { SongLibrarySync } from './song-library-sync.js';
import { SongCatalogError, type SongCatalogService } from './song-catalog.js';
import { PlaylistCoverImages } from './playlist-cover-images.js';

/** Limit raw UTF-8 bytes before parsing; abort cancels a stalled body reader too. */
export async function readSongBody(request: Request, max = maxSongLibrarySnapshotBytes): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new SongLibraryError('invalid-input');
  const reader = request.body?.getReader(); if (!reader) throw new SongLibraryError('invalid-input');
  const parts: Uint8Array[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw new SongLibraryError('cancelled');
      const { done, value } = await reader.read();
      if (request.signal.aborted) throw new SongLibraryError('cancelled');
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new SongLibraryError('invalid-input'); }
      parts.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } catch (error) {
    if (request.signal.aborted) throw new SongLibraryError('cancelled');
    if (error instanceof SongLibraryError) throw error;
    throw new SongLibraryError('invalid-input');
  } finally { request.signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
async function json(request: Request) { try { return JSON.parse(await readSongBody(request, 2 * 1024 * 1024)); } catch (error) { if (error instanceof SongLibraryError) throw error; throw new SongLibraryError('invalid-input'); } }
function revision(value: unknown): string | null {
  if (value === null || typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  throw new SongLibraryError('invalid-input');
}
/** Mount behind the host's session lifetime middleware. Identity is mandatory and never read from JSON. */
export function createSongLibraryRouter(service: SongLibraryService, identity: (context: Context) => string, sources?: SongLibrarySources, maintenance?: SongLibraryMaintenance, sync?: SongLibrarySync, catalog?: SongCatalogService) {
  const app = new Hono<{ Variables: { owner: string } }>();
  const covers = new PlaylistCoverImages(service);
  app.use('*', async (c, next) => {
    const owner = identity(c); if (!owner) throw new SongLibraryError('authentication'); c.set('owner', owner);
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin || !['GET', 'HEAD'].includes(c.req.method) && c.req.header('X-Music-App') !== '1') throw new SongLibraryError('origin-denied');
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); await service.store.onSurface(c.req.header('X-SlowTune-Surface')==='desktop',next);
  });
  app.get('/', async c => {
    const response = service.store.desktopResponse({ type: 'read' }, c.req.raw.signal);
    return response ? c.body(await response, 200, { 'Content-Type': 'application/json; charset=UTF-8' }) : c.json(service.read());
  });
  app.get('/export', c => c.body(service.export(), 200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="slowtune-library.json"' }));
  app.get('/events', c => c.json({ revision: service.revision() }));
  app.post('/covers/source', async c => {
    if (c.req.header('X-SlowTune-Surface') !== 'desktop') throw new SongLibraryError('unsupported');
    return c.json(await covers.source(await json(c.req.raw), c.req.raw.signal));
  });
  app.post('/catalog/search', async c => {
    if (!catalog) throw new SongLibraryError('not-found');
    return c.json({ candidates: await catalog.search(await json(c.req.raw), c.req.raw.signal) });
  });
  app.post('/catalog/select', async c => {
    if (!catalog) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'selection']);
    return c.json(await catalog.select(revision(input.revision), input.selection, c.req.raw.signal));
  });
  app.post('/catalog/backfill', async c => {
    if (!catalog) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['surface']);
    if (input.surface !== 'desktop') throw new SongLibraryError('invalid-input');
    const result = await catalog.backfill(c.req.raw.signal);
    return c.json({ revision: result.revision, more: result.more, ...('retryAfterMs' in result ? { retryAfterMs: result.retryAfterMs } : {}) });
  });
  app.post('/sources', async c => {
    if (!sources) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'save']);
    return c.json(await sources.save(revision(input.revision), input.save, c.req.raw.signal));
  });
  app.post('/chart-favorites', async c => {
    if (!sources) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'context']);
    return c.json(sources.favoriteChart(revision(input.revision), input.context, c.req.raw.signal));
  });
  app.post('/playback', async c => {
    if (!sources) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['selection', 'searchMode', 'audioSupport']);
    return c.json(await sources.playback(input.selection, c.req.raw.signal, input.searchMode, input.audioSupport));
  });
  app.post('/edits', async c => {
    const input = await json(c.req.raw); object(input, ['revision', 'edits']);
    if (Array.isArray(input.edits) && input.edits.some(e => e?.type === 'set-playlist-cover') && c.req.header('X-SlowTune-Surface') !== 'desktop') throw new SongLibraryError('unsupported');
    const expected = revision(input.revision);
    const response = service.store.desktopResponse({ type: 'edit', revision: expected, edits: input.edits }, c.req.raw.signal);
    return response ? c.body(await response, 200, { 'Content-Type': 'application/json; charset=UTF-8' }) : c.json(service.execute(expected, input.edits, c.req.raw.signal));
  });
  app.post('/organization/preview', async c => {
    const input = await json(c.req.raw); object(input, ['revision', 'songId']);
    return c.json(service.previewOrganization(c.get('owner'), input.songId, revision(input.revision), c.req.raw.signal));
  });
  app.post('/organization/adopt', async c => {
    const input = await json(c.req.raw); object(input, ['revision', 'token', 'candidateId', 'fields']);
    return c.json(service.adoptOrganization(c.get('owner'), input.token, input.candidateId, input.fields, revision(input.revision), c.req.raw.signal));
  });
  app.post('/maintenance/check', async c => {
    if (!maintenance) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'versionIds']);
    return c.json(await maintenance.check(revision(input.revision), input.versionIds, c.req.raw.signal));
  });
  app.post('/maintenance/preview', async c => {
    const input = await json(c.req.raw); object(input, ['revision', 'action']);
    return c.json(service.previewMaintenance(c.get('owner'), input.action, revision(input.revision), c.req.raw.signal));
  });
  app.post('/maintenance/commit', async c => {
    const input = await json(c.req.raw); object(input, ['revision', 'token']);
    return c.json(service.commitMaintenance(c.get('owner'), input.token, revision(input.revision), c.req.raw.signal));
  });
  app.get('/sync', async c => {
    if (!sync) throw new SongLibraryError('not-found');
    const folders = c.req.query('folders'); if (folders !== undefined && !['0', '1'].includes(folders)) throw new SongLibraryError('invalid-input');
    return c.json(await sync.state(c.req.raw.signal, folders === '1'));
  });
  app.post('/sync/preview', async c => {
    if (!sync) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'link']);
    return c.json(await sync.preview(c.get('owner'), revision(input.revision), input.link, c.req.raw.signal));
  });
  app.post('/sync/commit', async c => {
    if (!sync) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'token']);
    return c.json(await sync.commit(c.get('owner'), input.token, revision(input.revision), c.req.raw.signal));
  });
  app.post('/sync/control', async c => {
    if (!sync) throw new SongLibraryError('not-found');
    const input = await json(c.req.raw); object(input, ['revision', 'control']);
    return c.json(await sync.control(revision(input.revision), input.control, c.req.raw.signal));
  });
  app.post('/imports/preview', async c => {
    const mode = c.req.query('mode'); if (!['append', 'replace'].includes(mode ?? '')) throw new SongLibraryError('invalid-input');
    const expected = c.req.header('X-SlowTune-Revision');
    return c.json(service.previewImport(c.get('owner'), await readSongBody(c.req.raw), mode as 'append' | 'replace', revision(expected === 'null' ? null : expected), c.req.raw.signal));
  });
  app.post('/imports/commit', async c => {
    const input = await json(c.req.raw); object(input, ['token', 'revision']);
    return c.json(service.commitImport(c.get('owner'), input.token, revision(input.revision), c.req.raw.signal));
  });
  app.onError((error, c) => {
    const code = c.req.raw.signal.aborted&&c.req.raw.signal.reason?.name==='TimeoutError'?'timeout':error instanceof SongLibraryError || error instanceof MusicSourceError || error instanceof MusicSearchError || error instanceof SongCatalogError ? error.code : c.req.raw.signal.aborted ? 'cancelled' : 'storage';
    return c.json({ error: { code, ...(error instanceof SongLibraryError ? { currentRevision: error.currentRevision } : {}), ...(error instanceof MusicSourceError ? { provider: error.provider, upstreamCode: error.upstreamCode } : {}) } }, code === 'conflict' ? 409 : code === 'authentication' ? 401 : code === 'origin-denied' ? 403 : code === 'expired' ? 410 : code === 'cancelled' ? 408 : code === 'busy' || code === 'rate-limited' ? 429 : code === 'storage' || code === 'network' || code === 'upstream' || code === 'timeout' && c.req.header('X-SlowTune-Surface') === 'desktop' ? 503 : 400);
  });
  app.all('*', c => c.json({ error: { code: 'not-found' } }, 404));
  return app;
}
