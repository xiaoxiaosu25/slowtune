import { LyricsError, type LyricCandidate, type LyricDocument, type LyricProvider, type LyricSearch } from './lyrics-types.js';
import { parseLyrics } from './lyrics-format.js';
import type { LyricsStore } from './lyrics-store.js';
import { DesktopInflight } from './desktop-inflight.js';

const providers: LyricProvider[] = ['netease', 'lrclib'];
const short = (value: unknown, max = 300): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const names = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 20).map(row => short(row?.name ?? row, 200)).filter(Boolean) : [];
export function lyricCandidate(value: unknown): { provider: LyricProvider; id: string } {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['provider', 'id'].includes(key)) || !providers.includes(row.provider as LyricProvider) || typeof row.id !== 'string' || !/^[1-9]\d{0,15}$/u.test(row.id) || !Number.isSafeInteger(Number(row.id))) throw new LyricsError('invalid-input');
  return { provider: row.provider as LyricProvider, id: row.id };
}
function candidate(provider: LyricProvider, row: any): LyricCandidate | undefined {
  if (!row || !Number.isSafeInteger(row.id) || row.id <= 0) return;
  const title = short(provider === 'netease' ? row.name : row.trackName);
  if (!title) return;
  const duration = provider === 'netease' ? (row.duration ?? row.dt) / 1000 : row.duration;
  return { provider, id: String(row.id), title, artists: provider === 'netease' ? names(row.artists ?? row.ar) : [short(row.artistName, 500)].filter(Boolean),
    ...(short(provider === 'netease' ? (row.album ?? row.al)?.name : row.albumName) ? { album: short(provider === 'netease' ? (row.album ?? row.al)?.name : row.albumName) } : {}),
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && duration <= 86400 ? { durationSeconds: duration } : {}),
    ...(provider === 'lrclib' ? { synced: typeof row.syncedLyrics === 'string' && !!row.syncedLyrics.trim(), instrumental: row.instrumental === true } : {}) };
}

export class LyricProviders {
  private stop = new AbortController();
  private active = 0;
  private searches = new Map<string, { value: LyricSearch; until: number }>();
  private inflight = new DesktopInflight();
  private metadata = new Map<string,{value:LyricCandidate;until:number}>();
  // LRCLIB searches already include the text. Retain only bounded text/metadata,
  // and parse it when previewed instead of making a redundant record request.
  private records = new Map<string, { candidate: LyricCandidate; text: string; instrumental: boolean; until: number }>();
  constructor(private store: LyricsStore, private fetcher: typeof fetch = fetch, private now = Date.now,private budgets={searchMs:18000,documentMs:15000}) {}
  private async json(url: URL, requestSignal: AbortSignal): Promise<any> {
    requestSignal.throwIfAborted();
    if (this.active >= 6) throw new LyricsError('busy');
    const signal = AbortSignal.any([requestSignal, this.stop.signal, AbortSignal.timeout(12000)]);
    this.active++;
    try {
      const response = await this.fetcher(url, { signal, redirect: 'error', headers: url.hostname === 'music.163.com' ? { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' } : { 'User-Agent': 'Slowtune/0.1 (lyrics client)', Accept: 'application/json' } });
      if (!response.ok) { await response.body?.cancel(); throw new LyricsError(response.status === 429 ? 'rate-limited' : response.status === 404 ? 'not-found' : 'upstream'); }
      const reader = response.body?.getReader();
      if (!reader) throw new LyricsError('upstream');
      const chunks: Uint8Array[] = []; let length = 0;
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted(); const row = await reader.read(); signal.throwIfAborted();
          if (row.done) break;
          length += row.value.byteLength;
          if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new LyricsError('upstream'); }
          chunks.push(row.value);
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
    } catch (error) {
      if (requestSignal.aborted || this.stop.signal.aborted) throw new LyricsError(requestSignal.reason?.name==='TimeoutError'?'timeout':'cancelled');
      if (signal.aborted) throw new LyricsError('timeout');
      if (error instanceof LyricsError) throw error;
      throw new LyricsError(error instanceof SyntaxError ? 'upstream' : 'network');
    } finally { this.active--; }
  }
  async search(input: unknown, signal: AbortSignal, desktop=false, progress?:(value:LyricSearch)=>void): Promise<LyricSearch> {
    if(desktop)signal=AbortSignal.any([signal,this.stop.signal,AbortSignal.timeout(this.budgets.searchMs)]);
    const query = input as Record<string, unknown>;
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['title', 'artist', 'durationSeconds'].includes(key)) || typeof query.title !== 'string' || !query.title.trim() || query.title.length > 300 || query.artist !== undefined && (typeof query.artist !== 'string' || query.artist.length > 300) || query.durationSeconds !== undefined && (typeof query.durationSeconds !== 'number' || !Number.isFinite(query.durationSeconds) || query.durationSeconds <= 0 || query.durationSeconds > 86400)) throw new LyricsError('invalid-input');
    signal.throwIfAborted();
    const title = query.title.trim(), artist = short(query.artist), key = JSON.stringify([title, artist, query.durationSeconds]);
    const cached = this.searches.get(key);
    if (cached && cached.until > this.now()) {const value=structuredClone(cached.value);progress?.(value);return value;}
    const value: LyricSearch = { candidates: [], issues: [] };
    const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
    const score = (row: LyricCandidate) => (normalize(row.title) === normalize(title) ? 100 : 0) + (artist && row.artists.some(name => normalize(name) === normalize(artist)) ? 60 : 0) + (row.synced ? 5 : 0) - (typeof query.durationSeconds === 'number' && row.durationSeconds ? Math.min(30, Math.abs(row.durationSeconds - query.durationSeconds)) : 0);
    const sort=()=>value.candidates.sort((a,b)=>score(b)-score(a)||providers.indexOf(a.provider as LyricProvider)-providers.indexOf(b.provider as LyricProvider));
    const results = await Promise.allSettled(providers.map(async provider => {
      const task=async(signal:AbortSignal)=>{
      const url = new URL(provider === 'netease' ? 'https://music.163.com/api/search/get/web' : 'https://lrclib.net/api/search');
      if (provider === 'netease') { url.searchParams.set('s', [title, artist].filter(Boolean).join(' ')); url.searchParams.set('type', '1'); url.searchParams.set('limit', '12'); url.searchParams.set('offset', '0'); }
      else { url.searchParams.set('track_name', title); if (artist) url.searchParams.set('artist_name', artist); }
      const data = await this.json(url, signal);
      if (provider === 'netease' && data?.code !== 200) throw new LyricsError(data?.code === 429 ? 'rate-limited' : 'upstream');
      const rows = provider === 'netease' ? data?.result?.songs ?? (data?.result?.songCount === 0 ? [] : null) : data;
      if (!Array.isArray(rows)) throw new LyricsError('upstream');
      const found: LyricCandidate[] = [];
      for (const row of rows.slice(0, 20)) {
        const item = candidate(provider, row); if (!item) continue;
        found.push(item);
        if(desktop&&provider==='netease'){
          this.metadata.delete(item.id);this.metadata.set(item.id,{value:item,until:this.now()+600000});
          while(this.metadata.size>96)this.metadata.delete(this.metadata.keys().next().value!);
        }
        if (provider === 'lrclib') {
          const text = typeof row.syncedLyrics === 'string' && row.syncedLyrics.trim() ? row.syncedLyrics : typeof row.plainLyrics === 'string' ? row.plainLyrics : '';
          if (new TextEncoder().encode(text).length <= 128 * 1024) {
            this.records.delete(item.id); this.records.set(item.id, { candidate: item, text, instrumental: row.instrumental === true, until: this.now() + 600000 });
            while (this.records.size > 48) this.records.delete(this.records.keys().next().value!);
          }
        }
        if (found.length === 12) break;
      }
      return found;
      };
      try{
        const found=desktop?await this.inflight.run('lyrics',JSON.stringify(['search',provider,title,artist]),signal,task):await task(signal);
        signal.throwIfAborted();value.candidates.push(...(desktop?structuredClone(found):found));sort();progress?.(structuredClone(value));return found;
      }catch(error){
        if(!signal.aborted){value.issues.push({provider,code:error instanceof LyricsError?error.code:'upstream'});progress?.(structuredClone(value));}
        throw error;
      }
    }));
    void results;
    if(signal.aborted)throw new LyricsError(signal.reason?.name==='TimeoutError'?'timeout':'cancelled');
    sort();
    value.issues.sort((a,b)=>providers.indexOf(a.provider)-providers.indexOf(b.provider));
    // Failed searches are retryable immediately; only complete results enter the bounded cache.
    if (!value.issues.length) {
      this.searches.delete(key); this.searches.set(key, { value: structuredClone(value), until: this.now() + 600000 });
      while (this.searches.size > 100) this.searches.delete(this.searches.keys().next().value!);
    }
    return value;
  }
  async document(input: unknown, signal: AbortSignal, desktop=false): Promise<LyricDocument> {
    const target = lyricCandidate(input);
    if(!desktop)return this.documentOnce(target,signal);
    signal=AbortSignal.any([signal,this.stop.signal,AbortSignal.timeout(this.budgets.documentMs)]);
    try{return structuredClone(await this.inflight.run('lyrics',JSON.stringify(['document',target]),signal,async s=>{
      const stop=new AbortController();try{return await this.documentOnce(target,AbortSignal.any([s,stop.signal]),true);}finally{stop.abort();}
    }));}
    catch(error){if(signal.aborted)throw new LyricsError(signal.reason?.name==='TimeoutError'?'timeout':'cancelled');throw error;}
  }
  private async documentOnce(target:{provider:LyricProvider;id:string},signal:AbortSignal,desktop=false):Promise<LyricDocument>{
    signal.throwIfAborted();
    const cached = this.store.cached(target.provider + ':' + target.id, this.now());
    if (cached) return cached;
    let metadata: LyricCandidate | undefined, text: string | undefined, translation: string | undefined, instrumental = false;
    if (target.provider === 'lrclib') {
      const record = this.records.get(target.id);
      if (record && record.until > this.now()) { metadata = record.candidate; text = record.text; instrumental = record.instrumental; }
      else {
        const data = await this.json(new URL('https://lrclib.net/api/get/' + target.id), signal);
        metadata = candidate('lrclib', data); text = typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim() ? data.syncedLyrics : data?.plainLyrics;
        instrumental = data?.instrumental === true;
      }
    } else {
      const detail = new URL('https://music.163.com/api/song/detail'); detail.searchParams.set('ids', '[' + target.id + ']');
      const lyric = new URL('https://music.163.com/api/song/lyric');
      for (const [key, value] of Object.entries({ id: target.id, lv: '-1', kv: '-1', tv: '-1' })) lyric.searchParams.set(key, value);
      const known=desktop?this.metadata.get(target.id):undefined;
      let body:any;
      if(known&&known.until>this.now()){metadata=known.value;body=await this.json(lyric,signal);}
      else if(desktop){
        const [data,result]=await Promise.all([this.json(detail,signal),this.json(lyric,signal)]);
        if(data?.code!==200)throw new LyricsError('upstream');metadata=candidate('netease',data?.songs?.[0]);body=result;
      }else{
        const data=await this.json(detail,signal);if(data?.code!==200)throw new LyricsError('upstream');
        metadata=candidate('netease',data?.songs?.[0]);body=await this.json(lyric,signal);
      }
      if (body?.code !== 200) throw new LyricsError('upstream');
      text = body?.lrc?.lyric; translation = body?.tlyric?.lyric; instrumental = body?.nolyric === true;
    }
    if (!metadata || metadata.id !== target.id) throw new LyricsError('not-found');
    let lines;
    try { lines = parseLyrics(typeof text === 'string' ? text : '', typeof translation === 'string' ? translation : undefined); }
    catch { throw new LyricsError('upstream'); }
    if (!instrumental && !lines.some(line => line.text)) throw new LyricsError('not-found');
    const document: LyricDocument = { ...metadata, instrumental, synced: lines.some(line => line.startMs !== null), lines };
    signal.throwIfAborted(); this.stop.signal.throwIfAborted(); this.store.cache(document, this.now());
    return document;
  }
  dispose() { this.stop.abort(); this.inflight.dispose(); this.searches.clear(); this.records.clear(); this.metadata.clear(); }
}
