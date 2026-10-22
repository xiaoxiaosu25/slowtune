import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { readSongBody } from './song-library-http.js';
import { SongLibraryError } from './song-library-errors.js';
import { LyricsError, lyricTextBytes, type LyricDocument } from './lyrics-types.js';
import { automaticLyricCandidates, parseLyrics } from './lyrics-format.js';
import { desktopLyricArtistKey, desktopLyricArtistsKey } from './desktop-lyric-match.js';
import { lyricOffset, lyricRevision, lyricSource, type LyricsStore } from './lyrics-store.js';
import type { LyricProviders } from './lyrics-providers.js';

function object(value: unknown, fields: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new LyricsError('invalid-input');
}
export function createLyricsRouter(store: LyricsStore, providers: LyricProviders, identity: (context: Context) => string,operationBudgetMs=20000) {
  const app = new Hono();
  const desktop=(c:Context)=>c.req.header('X-SlowTune-Surface')==='desktop';
  const signals=new WeakMap<Request,AbortSignal>();
  const operationSignal=(c:Context)=>{if(!desktop(c))return c.req.raw.signal;let signal=signals.get(c.req.raw);if(!signal){signal=AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(operationBudgetMs)]);signals.set(c.req.raw,signal);}return signal;};
  app.use('*', async (c, next) => {
    if (!identity(c)) throw new LyricsError('authentication');
    if (c.req.header('Origin') && c.req.header('Origin') !== new URL(c.req.url).origin || c.req.method !== 'GET' && c.req.header('X-Music-App') !== '1') throw new LyricsError('origin-denied');
    operationSignal(c);c.header('Cache-Control', 'no-store'); await next();
  });
  const json = async (request: Request) => {
    const signal=signals.get(request);
    try { return JSON.parse(await readSongBody(signal?new Request(request,{signal}):request, lyricTextBytes * 6 + 4096)); }
    catch (error) {if(signal?.aborted&&signal.reason?.name==='TimeoutError')throw new LyricsError('timeout');if (error instanceof SongLibraryError) throw error; throw new LyricsError('invalid-input'); }
  };
  app.post('/state', async c => {
    const input = await json(c.req.raw); object(input, ['ref']); c.req.raw.signal.throwIfAborted();
    return c.json(store.read(lyricSource(input.ref)));
  });
  app.post('/resolve', async c => {
    const input = await json(c.req.raw); object(input, ['ref', 'title', 'artist', 'durationSeconds']);
    const ref = lyricSource(input.ref), signal = operationSignal(c);
    signal.throwIfAborted();
    const state = store.read(ref);
    if (state.document) return c.json({ state, matched: false, candidates: [], issues: [] });
    const query = { title: input.title, artist: input.artist ?? '', ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}) };
    const result = await providers.search(query, signal,desktop(c));
    const artistKey = desktop(c) ? desktopLyricArtistKey : undefined;
    const matches = automaticLyricCandidates(result.candidates, query, artistKey);
    if(desktop(c)){
      const durations=matches.flatMap(row=>row.durationSeconds===undefined?[]:[row.durationSeconds]);
      const albums=new Set(matches.map(row=>row.album?.normalize('NFKC').toLowerCase().trim()).filter(Boolean));
      if(!query.artist&&result.issues.length||query.durationSeconds===undefined&&(albums.size>1||durations.length>1&&Math.max(...durations)-Math.min(...durations)>12))return c.json({state:store.read(ref),matched:false,...result});
    }
    // A title without a singer is ambiguous when different artists share it.
    const artistKeys = new Set(matches.map(row => desktop(c) ? desktopLyricArtistsKey(row.artists) : row.artists.map(name => name.normalize('NFKC').toLowerCase().replace(/\s+/gu, '')).sort().join('/')));
    if (!query.artist && artistKeys.size > 1) return c.json({ state: store.read(ref), matched: false, ...result });
    for (const candidate of matches.slice(0, 3)) {
      try {
        const document = await providers.document({ provider: candidate.provider, id: candidate.id }, signal,desktop(c));
        if (!automaticLyricCandidates([document], query, artistKey).length) continue;
        // Do not replace a choice/offset saved by another page while the lookup was in flight.
        const selected = store.update(ref, state.revision, current => { current.document = document; current.offsetMs = 0; }, signal);
        return c.json({ state: selected, matched: true, ...result });
      } catch (error) {
        if(desktop(c)&&signal.aborted)throw new LyricsError(signal.reason?.name==='TimeoutError'?'timeout':'cancelled');
        if (error instanceof LyricsError && error.code === 'conflict') return c.json({ state: store.read(ref), matched: false, ...result });
        if (!(error instanceof LyricsError) || !['not-found', 'upstream', 'network', 'timeout', 'rate-limited'].includes(error.code)) throw error;
        result.issues.push({ provider: candidate.provider as 'netease' | 'lrclib', code: error.code });
      }
    }
    return c.json({ state: store.read(ref), matched: false, ...result });
  });
  app.post('/search', async c => c.json(await providers.search(await json(c.req.raw), operationSignal(c),desktop(c))));
  app.post('/search-progress',async c=>{
    if(!desktop(c))throw new LyricsError('invalid-input');
    const input=await json(c.req.raw),stop=new AbortController(),signal=AbortSignal.any([operationSignal(c),stop.signal]);
    const encoder=new TextEncoder();
    return new Response(new ReadableStream({
      start(controller){
        const send=(value:unknown)=>{if(!stop.signal.aborted&&!c.req.raw.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));};
        void providers.search(input,signal,true,value=>send({...value,complete:false})).then(value=>send({...value,complete:true}),error=>send({error:{code:error instanceof LyricsError?error.code:'upstream'}})).finally(()=>{try{controller.close();}catch{}});
      },cancel(){stop.abort();}
    }),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  });
  app.post('/document', async c => c.json(await providers.document(await json(c.req.raw), operationSignal(c),desktop(c))));
  app.post('/select', async c => {
    const input = await json(c.req.raw); object(input, ['ref', 'revision', 'candidate']);
    const ref = lyricSource(input.ref), revision = lyricRevision(input.revision);
    // Resolve only fixed provider IDs; neither URLs nor client-supplied lyric metadata are accepted.
    const signal=operationSignal(c);
    const document = input.candidate === null ? null : await providers.document(input.candidate, signal,desktop(c));
    return c.json(store.update(ref, revision, state => { state.document = document; state.offsetMs = 0; }, signal));
  });
  app.post('/import', async c => {
    const input = await json(c.req.raw); object(input, ['ref', 'revision', 'title', 'text']);
    const ref = lyricSource(input.ref), revision = lyricRevision(input.revision);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || typeof input.text !== 'string') throw new LyricsError('invalid-input');
    const lines = parseLyrics(input.text); if (!lines.some(line => line.text)) throw new LyricsError('invalid-input');
    const document: LyricDocument = { provider: 'local', id: randomUUID(), title: input.title.trim(), artists: [], synced: lines.some(line => line.startMs !== null), lines };
    return c.json(store.update(ref, revision, state => { state.document = document; state.offsetMs = 0; }, c.req.raw.signal));
  });
  app.post('/offset', async c => {
    const input = await json(c.req.raw); object(input, ['ref', 'revision', 'offsetMs']);
    const ref = lyricSource(input.ref), revision = lyricRevision(input.revision), offset = lyricOffset(input.offsetMs);
    return c.json(store.update(ref, revision, state => { if (!state.document?.synced) throw new LyricsError('invalid-input'); state.offsetMs = offset; }, c.req.raw.signal));
  });
  app.onError((error, c) => {
    const code = error instanceof LyricsError || error instanceof SongLibraryError ? error.code : c.req.raw.signal.aborted ? 'cancelled' : 'storage';
    return c.json({ error: { code, ...(error instanceof LyricsError ? { currentRevision: error.currentRevision } : {}) } }, code === 'conflict' ? 409 : code === 'authentication' ? 401 : code === 'origin-denied' ? 403 : code === 'not-found' ? 404 : code === 'cancelled' ? 408 : code === 'busy' || code === 'rate-limited' ? 429 : ['network', 'timeout', 'storage', 'upstream'].includes(code) ? 503 : 400);
  });
  app.all('*', c => c.json({ error: { code: 'not-found' } }, 404));
  return app;
}
