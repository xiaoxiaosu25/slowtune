import { SongLibraryError } from './song-library-errors.js';
import { object, text } from './song-library-codec.js';
import { parseTitle } from './song-library-organization.js';
import type { SongLibraryService } from './song-library-service.js';
import type { Song, SongCatalogRecord, SongLibrarySnapshot, DesktopSongCatalog } from './song-library-types.js';
import { NeteaseSongCatalog, SongCatalogError } from '@studio/music-sources/catalog';
export { NeteaseSongCatalog, SongCatalogError } from '@studio/music-sources/catalog';

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
  async dispose() { this.stop.abort(); await this.provider.dispose(); }
}
