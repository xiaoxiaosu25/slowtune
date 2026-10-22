import { parseYoutubeMusicCatalogue } from '@studio/music-sources/discovery';
import { MusicSourceError, type MusicApi, type MusicEntry, type MusicHost } from '@studio/music-sources';
import { artworkUrl } from './artwork-url.js';
import { chineseMusicRegions, isYoutubeRegion, youtubeMusicChannel, youtubeMusicUrl, type YoutubeMusicResult, type YoutubeRegion } from './youtube-regions.js';

interface PublicPlaylist { id: string; title: string }
type CatalogueLoader = (region: YoutubeRegion, signal: AbortSignal) => Promise<unknown>;
interface Dependencies { catalogue: CatalogueLoader; list: MusicApi['list']; now: () => number }
type PlaylistPage = Awaited<ReturnType<MusicApi['list']>>;
interface SharedPlaylistPage {
  controller: AbortController;
  promise: Promise<PlaylistPage>;
  readers: number;
  settled: boolean;
  until: number;
}
interface FeedState {
  batch: number;
  busy: boolean;
  recent: string[];
  cursors: Map<string, string>;
  cached?: YoutubeMusicResult;
}

export { parseYoutubeMusicCatalogue, createYoutubeCatalogueLoader } from '@studio/music-sources/discovery';

function selectPlaylists(catalogue: PublicPlaylist[], region: YoutubeRegion, batch: number): PublicPlaylist[] {
  const selected: PublicPlaylist[] = [];
  const pick = (pool: PublicPlaylist[], count: number, offset: number) => {
    if (!pool.length) return;
    for (let i = 0; i < pool.length && count > 0; i++) {
      const item = pool[(offset + i) % pool.length];
      if (!selected.some(previous => previous.id === item.id)) { selected.push(item); count--; }
    }
  };
  if (chineseMusicRegions.has(region)) {
    const mando = catalogue.filter(p => /mando|mandarin|国语|國語|华语|華語/i.test(p.title));
    const canto = catalogue.filter(p => /canto|粤语|粵語|粤曲|粵曲|广东|廣東/i.test(p.title));
    pick(mando, region === 'TW' ? 2 : 1, batch);
    pick(canto, selected.length < 2 ? 1 : 0, batch);
  } else {
    const local = region === 'JP' ? /j-pop|japanese|日本|邦楽/i : region === 'KR' ? /k-pop|korean|韩国|韓國/i : region === 'IN' ? /india|hindi|bollywood|印度/i : /hit list|pop certified|released|hits/i;
    pick(catalogue.filter(p => local.test(p.title)), 2, batch * 2);
  }
  pick(catalogue, 3 - selected.length, batch * 3);
  return selected;
}

function sourceError(error: unknown, signal: AbortSignal): MusicSourceError {
  if (error instanceof MusicSourceError) return error;
  if (signal.aborted) return new MusicSourceError({ code: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', provider: 'youtube', retryable: true });
  const message = error instanceof Error ? error.message : '';
  return new MusicSourceError({ code: /429|rate.?limit/i.test(message) ? 'rate-limited' : /403|country|not available/i.test(message) ? 'restricted' : /fetch|network|connect|timed out/i.test(message) ? 'network' : 'upstream', provider: 'youtube', retryable: true });
}

export class YoutubeMusicDiscovery {
  private catalogues = new Map<YoutubeRegion, { items: PublicPlaylist[]; updatedAt: number }>();
  private feeds = new Map<string, FeedState>();
  private playlistPages = new Map<string, SharedPlaylistPage>();
  private stop = new AbortController();
  private work = new Set<Promise<YoutubeMusicResult>>();
  private owners=new Map<AbortController,string>();
  constructor(private dependencies: Dependencies, private confirmedOnly=false) {}
  inheritFeed(region:YoutubeRegion,from:string,to:string){
    const source=this.feeds.get(from+':'+region),key=to+':'+region;
    if(!source||this.feeds.has(key))return;
    if(this.feeds.size>=64){const oldest=[...this.feeds].find(([key,feed])=>key!==from+':'+region&&!feed.busy);if(oldest)this.feeds.delete(oldest[0]);}
    this.feeds.set(key,{batch:source.batch,busy:false,recent:[...source.recent],cursors:new Map(source.cursors)});
  }

  /** Source continuation tokens are single-use; replay their pages across inherited feeds. */
  private async playlistPage(id: string, cursor: string | undefined, signal: AbortSignal): Promise<PlaylistPage> {
    signal.throwIfAborted();
    const ref = { provider: 'youtube' as const, kind: 'playlist' as const, id };
    if (!cursor) return this.dependencies.list({ref, limit: 12}, {signal});
    const key = JSON.stringify([id, cursor]), now = this.dependencies.now();
    for (const [key, page] of this.playlistPages) {
      if (page.settled && page.until <= now) this.playlistPages.delete(key);
    }
    let shared = this.playlistPages.get(key);
    if (!shared || shared.controller.signal.aborted) {
      // Bound replay storage to two pages for each of three playlists in 64 feeds.
      if (this.playlistPages.size >= 384) {
        const oldest = [...this.playlistPages].find(([, page]) => page.settled);
        if (oldest) this.playlistPages.delete(oldest[0]);
      }
      const controller = new AbortController();
      const combined = AbortSignal.any([controller.signal, this.stop.signal, AbortSignal.timeout(45000)]);
      shared = {controller, promise: this.dependencies.list({ref, limit: 12, cursor}, {signal: combined}), readers: 0, settled: false, until: now + 900000};
      const operation = shared;
      operation.promise = operation.promise.then(page => {
        combined.throwIfAborted();
        operation.settled = true;
        return page;
      }).catch(error => {
        if (this.playlistPages.get(key) === operation) this.playlistPages.delete(key);
        throw error;
      });
      this.playlistPages.set(key, operation);
    }
    const operation = shared;
    operation.readers++;
    return new Promise<PlaylistPage>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener('abort', abort);
        if (--operation.readers === 0 && !operation.settled) operation.controller.abort(signal.reason);
        return true;
      };
      const abort = () => {if (finish()) reject(signal.reason);};
      signal.addEventListener('abort', abort, {once: true});
      operation.promise.then(page => {if (finish()) resolve(page);}, error => {if (finish()) reject(error);});
      if (signal.aborted) abort();
    });
  }

  read(region: string, scope: string, signal: AbortSignal, refresh = false, enough?: (items:MusicEntry[])=>boolean): Promise<YoutubeMusicResult> {
    if (!isYoutubeRegion(region)) return Promise.reject(new MusicSourceError({ code: 'invalid-input', provider: 'youtube', retryable: false }));
    if (signal.aborted) return Promise.reject(sourceError(signal.reason, signal));
    if (this.stop.signal.aborted) return Promise.reject(new MusicSourceError({ code: 'disposed', provider: 'youtube', retryable: false }));
    if (this.work.size >= 4) return Promise.reject(new MusicSourceError({ code: 'busy', provider: 'youtube', retryable: true }));
    const key = `${scope}:${region}`;
    let state = this.feeds.get(key);
    if (state?.busy) return Promise.reject(new MusicSourceError({ code: 'busy', provider: 'youtube', retryable: true }));
    if (!state) {
      if (this.feeds.size >= 64) {
        const oldest = [...this.feeds].find(([, feed]) => !feed.busy);
        if (oldest) this.feeds.delete(oldest[0]);
      }
      state = { batch: 0, busy: false, recent: [], cursors: new Map() };
      this.feeds.set(key, state);
    }
    if (!refresh && state.cached && this.dependencies.now() - state.cached.fetchedAt < 30000) return Promise.resolve(state.cached);
    state.busy = true;
    const owner=new AbortController();this.owners.set(owner,scope);
    const combined = AbortSignal.any([signal, this.stop.signal,owner.signal, AbortSignal.timeout(45000)]);
    const work = this.load(region, state, combined,enough).catch(error => { throw sourceError(error, combined); }).finally(() => { state!.busy = false; this.work.delete(work);this.owners.delete(owner); });
    this.work.add(work);
    return work;
  }

  private async load(region: YoutubeRegion, state: FeedState, signal: AbortSignal, enough?: (items:MusicEntry[])=>boolean): Promise<YoutubeMusicResult> {
    signal.throwIfAborted();
    let catalogue = this.catalogues.get(region);
    if (!catalogue || this.dependencies.now() - catalogue.updatedAt >= 600000) {
      const items = parseYoutubeMusicCatalogue(await this.dependencies.catalogue(region, signal));
      signal.throwIfAborted();
      if (!items.length) throw new MusicSourceError({ code: 'upstream', provider: 'youtube', retryable: true });
      catalogue = { items, updatedAt: this.dependencies.now() };
      this.catalogues.set(region, catalogue);
    }
    const selected = selectPlaylists(catalogue.items, region, state.batch);
    const pages: MusicEntry[][] = selected.map(() => []);
    const nextCursors = new Map<string, string | undefined>();
    const warnings: YoutubeMusicResult['warnings'] = [];
    let index = 0;
    const worker = async () => {
      while (index < selected.length) {
        signal.throwIfAborted();
        const current = index++, playlist = selected[current];
        const ref = { provider: 'youtube' as const, kind: 'playlist' as const, id: playlist.id };
        try {
          let page;
          try { page = await this.playlistPage(playlist.id, state.cursors.get(playlist.id), signal); }
          catch (error) {
            if (!(error instanceof MusicSourceError) || error.code !== 'stale-cursor') throw error;
            signal.throwIfAborted();
            page = await this.dependencies.list({ ref, limit: 12 }, { signal });
          }
          pages[current] = page.items.slice(0, 12).filter(entry => entry.ref.provider === 'youtube' && entry.ref.kind === 'video' && /^[\w-]{11}$/.test(entry.ref.id)).map(entry => ({ ...entry, artwork: artworkUrl(entry.artwork) }));
          nextCursors.set(playlist.id, page.nextCursor);
        } catch (error) {
          signal.throwIfAborted();
          warnings.push({ title: playlist.title, code: sourceError(error, signal).code });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    signal.throwIfAborted();
    if (warnings.length === selected.length) throw new MusicSourceError({ code: warnings[0].code as MusicSourceError['code'], provider: 'youtube', retryable: true });
    if(enough&&!enough(pages.flat())){
      let refill=0;
      const next=async()=>{
        while(refill<selected.length){
          const current=refill++,playlist=selected[current],cursor=nextCursors.get(playlist.id);
          if(!cursor||enough(pages.flat()))continue;
          try {
            const page=await this.playlistPage(playlist.id,cursor,signal);
            pages[current].push(...page.items.slice(0,12).filter(entry=>entry.ref.provider==='youtube'&&entry.ref.kind==='video'&&/^[\w-]{11}$/.test(entry.ref.id)).map(entry=>({...entry,artwork:artworkUrl(entry.artwork)})));
            nextCursors.set(playlist.id,page.nextCursor);
          }catch(error){signal.throwIfAborted();warnings.push({title:playlist.title,code:sourceError(error,signal).code});}
        }
      };
      await Promise.all([next(),next()]);
    }
    const candidates = new Map<string, MusicEntry>();
    for (let position = 0; position < (enough?24:12); position++) for (const page of pages) {
      const entry = page[position];
      if (entry && !candidates.has(entry.ref.id)) candidates.set(entry.ref.id, entry);
    }
    const recent = new Set(state.recent), entries = [...candidates.values()];
    const items = [...entries.filter(entry => !recent.has(entry.ref.id)), ...entries.filter(entry => recent.has(entry.ref.id))];
    const result: YoutubeMusicResult = {
      region, shelf: { id: 'youtube-music-selection', title: 'YouTube 音乐精选', kind: 'recommendation', page: { items } },
      sourceUrl: `${youtubeMusicUrl}?gl=${region}&hl=zh-CN`, fetchedAt: this.dependencies.now(), catalogueUpdatedAt: catalogue.updatedAt,
      playlists: selected.map(playlist => ({ ...playlist, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.id)}` })), warnings,
    };
    for (const [id, cursor] of nextCursors) { if (cursor) state.cursors.set(id, cursor); else state.cursors.delete(id); }
    if (!this.confirmedOnly) state.recent = [...state.recent.filter(id => !candidates.has(id)), ...items.map(entry => entry.ref.id)].slice(-100);
    state.batch++; state.cached = result;
    return result;
  }

  diagnostics() { return { active: this.work.size, regions: this.catalogues.size, feeds: this.feeds.size }; }
  cancelOwner(session?:string){for(const [owner,scope]of this.owners){let matches=!session||scope===session;try{matches ||= JSON.parse(scope).includes(session);}catch{}if(matches)owner.abort();}}
  async dispose() { this.stop.abort(); await Promise.allSettled([...this.work, ...[...this.playlistPages.values()].map(page => page.promise)]); this.feeds.clear(); this.catalogues.clear(); this.playlistPages.clear(); }
}
