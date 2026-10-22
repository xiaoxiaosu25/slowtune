import { SongLibraryError } from './song-library-errors.js';
import { object, list, text } from './song-library-codec.js';
import { updateVersionFacts } from './song-library-edits.js';
import { songSourceKey } from './song-library-policy.js';
import { songVersionFacts, type SongSourceAccess } from './song-library-sources.js';
import { memberKey, decodeSongDocument, type TransactionContext } from './song-library-store.js';
import { detachSongMappings, normalizeSongOrder, pruneUnretainedMembers, removeSongMembers } from './song-library-relations.js';
import type { SongLibraryDocument, SongMember, VersionFacts, VersionAvailability } from './song-library-types.js';
import type { SongLibraryService } from './song-library-service.js';

export type SongMaintenanceAction =
  | { type: 'merge-songs'; sourceId: string; targetId: string }
  | { type: 'move-version'; versionId: string; targetId: string }
  | { type: 'group-version'; versionId: string; targetId: string }
  | { type: 'delete-song'; songId: string }
  | { type: 'delete-version'; versionId: string }
  | { type: 'clean-unavailable'; versionIds: string[] };
export interface SongMaintenanceImpact {
  songs: number; versions: number; favorites: number; entries: number; defaults: number; pins: number;
  mappings: number; remoteRemovals: { linkId: string; bvid: string }[];
}
const fail = (code: 'invalid-input' | 'not-found' = 'invalid-input'): never => { throw new SongLibraryError(code); };
export function planSongMaintenance(document: SongLibraryDocument, input: unknown, now = Date.now()): TransactionContext & { impact: SongMaintenanceImpact } {
  if (!input || typeof input !== 'object') fail();
  const action = input as SongMaintenanceAction;
  object(action, action.type === 'merge-songs' ? ['type', 'sourceId', 'targetId'] : ['move-version','group-version'].includes(action.type) ? ['type', 'versionId', 'targetId'] : action.type === 'delete-song' ? ['type', 'songId'] : action.type === 'clean-unavailable' ? ['type', 'versionIds'] : ['type', 'versionId']);
  const context: TransactionContext = { document: structuredClone(document), events: [], acknowledge: [] }, s = context.document.snapshot;
  const getSong = (id: string) => { text(id, 200); return s.songs.find(song => song.id === id) ?? fail('not-found'); };
  const getVersion = (id: string) => { text(id, 200); return s.versions.find(version => version.id === id) ?? fail('not-found'); };
  if (action.type === 'group-version') {
    const version = getVersion(action.versionId), target = getSong(action.targetId);
    if (version.songId === target.id) fail();
    const onlyVersion = s.versions.filter(v => v.songId === version.songId).length === 1;
    const first = !s.versions.some(v => v.songId === target.id);
    const plan = planSongMaintenance(document, onlyVersion ? { type: 'merge-songs', sourceId: version.songId, targetId: target.id } : { type: 'move-version', versionId: version.id, targetId: target.id }, now);
    if (first) { const song = plan.document.snapshot.songs.find(song => song.id === target.id)!; song.defaultVersionId = version.id; song.updatedAt = now; }
    return { ...plan, document: decodeSongDocument(plan.document) };
  }
  if (action.type === 'merge-songs') {
    const source = getSong(action.sourceId), target = getSong(action.targetId); if (source.id === target.id) fail();
    // Target's effective fields, protection and default survive. Originals remain available for review.
    target.aliases = [...new Set([...target.aliases, source.title, ...source.aliases])].filter(title => title !== target.title);
    target.originals = [...target.originals, ...source.originals]; target.updatedAt = now;
    for (const version of s.versions) if (version.songId === source.id) version.songId = target.id;
    for (const playlist of s.playlists) for (const entry of playlist.entries) if (entry.songId === source.id) { entry.songId = target.id; playlist.updatedAt = now; }
    const left = s.favorites.find(f => f.songId === source.id), right = s.favorites.find(f => f.songId === target.id);
    if (left && right) {
      const earlier = Math.min(left.position, right.position), from: SongMember = { kind: 'favorite', favoriteId: left.favoriteId }, to: SongMember = { kind: 'favorite', favoriteId: right.favoriteId };
      right.addedAt = Math.min(left.addedAt, right.addedAt);
      const local = context.document.origins.filter(o => [memberKey(from), memberKey(to)].includes(memberKey(o.member))).some(o => o.local === 'present');
      context.document.origins = context.document.origins.filter(o => memberKey(o.member) !== memberKey(from));
      context.document.origins.find(o => memberKey(o.member) === memberKey(to))!.local = local ? 'present' : 'absent';
      for (const mapping of context.document.syncMappings) if (memberKey(mapping.member) === memberKey(from)) mapping.member = to;
      const seen = new Set<string>(); context.document.syncMappings = context.document.syncMappings.filter(mapping => { const key = JSON.stringify([mapping.linkId, memberKey(mapping.member), mapping.bvid]); if (seen.has(key)) return false; seen.add(key); return true; });
      s.favorites = s.favorites.filter(f => f !== left && f !== right); s.favorites.splice(earlier, 0, right);
    } else if (left) left.songId = target.id;
    for (const link of s.catalogLinks) if (link.songId === source.id) link.songId = target.id;
    for (const redirect of s.redirects) if (redirect.to === source.id) redirect.to = target.id;
    s.redirects.push({ from: source.id, to: target.id }); s.songs = s.songs.filter(song => song.id !== source.id);
  } else if (['move-version', 'delete-version', 'clean-unavailable'].includes(action.type)) {
    const ids = action.type === 'clean-unavailable' ? action.versionIds : [(action as { versionId: string }).versionId];
    list(ids, 500); if (!ids.length || new Set(ids).size !== ids.length) fail();
    const versions = ids.map(getVersion), selected = new Set(ids);
    if (action.type === 'clean-unavailable' && versions.some(v => v.availability.state !== 'unavailable' || v.availability.code !== 'not-found')) fail();
    const target = action.type === 'move-version' ? getSong(action.targetId) : undefined;
    if (target && versions.some(version => version.songId === target.id)) fail();
    for (const song of s.songs) if (song.defaultVersionId && selected.has(song.defaultVersionId)) { song.defaultVersionId = null; song.updatedAt = now; }
    for (const playlist of s.playlists) for (const entry of playlist.entries) if (entry.pinnedVersionId && selected.has(entry.pinnedVersionId)) { entry.pinnedVersionId = null; playlist.updatedAt = now; }
    detachSongMappings(context, mapping => selected.has(mapping.versionId));
    if (target) { versions.forEach(version => version.songId = target.id); target.updatedAt = now; }
    else s.versions = s.versions.filter(version => !selected.has(version.id));
    pruneUnretainedMembers(context);
  } else if (action.type === 'delete-song') {
    const song = getSong(action.songId), removed: SongMember[] = s.favorites.filter(f => f.songId === song.id).map(f => ({ kind: 'favorite', favoriteId: f.favoriteId }));
    for (const playlist of s.playlists) {
      removed.push(...playlist.entries.filter(e => e.songId === song.id).map(e => ({ kind: 'playlist-entry' as const, playlistId: playlist.id, entryId: e.entryId })));
      if (playlist.entries.some(e => e.songId === song.id)) playlist.updatedAt = now;
      playlist.entries = playlist.entries.filter(e => e.songId !== song.id);
    }
    removeSongMembers(context, removed);
    s.favorites = s.favorites.filter(f => f.songId !== song.id); s.versions = s.versions.filter(v => v.songId !== song.id); s.catalogLinks = s.catalogLinks.filter(l => l.songId !== song.id);
    const gone = new Set([song.id]); let changed = true; while (changed) { changed = false; for (const r of s.redirects) if (gone.has(r.to) && !gone.has(r.from)) { gone.add(r.from); changed = true; } }
    s.redirects = s.redirects.filter(r => !gone.has(r.from)); s.songs = s.songs.filter(s => s.id !== song.id);
  } else fail();
  normalizeSongOrder(context.document);
  const after = context.document.snapshot;
  const impact: SongMaintenanceImpact = {
    songs: document.snapshot.songs.length - after.songs.length, versions: document.snapshot.versions.filter(v => !after.versions.some(a => a.id === v.id && a.songId === v.songId)).length,
    favorites: document.snapshot.favorites.length - after.favorites.length, entries: document.snapshot.playlists.reduce((n, p) => n + p.entries.length, 0) - after.playlists.reduce((n, p) => n + p.entries.length, 0),
    defaults: document.snapshot.songs.filter(s => s.defaultVersionId && after.songs.find(a => a.id === s.id)?.defaultVersionId !== s.defaultVersionId).length,
    pins: document.snapshot.playlists.flatMap(p => p.entries).filter(e => e.pinnedVersionId && !after.playlists.some(p => p.entries.some(a => a.entryId === e.entryId && a.pinnedVersionId === e.pinnedVersionId))).length,
    mappings: document.syncMappings.length - context.document.syncMappings.length,
    remoteRemovals: context.events.filter(e => e.type === 'sync-intent' && e.action === 'remove').map(e => ({ linkId: e.linkId!, bvid: e.bvid! })),
  };
  return { ...context, document: decodeSongDocument(context.document), impact };
}

export class SongLibraryMaintenance {
  constructor(private library: SongLibraryService, private access: SongSourceAccess, private now = Date.now) {}
  async check(expected: string | null, ids: unknown, signal: AbortSignal) {
    list(ids, 20); if (!ids.length || new Set(ids).size !== ids.length) fail(); ids.forEach(id => text(id, 200));
    const state = this.library.read(); if (state.revision !== expected) throw new SongLibraryError('conflict', state.revision);
    const generation = this.access.generation(), results: { id: string; facts: VersionFacts; availability: VersionAvailability }[] = [], summary = { checked: 0, unavailable: 0, uncertain: 0, skipped: 0 };
    const check = () => { if (signal.aborted || generation !== this.access.generation()) throw new SongLibraryError('cancelled'); };
    let stoppedReason: string | undefined;
    for (const id of ids) {
      check(); const version = state.snapshot.versions.find(v => v.id === id) ?? fail('not-found');
      if (!this.access.enabled(version.ref.provider)) { summary.skipped++; continue; }
      try {
        const entry = await this.access.metadata(version.ref, signal); check();
        if (songSourceKey(entry.ref as any) !== songSourceKey(version.ref)) fail();
        results.push({ id, facts: songVersionFacts(entry), availability: { state: 'available' as const, checkedAt: this.now() } }); summary.checked++;
      } catch (error) {
        check(); const code = (error as { code?: string }).code ?? 'upstream'; if (code === 'cancelled') throw error;
        const missing = code === 'not-found'; results.push({ id, facts: version.facts, availability: { state: missing ? 'unavailable' as const : 'uncertain' as const, code, checkedAt: this.now() } });
        summary.checked++; if (missing) summary.unavailable++; else { summary.uncertain++; stoppedReason = code; break; }
      }
    }
    const saved = this.library.transaction(expected, context => { check(); for (const result of results) updateVersionFacts(context, result.id, result.facts, result.availability); }, signal);
    return { modelVersion: 1 as const, revision: saved.revision, snapshot: saved.document.snapshot, summary: { ...summary, ...(stoppedReason ? { stoppedReason } : {}) } };
  }
}
