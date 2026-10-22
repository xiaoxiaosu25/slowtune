import { randomUUID } from 'node:crypto';
import { validateRef, type EntryRef, type MusicEntry } from '@studio/music-sources';
import { SongLibraryError } from './song-library-errors.js';
import { object, list, text } from './song-library-codec.js';
import { applySongEdits, updateAutomaticSong, updateVersionFacts } from './song-library-edits.js';
import { catalogSongKey, chooseSongVersion, songSourceKey, validateSongSourceSelection } from './song-library-policy.js';
import type { SongLibraryService } from './song-library-service.js';
import type { TransactionContext } from './song-library-store.js';
import type { ChartSongContext, SongPlaybackSelection, SongVersion, SongVideoRef, VersionFacts } from './song-library-types.js';
import type { SongSearchQuery } from './search-policy.js';
import { validateSongSearchMode, validateAudioSupport } from './search-settings.js';
import { sameVideoPart, songKey } from './search-policy.js';
import type { VerifiedMusicEntry } from './audio-quality.js';
import { desktopCatalogLibrary } from './song-catalog-display.js';

export interface SongSourceAccess {
  metadata(ref: EntryRef, signal: AbortSignal): Promise<MusicEntry>;
  resolve(query: SongSearchQuery, signal: AbortSignal): Promise<VerifiedMusicEntry>;
  enabled(provider: string): boolean;
  generation(): string;
}
const fail = (code: 'invalid-input' | 'not-found' | 'duplicate' | 'cancelled' | 'source-disabled' = 'invalid-input'): never => { throw new SongLibraryError(code); };
export function songVersionFacts(entry: MusicEntry): VersionFacts {
  return { title: entry.title, ...(entry.artists ? { artists: entry.artists } : {}), ...(entry.artwork ? { artwork: entry.artwork } : {}),
    ...(entry.uploader ? { uploader: entry.uploader.name, ...(entry.uploader.id ? { uploaderId: entry.uploader.id } : {}) } : {}),
    ...(entry.durationSeconds !== undefined ? { durationSeconds: entry.durationSeconds } : {}),
    url: entry.ref.provider === 'bilibili' ? `https://www.bilibili.com/video/${entry.ref.id}` : `https://www.youtube.com/watch?v=${entry.ref.id}` };
}
/** Reusing an exact source changes its relations, never its availability or facts. */
function attachSongVersion(context: TransactionContext, version: SongVersion, now: number, songId?: string, chart?: ChartSongContext) {
  const snapshot = context.document.snapshot, linked = chart ? snapshot.catalogLinks.find(link => link.key === catalogSongKey(chart)) : undefined;
  if (songId && version.songId !== songId || linked && version.songId !== linked.songId) fail('duplicate');
  if (chart && !linked) snapshot.catalogLinks.push({ id: randomUUID(), key: catalogSongKey(chart), songId: version.songId, context: structuredClone(chart) });
  if (chart) updateAutomaticSong(context, version.songId, { title: chart.title, ...(chart.artists ? { artists: chart.artists } : {}) }, 'catalog', now);
  return version;
}
/** Canonical metadata is prepared outside the transaction. Titles never establish ownership. */
export function adoptSongSource(context: TransactionContext, entry: MusicEntry, now: number, songId?: string, chart?: ChartSongContext): SongVersion {
  const snapshot = context.document.snapshot, sourceKey = songSourceKey(entry.ref as SongVideoRef);
  const existing = snapshot.versions.find(version => songSourceKey(version.ref) === sourceKey);
  if (existing) {
    attachSongVersion(context, existing, now, songId, chart);
    updateVersionFacts(context, existing.id, songVersionFacts(entry), { state: 'available', checkedAt: now });
    return existing;
  }
  const linked = chart ? snapshot.catalogLinks.find(link => link.key === catalogSongKey(chart)) : undefined;
  if (songId && linked && linked.songId !== songId) fail('duplicate');
  let id = songId ?? linked?.songId;
  if (id && !snapshot.songs.some(song => song.id === id)) fail('not-found');
  if (!id) {
    id = randomUUID();
    applySongEdits(context, [{ type: 'create-song', id, title: chart?.title ?? entry.title, artists: chart ? chart.artists : entry.artists, artwork: chart?.artwork ?? entry.artwork, source: chart ? 'catalog' : 'parsed', ...(chart ? { context: chart } : {}) }], now);
  } else if (chart && !linked) {
    snapshot.catalogLinks.push({ id: randomUUID(), key: catalogSongKey(chart), songId: id, context: structuredClone(chart) });
  }
  if (chart) updateAutomaticSong(context, id, { title: chart.title, ...(chart.artists ? { artists: chart.artists } : {}) }, 'catalog', now);
  const version: SongVersion = { id: randomUUID(), songId: id, ref: entry.ref as SongVideoRef, label: '', kind: 'other', facts: songVersionFacts(entry), availability: { state: 'available', checkedAt: now } };
  applySongEdits(context, [{ type: 'add-version', version }], now);
  return version;
}

export class SongLibrarySources {
  constructor(private library: SongLibraryService, private access: SongSourceAccess, private now = Date.now) {}
  private check(signal: AbortSignal, generation: string, provider?: string) {
    if (signal.aborted || generation !== this.access.generation()) fail('cancelled');
    if (provider && !this.access.enabled(provider)) fail('source-disabled');
  }
  private async metadata(ref: EntryRef, signal: AbortSignal, generation: string) {
    try { validateRef(ref); } catch { fail(); }
    if (ref.kind !== 'video' || !['bilibili', 'youtube'].includes(ref.provider)) fail();
    this.check(signal, generation, ref.provider);
    const result = await this.access.metadata(ref, signal);
    this.check(signal, generation, ref.provider);
    const entry = result.ref.provider === 'bilibili' && !result.ref.part ? result.parts?.[0] ?? result : result;
    if (entry.ref.provider !== ref.provider || entry.ref.id !== ref.id || ref.part && entry.ref.part !== ref.part) fail();
    songSourceKey(entry.ref as SongVideoRef);
    return entry;
  }
  async save(expected: string | null, input: unknown, signal: AbortSignal) {
    object(input, ['refs', 'target', 'playlistId', 'name', 'songId', 'context', 'duplicates', 'song', 'label']);
    list(input.refs, 500); if (!input.refs.length || !['favorite', 'playlist', 'version'].includes(input.target)) fail();
    if (input.songId !== undefined) text(input.songId, 200);
    if (input.target === 'version' && !input.songId) fail();
    if (input.song !== undefined) {
      object(input.song, ['title', 'artists']); text(input.song.title, 1000);
      if (input.song.artists !== undefined) { list(input.song.artists, 100); input.song.artists.forEach(artist => text(artist, 500)); }
      if (input.target !== 'favorite' || input.refs.length !== 1) fail();
    }
    if (input.label !== undefined) { text(input.label, 1000, true); if (input.refs.length !== 1) fail(); }
    if (input.context !== undefined) catalogSongKey(input.context);
    if (input.duplicates !== undefined && !['allow', 'skip', 'reject'].includes(input.duplicates)) fail();
    if (input.target === 'playlist') { if (input.playlistId !== undefined) text(input.playlistId, 200); else text(input.name, 200); }
    const current = this.library.read(); if (current.revision !== expected) throw new SongLibraryError('conflict', current.revision);
    const generation = this.access.generation(), entries: (MusicEntry | SongVersion)[] = [], cache = new Map<string, MusicEntry | SongVersion>();
    const known = new Map(current.snapshot.versions.map(version => [songSourceKey(version.ref), version]));
    for (const ref of input.refs) {
      validateSongSourceSelection(ref);
      this.check(signal, generation, ref.provider);
      const key = JSON.stringify(ref), previous = cache.get(key);
      // A BV without cid must still be resolved; never infer its first P from ownership.
      const saved = ref.provider === 'bilibili' && !ref.part ? undefined : known.get(songSourceKey(ref));
      const entry = previous ?? saved ?? await this.metadata(ref, signal, generation); cache.set(key, entry); entries.push(entry);
    }
    let changed = 0, playlistId = input.playlistId as string | undefined;
    const result = this.library.transaction(expected, context => {
      this.check(signal, generation);
      if (input.target === 'playlist' && !playlistId) {
        playlistId = randomUUID(); applySongEdits(context, [{ type: 'create-playlist', id: playlistId, name: input.name }], this.now());
      }
      for (const entry of entries) {
        this.check(signal, generation, entry.ref.provider);
        const version = 'songId' in entry
          ? attachSongVersion(context, context.document.snapshot.versions.find(version => version.id === entry.id) ?? fail('not-found'), this.now(), input.songId, input.context)
          : adoptSongSource(context, entry, this.now(), input.songId, input.context);
        if (input.song) applySongEdits(context, [{ type: 'edit-song', songId: version.songId, ...input.song }], this.now());
        if (input.label !== undefined) applySongEdits(context, [{ type: 'edit-version', versionId: version.id, label: input.label }], this.now());
        if (input.target === 'favorite') {
          const had = context.document.snapshot.favorites.some(favorite => favorite.songId === version.songId);
          applySongEdits(context, [{ type: 'favorite', songId: version.songId }], this.now()); if (!had) changed++;
        } else if (input.target === 'playlist') {
          const playlist = context.document.snapshot.playlists.find(playlist => playlist.id === playlistId) ?? fail('not-found');
          const duplicate = playlist.entries.some(entry => entry.songId === version.songId);
          if (duplicate && input.duplicates === 'reject') fail('duplicate');
          if (!duplicate || input.duplicates !== 'skip') { applySongEdits(context, [{ type: 'add-entry', playlistId, songId: version.songId }], this.now()); changed++; }
        } else changed++;
      }
    }, signal);
    return { modelVersion: result.modelVersion, revision: result.revision, snapshot: result.document.snapshot, ...(playlistId ? { playlistId } : {}), summary: { changed, unchanged: entries.length - changed } };
  }
  favoriteChart(expected: string | null, context: ChartSongContext, signal: AbortSignal) {
    const key = catalogSongKey(context);
    const result = this.library.transaction(expected, transaction => {
      let songId = transaction.document.snapshot.catalogLinks.find(link => link.key === key)?.songId;
      if (!songId) {
        songId = randomUUID(); applySongEdits(transaction, [{ type: 'create-song', id: songId, title: context.title, artists: context.artists, artwork: context.artwork, source: 'catalog', context }], this.now());
      }
      applySongEdits(transaction, [{ type: 'favorite', songId }], this.now());
    }, signal);
    return { modelVersion: result.modelVersion, revision: result.revision, snapshot: result.document.snapshot };
  }
  async playback(selection: SongPlaybackSelection, signal: AbortSignal, searchMode?:unknown, audioSupport?:unknown) {
    const mode=validateSongSearchMode(searchMode),support=validateAudioSupport(audioSupport);
    if (!selection || typeof selection !== 'object') fail();
    if (selection.kind === 'song') object(selection, ['kind', 'songId', 'pinnedVersionId', 'explicitVersionId']);
    else if (selection.kind === 'source') object(selection, ['kind', 'ref', 'songId', 'context']);
    else if (selection.kind === 'chart') object(selection, ['kind', 'context']);
    else if (selection.kind === 'query') { object(selection, ['kind', 'query']); object(selection.query, ['title', 'artists']); text(selection.query.title); }
    else fail();
    const saved = this.library.read(), state = (mode === 'title-artists' ? desktopCatalogLibrary(saved) : saved).snapshot, chosen = chooseSongVersion(selection, state.songs, state.versions, state.catalogLinks), generation = this.access.generation();
    const catalog=mode==='title-artists'&&chosen.kind!=='source'&&chosen.songId?state.songs.find(song=>song.id===chosen.songId)?.desktopCatalog:undefined;
    const record=catalog?.state==='matched'?catalog.record:undefined;
    const durationSeconds=record&&chosen.kind!=='source'&&songKey(chosen.query)===songKey(record)?record.durationSeconds:undefined;
    const resolved = chosen.kind === 'source' ? undefined : await this.access.resolve({...chosen.query,...(mode==='title-artists'?{searchMode:mode,...(durationSeconds!==undefined?{durationSeconds}:{}),...(support?{audioSupport:support}:{})}:{})}, signal);
    let entry:VerifiedMusicEntry = await this.metadata(chosen.kind === 'source' ? chosen.ref : resolved!.ref, signal, generation);
    if(mode==='title-artists'&&resolved?.verifiedAudio&&sameVideoPart(entry.ref,resolved.verifiedAudio.ref))entry={...entry,verifiedAudio:resolved.verifiedAudio};
    this.check(signal, generation, entry.ref.provider);
    const latestSaved = this.library.read(), latest = (mode === 'title-artists' ? desktopCatalogLibrary(latestSaved) : latestSaved).snapshot;
    const song = chosen.songId ? latest.songs.find(song => song.id === chosen.songId) : undefined;
    if(chosen.songId&&!song)fail('not-found');
    return { entry, ...(song ? { song } : {}), ...(chosen.kind === 'source' && chosen.versionId ? { versionId: chosen.versionId } : {}) };
  }
}
