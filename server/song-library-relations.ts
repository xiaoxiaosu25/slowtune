import { memberKey, type TransactionContext } from './song-library-store.js';
import type { SongLibraryDocument, SongMember, SongSyncMapping } from './song-library-types.js';

export function normalizeSongOrder(document: SongLibraryDocument) {
  document.snapshot.favorites.forEach((entry, position) => entry.position = position);
  document.snapshot.playlists.forEach(playlist => playlist.entries.forEach((entry, position) => entry.position = position));
}
export function syncProjection(document: SongLibraryDocument, linkId: string) {
  return new Set(document.syncMappings.filter(mapping => mapping.linkId === linkId).map(mapping => mapping.bvid));
}
export function detachSongMappings(context: TransactionContext, predicate: (mapping: SongSyncMapping) => boolean) {
  const removed = context.document.syncMappings.filter(predicate);
  context.document.syncMappings = context.document.syncMappings.filter(mapping => !predicate(mapping));
  for (const mapping of removed) if (context.document.syncLinks.some(link => link.id === mapping.linkId && (link.state === 'ready' || link.issues.length === 1 && link.issues[0] === 'paused')) && !syncProjection(context.document, mapping.linkId).has(mapping.bvid)) {
    if (!context.events.some(event => event.linkId === mapping.linkId && event.bvid === mapping.bvid)) context.events.push({ type: 'sync-intent', linkId: mapping.linkId, bvid: mapping.bvid, action: 'remove' });
  }
}
export function removeSongMembers(context: TransactionContext, removed: SongMember[]) {
  const keys = new Set(removed.map(memberKey));
  detachSongMappings(context, mapping => keys.has(memberKey(mapping.member)));
  context.document.origins = context.document.origins.filter(origin => !keys.has(memberKey(origin.member)));
}
/** Remote deletion only removes this link's contribution, never independent local retention. */
export function pruneUnretainedMembers(context: TransactionContext, now = Date.now()) {
  const retained = new Set(context.document.syncMappings.map(mapping => memberKey(mapping.member)));
  const removed = new Set(context.document.origins.filter(origin => origin.local === 'absent' && !retained.has(memberKey(origin.member))).map(origin => memberKey(origin.member)));
  const snapshot = context.document.snapshot;
  snapshot.favorites = snapshot.favorites.filter(entry => !removed.has(memberKey({ kind: 'favorite', favoriteId: entry.favoriteId })));
  for (const playlist of snapshot.playlists) {
    const entries = playlist.entries.filter(entry => !removed.has(memberKey({ kind: 'playlist-entry', playlistId: playlist.id, entryId: entry.entryId })));
    if (entries.length !== playlist.entries.length) playlist.updatedAt = now;
    playlist.entries = entries;
  }
  context.document.origins = context.document.origins.filter(origin => !removed.has(memberKey(origin.member)));
  normalizeSongOrder(context.document);
}
