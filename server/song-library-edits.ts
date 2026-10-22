import { randomUUID } from 'node:crypto';
import { SongLibraryError } from './song-library-errors.js';
import { object, list, text, decodeSongLibrarySnapshot, emptySongLibrary } from './song-library-codec.js';
import { catalogSongKey, songSourceKey } from './song-library-policy.js';
import { memberKey, type TransactionContext } from './song-library-store.js';
import type { SongMember, Song, SongVersion, VersionFacts, VersionAvailability } from './song-library-types.js';
import { removeSongMembers } from './song-library-relations.js';
import { validatePlaylistCover } from './playlist-cover.js';

const fail = (code: 'invalid-input' | 'not-found' | 'duplicate' = 'invalid-input'): never => { throw new SongLibraryError(code); };
function reorder<T>(items: T[], ids: unknown, key: (value: T) => string): T[] {
  list(ids); if (ids.length !== items.length || new Set(ids).size !== items.length) fail();
  const byId = new Map(items.map(item => [key(item), item]));
  return ids.map(id => { text(id, 200); return byId.get(id) ?? fail(); });
}
function removeMembers(context: TransactionContext, removed: SongMember[]) {
  removeSongMembers(context, removed);
}
/** HTTP-safe command boundary. The resulting aggregate is strictly decoded again before COMMIT. */
export function applySongEdits(context: TransactionContext, input: unknown, now = Date.now(), newId = randomUUID): void {
  list(input, 500); if (!input.length) fail();
  const s = context.document.snapshot;
  const song = (id: string) => s.songs.find(item => item.id === id) ?? fail('not-found');
  const playlist = (id: string) => s.playlists.find(item => item.id === id) ?? fail('not-found');
  const addOrigin = (member: SongMember) => { const origin = context.document.origins.find(o => memberKey(o.member) === memberKey(member)); if (origin) origin.local = 'present'; else context.document.origins.push({ member, local: 'present' }); };
  for (const e of input) {
    if (!e || typeof e !== 'object') fail();
    switch (e.type) {
      case 'create-song': {
        object(e, ['type', 'id', 'title', 'artists', 'artwork', 'contentKind', 'source', 'context']);
        const source = e.source ?? 'manual'; if (!['manual', 'catalog', 'parsed'].includes(source)) fail();
        const id = e.id ?? newId(); text(id, 200); if (s.songs.some(item => item.id === id) || s.redirects.some(r => r.from === id)) fail('duplicate');
        const value: Song = { id, title: e.title, ...(e.artists !== undefined ? { artists: structuredClone(e.artists) } : {}), ...(e.artwork !== undefined ? { artwork: e.artwork } : {}), contentKind: e.contentKind ?? 'unknown', fields: { title: { source, protected: source === 'manual' }, artists: { source: e.artists === undefined ? 'parsed' : source, protected: e.artists !== undefined && source === 'manual' } }, originals: [{ title: e.title, ...(e.artists !== undefined ? { artists: structuredClone(e.artists) } : {}) }], aliases: [], defaultVersionId: null, organization: source === 'parsed' ? 'pending' : 'organized', createdAt: now, updatedAt: now };
        if (e.artwork !== undefined) value.fields.artwork = { source, protected: source === 'manual' };
        s.songs.push(value);
        if (e.context !== undefined) {
          const key = catalogSongKey(e.context); if (s.catalogLinks.some(l => l.key === key)) fail('duplicate');
          s.catalogLinks.push({ id: newId(), key, songId: id, context: structuredClone(e.context) });
        }
        break;
      }
      case 'edit-song': {
        object(e, ['type', 'songId', 'title', 'artists', 'artwork', 'contentKind', 'organization']); const value = song(e.songId);
        if (e.title !== undefined) { if (value.title !== e.title && !value.aliases.includes(value.title)) value.aliases.push(value.title); value.title = e.title; value.fields.title = { source: 'manual', protected: true }; }
        if (e.artists !== undefined) { value.artists = structuredClone(e.artists); value.fields.artists = { source: 'manual', protected: true }; }
        if (e.artwork !== undefined) { if (e.artwork === null) delete value.artwork; else value.artwork = e.artwork; value.fields.artwork = { source: 'manual', protected: true }; }
        if (e.contentKind !== undefined) value.contentKind = e.contentKind;
        if (e.organization !== undefined) value.organization = e.organization;
        value.updatedAt = now; break;
      }
      case 'add-version': {
        object(e, ['type', 'version']); object(e.version, ['id', 'songId', 'ref', 'label', 'kind', 'performers', 'facts', 'availability']);
        const version = structuredClone(e.version) as SongVersion, value = song(version.songId), existing = s.versions.find(v => songSourceKey(v.ref) === songSourceKey(version.ref));
        decodeSongLibrarySnapshot({ ...emptySongLibrary(), songs: [{ ...value, defaultVersionId: null }], versions: [version] });
        if (existing) { if (existing.songId !== value.id) fail('duplicate'); break; }
        if (s.versions.some(v => v.id === version.id)) fail('duplicate');
        const first = !s.versions.some(v => v.songId === value.id);
        s.versions.push(version); if (first) value.defaultVersionId = version.id; value.updatedAt = now; break;
      }
      case 'edit-version': {
        object(e, ['type', 'versionId', 'label', 'kind', 'performers']); const value = s.versions.find(v => v.id === e.versionId) ?? fail('not-found');
        for (const key of ['label', 'kind', 'performers'] as const) if (e[key] !== undefined) (value as any)[key] = structuredClone(e[key]); break;
      }
      case 'set-default': {
        object(e, ['type', 'songId', 'versionId']); const value = song(e.songId);
        value.defaultVersionId = e.versionId; value.updatedAt = now; break;
      }
      case 'favorite': {
        object(e, ['type', 'songId']); song(e.songId);
        let value = s.favorites.find(f => f.songId === e.songId);
        if (!value) { value = { favoriteId: newId(), songId: e.songId, position: s.favorites.length, addedAt: now }; s.favorites.push(value); }
        addOrigin({ kind: 'favorite', favoriteId: value.favoriteId }); break;
      }
      case 'remove-favorite': {
        object(e, ['type', 'favoriteId']); if (!s.favorites.some(f => f.favoriteId === e.favoriteId)) fail('not-found');
        s.favorites = s.favorites.filter(f => f.favoriteId !== e.favoriteId); removeMembers(context, [{ kind: 'favorite', favoriteId: e.favoriteId }]); break;
      }
      case 'reorder-favorites': object(e, ['type', 'favoriteIds']); s.favorites = reorder(s.favorites, e.favoriteIds, f => f.favoriteId); break;
      case 'create-playlist': {
        object(e, ['type', 'id', 'name']); const id = e.id ?? newId(); if (s.playlists.some(p => p.id === id)) fail('duplicate');
        s.playlists.push({ id, name: e.name, entries: [], createdAt: now, updatedAt: now }); break;
      }
      case 'rename-playlist': object(e, ['type', 'playlistId', 'name']); playlist(e.playlistId).name = e.name; playlist(e.playlistId).updatedAt = now; break;
      case 'set-playlist-cover': {
        object(e, ['type', 'targetId', 'image']); text(e.targetId, 200);
        if (e.image === undefined) fail();
        if (e.image !== null) validatePlaylistCover(e.image);
        if (e.targetId === 'system:favorites') {
          if (e.image === null) delete s.desktopFavoritesCover; else s.desktopFavoritesCover = e.image;
        } else {
          const p = playlist(e.targetId);
          if (e.image === null) delete p.desktopCover; else p.desktopCover = e.image;
          p.updatedAt = now;
        }
        break;
      }
      case 'delete-playlist': {
        object(e, ['type', 'playlistId']); const p = playlist(e.playlistId);
        removeMembers(context, p.entries.map(entry => ({ kind: 'playlist-entry', playlistId: p.id, entryId: entry.entryId })));
        for (const link of context.document.syncLinks.filter(l => l.targetId === p.id)) { link.state = 'review'; link.issues = ['target-deleted']; context.events.push({ type: 'sync-review', linkId: link.id }); }
        s.playlists = s.playlists.filter(p => p.id !== e.playlistId); break;
      }
      case 'add-entry': {
        object(e, ['type', 'playlistId', 'entryId', 'songId', 'pinnedVersionId']); song(e.songId); const p = playlist(e.playlistId);
        const entryId = e.entryId ?? newId(); if (s.playlists.some(p => p.entries.some(entry => entry.entryId === entryId))) fail('duplicate');
        p.entries.push({ entryId, songId: e.songId, position: p.entries.length, addedAt: now, pinnedVersionId: e.pinnedVersionId ?? null });
        addOrigin({ kind: 'playlist-entry', playlistId: p.id, entryId }); p.updatedAt = now; break;
      }
      case 'remove-entry': {
        object(e, ['type', 'playlistId', 'entryId']); const p = playlist(e.playlistId); if (!p.entries.some(entry => entry.entryId === e.entryId)) fail('not-found');
        p.entries = p.entries.filter(entry => entry.entryId !== e.entryId); removeMembers(context, [{ kind: 'playlist-entry', playlistId: p.id, entryId: e.entryId }]); p.updatedAt = now; break;
      }
      case 'pin-entry': {
        object(e, ['type', 'playlistId', 'entryId', 'versionId']); const p = playlist(e.playlistId), entry = p.entries.find(entry => entry.entryId === e.entryId) ?? fail('not-found');
        entry.pinnedVersionId = e.versionId; p.updatedAt = now; break;
      }
      case 'reorder-entries': { object(e, ['type', 'playlistId', 'entryIds']); const p = playlist(e.playlistId); p.entries = reorder(p.entries, e.entryIds, entry => entry.entryId); p.updatedAt = now; break; }
      default: fail();
    }
  }
  s.favorites.forEach((f, i) => f.position = i); s.playlists.forEach(p => p.entries.forEach((e, i) => e.position = i));
}

/** Trusted automatic enrichment preserves each protected field and catalog precedence. */
export function updateAutomaticSong(context: TransactionContext, songId: string, patch: { title?: string; artists?: string[] }, source: 'catalog' | 'parsed', now = Date.now()) {
  object(patch, ['title', 'artists']); if (!['catalog', 'parsed'].includes(source)) fail();
  const song = context.document.snapshot.songs.find(s => s.id === songId) ?? fail('not-found');
  for (const field of ['title', 'artists'] as const) if (patch[field] !== undefined && !song.fields[field].protected && !(song.fields[field].source === 'catalog' && source === 'parsed')) {
    (song as any)[field] = structuredClone(patch[field]); song.fields[field] = { source, protected: false }; song.updatedAt = now;
  }
}
export function updateVersionFacts(context: TransactionContext, versionId: string, facts: VersionFacts, availability: VersionAvailability) {
  const version = context.document.snapshot.versions.find(v => v.id === versionId) ?? fail('not-found');
  version.facts = structuredClone(facts); version.availability = structuredClone(availability);
}
