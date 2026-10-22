import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { decodeSongLibrarySnapshot } from './song-library-codec.js';
import { memberKey, members } from './song-library-store.js';
import { songSourceKey } from './song-library-policy.js';
import type { SongLibraryDocument, SongLibrarySnapshot, SongMember } from './song-library-types.js';

export const decodeSongBackup = decodeSongLibrarySnapshot;
export interface ImportImpact {
  conflicts: { kind: string; id: string }[];
  before: ReturnType<typeof backupCounts>;
  after: ReturnType<typeof backupCounts>;
  reusedFavorites: number;
  reviewLinks: string[];
  removedMembers: number;
}
export const backupCounts = (s: SongLibrarySnapshot) => ({ songs: s.songs.length, versions: s.versions.length, favorites: s.favorites.length, playlists: s.playlists.length, entries: s.playlists.reduce((n, p) => n + p.entries.length, 0) });
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal((a as any)[k], (b as any)[k]));
};
/** Conservative append: identity/data conflicts are visible and block the whole commit. */
export function planSongImport(current: SongLibraryDocument, incoming: SongLibrarySnapshot, mode: 'append' | 'replace') {
  if (!['append', 'replace'].includes(mode)) throw new LibraryError('invalid-input');
  const document = structuredClone(current), before = members(current), importedMembers: SongMember[] = [];
  const impact: ImportImpact = { conflicts: [], before: backupCounts(current.snapshot), after: backupCounts(incoming), reusedFavorites: 0, reviewLinks: [], removedMembers: mode === 'replace' ? before.size : 0 };
  const conflict = (kind: string, id: string) => impact.conflicts.push({ kind, id });
  if (mode === 'replace') { document.snapshot = structuredClone(incoming); document.origins = []; document.syncMappings = []; }
  else {
    const target = document.snapshot;
    const merge = <T>(kind: string, existing: T[], added: T[], key: (item: T) => string) => {
      const known = new Map(existing.map(item => [key(item), item]));
      for (const item of added) {
        const id = key(item), previous = known.get(id);
        if (previous) { if (!equal(previous, item)) conflict(kind, id); }
        else { const copy = structuredClone(item); existing.push(copy); known.set(id, copy); }
      }
    };
    merge('song', target.songs, incoming.songs, s => s.id);
    merge('version', target.versions, incoming.versions, v => v.id);
    if (incoming.desktopFavoritesCover !== undefined) {
      if (target.desktopFavoritesCover !== undefined && target.desktopFavoritesCover !== incoming.desktopFavoritesCover) conflict('favorites-cover', 'system:favorites');
      else target.desktopFavoritesCover = incoming.desktopFavoritesCover;
    }
    const refs = new Map<string, string>();
    for (const v of target.versions) { const key = songSourceKey(v.ref); if (refs.has(key) && refs.get(key) !== v.id) conflict('source-owner', v.id); refs.set(key, v.id); }
    const favorites = new Map(target.favorites.map(f => [f.songId, f])), favoriteIds = new Map(target.favorites.map(f => [f.favoriteId, f.songId]));
    for (const f of incoming.favorites) {
      const prior = favorites.get(f.songId);
      if (favoriteIds.has(f.favoriteId) && favoriteIds.get(f.favoriteId) !== f.songId) conflict('favorite-id', f.favoriteId);
      if (prior) { impact.reusedFavorites++; importedMembers.push({ kind: 'favorite', favoriteId: prior.favoriteId }); }
      else { const copy = { ...f, position: target.favorites.length }; target.favorites.push(copy); favorites.set(f.songId, copy); favoriteIds.set(f.favoriteId, f.songId); importedMembers.push({ kind: 'favorite', favoriteId: f.favoriteId }); }
    }
    const entries = new Map(target.playlists.flatMap(p => p.entries.map(e => [e.entryId, p.id])));
    for (const p of incoming.playlists) {
      let prior = target.playlists.find(item => item.id === p.id);
      if (!prior) { prior = { ...structuredClone(p), entries: [] }; target.playlists.push(prior); }
      else if (prior.name !== p.name) conflict('playlist-name', p.id);
      if (p.desktopCover !== undefined) {
        if (prior.desktopCover !== undefined && prior.desktopCover !== p.desktopCover) conflict('playlist-cover', p.id);
        else prior.desktopCover = p.desktopCover;
      }
      const priorEntries = new Map(prior.entries.map(entry => [entry.entryId, entry]));
      for (const e of p.entries) {
        const previous = priorEntries.get(e.entryId);
        if (entries.has(e.entryId) && entries.get(e.entryId) !== p.id) conflict('entry-id', e.entryId);
        else if (previous) { if (!equal({ ...previous, position: 0 }, { ...e, position: 0 })) conflict('entry-data', e.entryId); }
        else { const added = { ...e, position: prior.entries.length }; prior.entries.push(added); priorEntries.set(e.entryId, added); entries.set(e.entryId, p.id); }
        importedMembers.push({ kind: 'playlist-entry', playlistId: p.id, entryId: e.entryId });
      }
    }
    merge('catalog-id', target.catalogLinks, incoming.catalogLinks, l => l.id);
    merge('redirect', target.redirects, incoming.redirects, r => r.from);
    if (!impact.conflicts.length) {
      try { decodeSongLibrarySnapshot(target); } catch { conflict('relationship', 'snapshot'); }
    }
  }
  if (impact.conflicts.length) { impact.after = impact.before; return { document: current, impact }; }
  const imported = new Set(mode === 'replace' ? members(document).keys() : importedMembers.map(memberKey));
  const originMap = new Map(document.origins.map(origin => [memberKey(origin.member), origin]));
  const allMembers: SongMember[] = [...document.snapshot.favorites.map(f => ({ kind: 'favorite' as const, favoriteId: f.favoriteId })), ...document.snapshot.playlists.flatMap(p => p.entries.map(e => ({ kind: 'playlist-entry' as const, playlistId: p.id, entryId: e.entryId })))];
  for (const member of allMembers) if (imported.has(memberKey(member))) originMap.set(memberKey(member), { member, local: 'present' });
  document.origins = [...originMap.values()];
  const affectedTargets = new Set(allMembers.filter(member => imported.has(memberKey(member))).map(member => member.kind === 'favorite' ? 'system:favorites' : member.playlistId));
  for (const link of document.syncLinks) {
    const affected = mode === 'replace' || affectedTargets.has(link.targetId);
    if (affected) { link.state = 'review'; link.issues = [...new Set([...link.issues, 'backup-import'])]; impact.reviewLinks.push(link.id); }
  }
  impact.after = backupCounts(document.snapshot);
  const afterMembers = members(document);
  impact.removedMembers = mode === 'replace' ? [...before.keys()].filter(key => !afterMembers.has(key)).length : 0;
  return { document, impact };
}
