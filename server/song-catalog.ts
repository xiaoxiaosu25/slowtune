import { SongLibraryError } from './song-library-errors.js';
import { object, text } from './song-library-codec.js';
import { artworkUrl } from './artwork-url.js';
import { parseTitle } from './song-library-organization.js';
import type { SongLibraryService } from './song-library-service.js';
import type { Song, SongCatalogRecord, SongLibrarySnapshot, DesktopSongCatalog } from './song-library-types.js';

export class SongCatalogError extends Error {
  constructor(readonly code: 'network' | 'timeout' | 'upstream' | 'rate-limited') { super(code); }
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').trim();
const alternate = /\b(?:live|remix|remaster(?:ed)?|instrumental|karaoke|cover|acoustic)\b|现场|演唱会|混音|重制|伴奏|翻唱|不插电/iu;
const collection = /合集|串烧|精选集|歌单|盘点|\b(?:medley|playlist|compilation|mashup)\b/iu;
const baseTitle = (value: string) => value.replace(/\s*[（(【\[]([^()（）【】\[\]]+)[）)】\]]\s*$/u, (whole, qualifier: string) => alternate.test(qualifier) || /^(?:官方)?(?:mv|录音室版|原版|studio(?: version)?)$/iu.test(qualifier.trim()) ? '' : whole).trim();
const validId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d{0,15}$/u.test(id) && Number.isSafeInteger(Number(id));

export function songCatalogQuery(song: Song, snapshot: SongLibrarySnapshot): { title: string; artists: string[] } | undefined {
  if (['medley', 'collection'].includes(song.contentKind) || collection.test(song.title)) return;
  const links = snapshot.catalogLinks.filter(l => l.songId === song.id);
  const inputs = [
    { title: song.title, artists: song.artists },
    ...links.map(l => l.context),
    ...snapshot.versions.filter(v => v.songId === song.id).slice(0, 20).map(v => v.facts),
  ];
  const queries: { title: string; artists: string[] }[] = [];
  for (const input of inputs) {
    if (collection.test(input.title)) continue;
    const parsed = parseTitle(input.title, input.artists);
    // An ambiguous separator is useful for manual search, never for automatic adoption.
    const patches = !parsed.ambiguous && parsed.patches.length === 1 ? parsed.patches : [];
    const patch = patches[0], title = baseTitle(patch?.title ?? input.title), artists = patch?.artists ?? input.artists ?? [];
    if (title && artists.length && [title, ...artists].join(' ').length <= 500) queries.push({ title, artists });
  }
  if (!queries.length) return;
  const first = queries[0];
  // Prefer explicit effective/catalogue facts; conflicting parsed-only evidence needs review.
  if (!song.artists?.length && !links.length && queries.some(q => normalize(q.title) !== normalize(first.title) || JSON.stringify(q.artists.map(normalize).sort()) !== JSON.stringify(first.artists.map(normalize).sort()))) return;
  return first;
}

export function automaticCatalogMatch(query: { title: string; artists: string[] }, candidates: SongCatalogRecord[]): SongCatalogRecord | undefined {
  const artists = [...new Set(query.artists.map(normalize))].sort();
  const matching = candidates.filter(c => c.artwork && !alternate.test(c.title + ' ' + (c.album ?? ''))
    && normalize(c.title) === normalize(baseTitle(query.title))
    && JSON.stringify([...new Set(c.artists.map(normalize))].sort()) === JSON.stringify(artists));
  return matching.length === 1 ? matching[0] : undefined;
}

/** Catalogue-only adapter. It never resolves or changes playable sources. */
export class NeteaseSongCatalog {
  private stop = new AbortController();
  private active = 0;
  private searches = new Map<string, { until: number; records: SongCatalogRecord[] }>();
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}
  private async json(path: string, params: Record<string, string>, requestSignal: AbortSignal) {
    requestSignal.throwIfAborted();
    if (this.active >= 4) throw new SongLibraryError('busy');
    const url = new URL(path, 'https://music.163.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const signal = AbortSignal.any([requestSignal, this.stop.signal, AbortSignal.timeout(12000)]);
    this.active++;
    try {
      const response = await this.fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' } });
      if (!response.ok) { await response.body?.cancel(); throw new SongCatalogError(response.status === 429 ? 'rate-limited' : 'upstream'); }
      const reader = response.body?.getReader(); if (!reader) throw new SongCatalogError('upstream');
      const chunks: Uint8Array[] = []; let length = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted(); const row = await reader.read(); signal.throwIfAborted(); if (row.done) break;
          length += row.value.byteLength;
          if (length > 2 * 1024 * 1024) throw new SongCatalogError('upstream');
          chunks.push(row.value);
        }
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (data?.code !== 200) throw new SongCatalogError(data?.code === 429 ? 'rate-limited' : 'upstream');
        return data;
      } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (requestSignal.aborted || this.stop.signal.aborted) throw new SongLibraryError('cancelled');
      if (signal.aborted) throw new SongCatalogError('timeout');
      if (error instanceof SongCatalogError || error instanceof SongLibraryError) throw error;
      throw new SongCatalogError(error instanceof SyntaxError ? 'upstream' : 'network');
    } finally { this.active--; }
  }
  async records(ids: string[], signal: AbortSignal): Promise<SongCatalogRecord[]> {
    if (!ids.length || ids.length > 12 || ids.some(id => !validId(id))) throw new SongLibraryError('invalid-input');
    const data = await this.json('/api/song/detail', { ids: '[' + ids.join(',') + ']' }, signal);
    if (!Array.isArray(data.songs)) throw new SongCatalogError('upstream');
    return data.songs.slice(0, 12).flatMap((row: any) => {
      const id = String(row?.id), title = row?.name, album = row?.album ?? row?.al;
      const rawArtists = row?.artists ?? row?.ar;
      const artists = Array.isArray(rawArtists) ? rawArtists.map((artist: any) => artist?.name) : undefined;
      if (!validId(id) || !ids.includes(id) || typeof title !== 'string' || !title.trim() || title.length > 1000 || !Array.isArray(artists) || !artists.length || artists.length > 100 || artists.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 1000 || /[\u0000-\u001f\u007f]/u.test(v)) || /[\u0000-\u001f\u007f]/u.test(title)) return [];
      const artwork = artworkUrl(album?.picUrl), duration = (row.duration ?? row.dt) / 1000;
      return [{ provider: 'netease' as const, id, title: title.trim(), artists, url: 'https://music.163.com/song?id=' + id,
        ...(typeof album?.name === 'string' && album.name.trim() && album.name.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(album.name) ? { album: album.name } : {}),
        ...(artwork ? { artwork } : {}), ...(Number.isFinite(duration) && duration > 0 && duration <= 86400 ? { durationSeconds: duration } : {}) }];
    });
  }
  async search(query: string, signal: AbortSignal): Promise<SongCatalogRecord[]> {
    text(query, 500); const key = query.trim(), cached = this.searches.get(key);
    if (cached && cached.until > this.now()) return structuredClone(cached.records);
    const data = await this.json('/api/search/get/web', { s: key, type: '1', limit: '12', offset: '0' }, signal);
    const rows = data?.result?.songs ?? (data?.result?.songCount === 0 ? [] : undefined);
    if (!Array.isArray(rows)) throw new SongCatalogError('upstream');
    const ids = [...new Set<string>(rows.slice(0, 12).map((row: any) => String(row?.id)).filter(validId))];
    const records = ids.length ? await this.records(ids, signal) : [];
    this.searches.set(key, { records: structuredClone(records), until: this.now() + 600000 });
    while (this.searches.size > 64) this.searches.delete(this.searches.keys().next().value!);
    return records;
  }
  dispose() { this.stop.abort(); this.searches.clear(); }
}

const fingerprint = (song: Song, snapshot: SongLibrarySnapshot) => JSON.stringify([song, snapshot.versions.filter(v => v.songId === song.id), snapshot.catalogLinks.filter(l => l.songId === song.id)]);
const retained = (snapshot: SongLibrarySnapshot) => new Set([...snapshot.favorites.map(f => f.songId), ...snapshot.playlists.flatMap(p => p.entries.map(e => e.songId))]);

export class SongCatalogService {
  private working = false;
  private stop = new AbortController();
  constructor(private library: SongLibraryService, private provider = new NeteaseSongCatalog(), private now = Date.now) {}
  search(input: unknown, signal: AbortSignal) {
    object(input, ['query']); text(input.query, 500); return this.provider.search(input.query, signal);
  }
  async select(expected: string | null, input: unknown, signal: AbortSignal) {
    signal = AbortSignal.any([signal, this.stop.signal]);
    if (signal.aborted) throw new SongLibraryError('cancelled');
    object(input, ['songId', 'id', 'disabled']); text(input.songId, 200);
    if (input.disabled === true ? input.id !== undefined : input.disabled !== undefined || !validId(input.id)) throw new SongLibraryError('invalid-input');
    const before = this.library.read();
    if (before.revision !== expected) throw new SongLibraryError('conflict', before.revision);
    if (!before.snapshot.songs.some(s => s.id === input.songId)) throw new SongLibraryError('not-found');
    const record = input.disabled ? undefined : (await this.provider.records([input.id], signal)).find(r => r.id === input.id);
    if (!input.disabled && !record) throw new SongLibraryError('not-found');
    this.library.transaction(expected, context => {
      const song = context.document.snapshot.songs.find(s => s.id === input.songId)!;
      song.desktopCatalog = record ? { state: 'matched', checkedAt: this.now(), selection: 'manual', record } : { state: 'disabled', checkedAt: this.now() };
      song.updatedAt = this.now();
    }, signal);
    return this.library.read();
  }
  async backfill(signal: AbortSignal) {
    signal = AbortSignal.any([signal, this.stop.signal]);
    if (signal.aborted) throw new SongLibraryError('cancelled');
    if (this.working) throw new SongLibraryError('busy');
    this.working = true;
    try {
      const before = this.library.read(), kept = retained(before.snapshot);
      const song = before.snapshot.songs.find(s => kept.has(s.id) && (!s.desktopCatalog || s.desktopCatalog.state === 'error' && this.now() - s.desktopCatalog.checkedAt >= 3600000 || s.desktopCatalog.state === 'not-found' && this.now() - s.desktopCatalog.checkedAt >= 7 * 86400000));
      if (!song) return { ...before, more: false };
      const query = songCatalogQuery(song, before.snapshot), stamp = fingerprint(song, before.snapshot);
      let result: DesktopSongCatalog;
      try {
        if (!query) result = { state: 'review', checkedAt: this.now() };
        else {
          const candidates = await this.provider.search([query.title, ...query.artists].join(' '), signal);
          const record = automaticCatalogMatch(query, candidates);
          result = record ? { state: 'matched', checkedAt: this.now(), selection: 'automatic', record } : { state: candidates.length ? 'review' : 'not-found', checkedAt: this.now() };
        }
      } catch (error) {
        if (signal.aborted || error instanceof SongLibraryError && error.code === 'cancelled') throw new SongLibraryError('cancelled');
        result = { state: 'error', checkedAt: this.now(), issue: error instanceof SongCatalogError ? error.code : 'upstream' };
      }
      if (signal.aborted) throw new SongLibraryError('cancelled');
      const latest = this.library.revision()===before.revision?before:this.library.read(), current = latest.snapshot.songs.find(s => s.id === song.id);
      // Re-read after network I/O; unrelated changes may proceed, touched songs never receive stale results.
      if (current && retained(latest.snapshot).has(current.id) && fingerprint(current, latest.snapshot) === stamp) {
        const saved=this.library.transaction(latest.revision, context => {
          const current = context.document.snapshot.songs.find(s => s.id === song.id)!;
          current.desktopCatalog = result; current.updatedAt = this.now();
        }, signal);
        return {modelVersion:saved.modelVersion,revision:saved.revision,snapshot:saved.document.snapshot,more:true,...(result.state==='error'?{retryAfterMs:60000}:{})};
      }
      return { ...this.library.read(), more: true, ...(result.state === 'error' ? { retryAfterMs: 60000 } : {}) };
    } finally { this.working = false; }
  }
  dispose() { this.stop.abort(); this.provider.dispose(); }
}
