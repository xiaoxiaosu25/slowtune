import { randomUUID } from 'node:crypto';
import type { MusicEntry } from '@studio/music-sources';
import { SongLibraryError } from './song-library-errors.js';
import { memberKey, type StoredSongLibrary, type TransactionContext } from './song-library-store.js';
import { adoptSongSource } from './song-library-sources.js';
import { applySongEdits } from './song-library-edits.js';
import { pruneUnretainedMembers } from './song-library-relations.js';
import type { SongMember, SongSyncMapping } from './song-library-types.js';
import type { SongSyncState } from './song-library-sync-types.js';

export function localSyncState(stored:StoredSongLibrary,accountId:string,busy:boolean):SongSyncState {
  const byLink=new Map<string,SongSyncMapping[]>();
  for(const mapping of stored.document.syncMappings){let rows=byLink.get(mapping.linkId);if(!rows){rows=[];byLink.set(mapping.linkId,rows);}rows.push(mapping);}
  const playlists=new Map(stored.document.snapshot.playlists.map(playlist=>[playlist.id,playlist]));
  return {accountId,revision:stored.revision,busy,links:stored.document.syncLinks.filter(link=>link.accountId===accountId).map(link=>{
    const mappings=byLink.get(link.id)??[],mapped=new Set(mappings.map(mapping=>memberKey(mapping.member)));
    const keys=link.targetId==='system:favorites'?stored.document.snapshot.favorites.map(item=>memberKey({kind:'favorite',favoriteId:item.favoriteId})):playlists.get(link.targetId)?.entries.map(item=>memberKey({kind:'playlist-entry',playlistId:link.targetId,entryId:item.entryId}))??[];
    return {...link,mappings,unmapped:keys.filter(key=>!mapped.has(key)).length};
  })};
}

type Base = { revision: string | null; linkId: string; accountId: string; now: number };
/** Trusted local reconciliation facts, with no credentials or remote operations. */
export type SyncLocalOperation = Base & ({ type: 'complete' } | {
  type: 'observe'; removed: string[]; entries: MusicEntry[]; videos: string[];
  unavailable: string[]; deferred: string[]; importCursor?: string;
});

export function applySyncLocal(context: TransactionContext, operation: SyncLocalOperation) {
  const link = context.document.syncLinks.find(link => link.id === operation.linkId && link.accountId === operation.accountId && link.state === 'ready');
  if (!link) throw new SongLibraryError('cancelled');
  if (operation.type === 'complete') { link.lastSync = operation.now; return; }
  const removed = new Set(operation.removed);
  context.document.syncMappings = context.document.syncMappings.filter(mapping => mapping.linkId !== link.id || !removed.has(mapping.bvid));
  pruneUnretainedMembers(context);
  for (const entry of operation.entries) {
    const version = adoptSongSource(context, entry, operation.now), snapshot = context.document.snapshot;
    const favorite = link.targetId === 'system:favorites' ? snapshot.favorites.find(item => item.songId === version.songId) : undefined;
    const playlist = link.targetId === 'system:favorites' ? undefined : snapshot.playlists.find(item => item.id === link.targetId);
    if (link.targetId !== 'system:favorites' && !playlist) throw new SongLibraryError('not-found');
    const target = playlist?.entries.find(item => item.songId === version.songId);
    let member: SongMember | undefined = favorite ? {kind:'favorite',favoriteId:favorite.favoriteId} : target ? {kind:'playlist-entry',playlistId:link.targetId,entryId:target.entryId} : undefined;
    if (!member) {
      if (link.targetId === 'system:favorites') {
        applySongEdits(context,[{type:'favorite',songId:version.songId}],operation.now);
        member={kind:'favorite',favoriteId:snapshot.favorites.find(item=>item.songId===version.songId)!.favoriteId};
      } else {
        const entryId=randomUUID();applySongEdits(context,[{type:'add-entry',playlistId:link.targetId,entryId,songId:version.songId,pinnedVersionId:version.id}],operation.now);
        member={kind:'playlist-entry',playlistId:link.targetId,entryId};
      }
      context.document.origins.find(origin=>memberKey(origin.member)===memberKey(member!))!.local='absent';
    }
    const mapping:SongSyncMapping={linkId:link.id,member,bvid:entry.ref.id,versionId:version.id};
    if(!context.document.syncMappings.some(item=>item.linkId===link.id&&item.bvid===mapping.bvid&&memberKey(item.member)===memberKey(member!)))context.document.syncMappings.push(mapping);
  }
  const unavailable=new Set(operation.unavailable),deferred=new Set(operation.deferred);
  link.observed=operation.videos.filter(id=>!unavailable.has(id)&&!deferred.has(id));
  link.issues=[...(unavailable.size?['content-unavailable']:[]),...(deferred.size?['pending-import']:[])];
  if(operation.importCursor)link.importCursor=operation.importCursor;
}
