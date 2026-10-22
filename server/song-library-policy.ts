import { validateRef } from '@studio/music-sources';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { ChartSongContext, Song, SongCatalogLink, SongPlaybackSelection, SongVersion, SongVideoRef } from './song-library-types.js';

/** Identity uses conservative typography normalization; search's fuzzy key remains separate. */
export const normalizeCatalogText = (text: string) => text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
export function catalogSongKey(context: ChartSongContext): string {
  if (!context || typeof context !== 'object' || !['netease', 'qq', 'bilibili', 'apple'].includes(context.source) || typeof context.title !== 'string' || !context.title.trim() || context.artists !== undefined && (!Array.isArray(context.artists) || context.artists.some(artist => typeof artist !== 'string' || !artist.trim()))) throw new LibraryError('invalid-input');
  if (context.upstreamSongId !== undefined) {
    if (typeof context.upstreamSongId !== 'string' || !context.upstreamSongId.trim()) throw new LibraryError('invalid-input');
    return JSON.stringify(['catalog-id', context.source, context.upstreamSongId]);
  }
  const artists = [...new Set((context.artists ?? []).map(normalizeCatalogText).filter(Boolean))].sort();
  return JSON.stringify(['catalog-query', context.source, normalizeCatalogText(context.title), artists]);
}
export function songSourceKey(ref: SongVideoRef): string {
  try { validateRef(ref); } catch { throw new LibraryError('invalid-input'); }
  if (ref.kind !== 'video' || !['bilibili', 'youtube'].includes(ref.provider) || ref.provider === 'youtube' && (ref.part !== undefined || !/^[\w-]{11}$/.test(ref.id)) || ref.provider === 'bilibili' && (!/^BV[\da-zA-Z]{10}$/.test(ref.id) || typeof ref.part !== 'string' || !/^[1-9]\d{0,19}$/.test(ref.part))) throw new LibraryError('invalid-input');
  return JSON.stringify([ref.provider, ref.id, ref.part ?? null]);
}
/** A lazy queue selection may name a B站 video before its first cid is resolved. Stored versions remain exact. */
export function validateSongSourceSelection(ref: SongVideoRef): void {
  try { validateRef(ref); } catch { throw new LibraryError('invalid-input'); }
  if (ref.provider === 'bilibili' && ref.kind === 'video' && /^BV[\da-zA-Z]{10}$/.test(ref.id) && ref.part === undefined) return;
  songSourceKey(ref);
}
/** A selected but unavailable version is still returned. I/O reports its real failure, without fallback. */
export function chooseSongVersion(selection: SongPlaybackSelection, songs: readonly Song[], versions: readonly SongVersion[], catalogLinks: readonly SongCatalogLink[] = []):
  { kind: 'source'; ref: SongVideoRef; versionId?: string; songId?: string } | { kind: 'search'; songId?: string; query: { title: string; artists?: string[] } } {
  if (selection.kind === 'source') {
    validateSongSourceSelection(selection.ref);
    const songId = selection.songId ?? (selection.context ? catalogLinks.find(link => link.key === catalogSongKey(selection.context!))?.songId : undefined);
    return { kind: 'source', ref: selection.ref, ...(songId ? { songId } : {}) };
  }
  if (selection.kind === 'query') return { kind: 'search', query: selection.query };
  if (selection.kind === 'chart') {
    const link = catalogLinks.find(link => link.key === catalogSongKey(selection.context));
    if (link) return chooseSongVersion({ kind: 'song', songId: link.songId }, songs, versions);
    return { kind: 'search', query: { title: selection.context.title, artists: selection.context.artists } };
  }
  const song = songs.find(item => item.id === selection.songId);
  if (!song) throw new LibraryError('not-found');
  const versionId = selection.explicitVersionId ?? selection.pinnedVersionId ?? song.defaultVersionId;
  if (versionId === null || versionId === undefined) return { kind: 'search', songId: song.id, query: { title: song.title, artists: song.artists } };
  const version = versions.find(item => item.id === versionId && item.songId === song.id);
  if (!version) throw new LibraryError('invalid-input');
  return { kind: 'source', ref: version.ref, versionId: version.id, songId: song.id };
}
