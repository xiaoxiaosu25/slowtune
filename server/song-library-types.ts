import type { ChartKind, ChartSource } from './chart-types.js';
import type { EntryRef } from '@studio/music-sources';

export const maxSongLibrarySnapshotBytes = 64 * 1024 * 1024;
export type SongDuplicatePolicy = 'allow' | 'skip' | 'reject';

/** Product contracts. Runtime activation is separate from storage implementation. */
export type SongVideoRef = EntryRef & { kind: 'video' };
export interface ChartSongContext {
  source: ChartSource;
  title: string;
  artists?: string[];
  upstreamSongId?: string;
  chart?: ChartKind;
  periodId?: number;
  rank?: number;
  sourceUrl?: string;
  artwork?: string;
}
export interface SongFieldState {
  source: 'manual' | 'catalog' | 'parsed';
  protected: boolean;
}
/** Desktop catalogue presentation; source facts and legacy/mobile presentation stay intact. */
export interface SongCatalogRecord {
  provider: 'netease';
  id: string;
  title: string;
  artists: string[];
  album?: string;
  artwork?: string;
  durationSeconds?: number;
  url: string;
}
export interface DesktopSongCatalog {
  state: 'matched' | 'review' | 'not-found' | 'error' | 'disabled';
  checkedAt: number;
  selection?: 'automatic' | 'manual';
  record?: SongCatalogRecord;
  issue?: string;
}
export interface Song {
  id: string;
  title: string;
  artists?: string[];
  artwork?: string;
  contentKind: 'single' | 'medley' | 'collection' | 'unknown';
  fields: { title: SongFieldState; artists: SongFieldState; artwork?: SongFieldState };
  desktopCatalog?: DesktopSongCatalog;
  originals: { title: string; artists?: string[]; ref?: SongVideoRef }[];
  aliases: string[];
  defaultVersionId: string | null;
  organization: 'organized' | 'pending';
  createdAt: number;
  updatedAt: number;
}
export type VersionAvailability =
  | { state: 'unknown' }
  | { state: 'available'; checkedAt: number }
  | { state: 'unavailable' | 'uncertain'; checkedAt: number; code: string };
export interface VersionFacts {
  title: string;
  artists?: string[];
  uploader?: string;
  uploaderId?: string;
  artwork?: string;
  durationSeconds?: number;
  url?: string;
}
export interface SongVersion {
  id: string;
  songId: string;
  ref: SongVideoRef;
  label: string;
  kind: 'studio' | 'mv' | 'live' | 'cover' | 'remix' | 'other';
  performers?: string[];
  facts: VersionFacts;
  availability: VersionAvailability;
}
export interface SongFavorite {
  favoriteId: string;
  songId: string;
  position: number;
  addedAt: number;
}
export interface SongPlaylistEntry {
  entryId: string;
  songId: string;
  position: number;
  addedAt: number;
  pinnedVersionId: string | null;
}
export interface SongPlaylist {
  id: string;
  name: string;
  /** Independent square JPEG; desktop presentation only, portable with backups. */
  desktopCover?: string;
  entries: SongPlaylistEntry[];
  createdAt: number;
  updatedAt: number;
}
export type SongMember =
  | { kind: 'favorite'; favoriteId: string }
  | { kind: 'playlist-entry'; playlistId: string; entryId: string };
export interface SongMemberOrigin {
  member: SongMember;
  local: 'present' | 'absent';
}
export interface SongSyncMapping {
  linkId: string;
  member: SongMember;
  bvid: string;
  versionId: string;
}
export interface SongCatalogLink {
  id: string;
  key: string;
  songId: string;
  context: ChartSongContext;
}
/** Portable backup: account-specific sync authority is deliberately outside this format. */
export interface SongLibrarySnapshot {
  format: 'slowtune-library';
  version: 1;
  songs: Song[];
  versions: SongVersion[];
  favorites: SongFavorite[];
  desktopFavoritesCover?: string;
  playlists: SongPlaylist[];
  catalogLinks: SongCatalogLink[];
  redirects: { from: string; to: string }[];
}
export type SongPlaybackSelection =
  | { kind: 'song'; songId: string; pinnedVersionId?: string; explicitVersionId?: string }
  | { kind: 'source'; ref: SongVideoRef; songId?: string; context?: ChartSongContext }
  | { kind: 'chart'; context: ChartSongContext }
  | { kind: 'query'; query: { title: string; artists?: string[] } };

export interface SongSavedPlayback {
  version: 3;
  items: { instanceId: string; selection: SongPlaybackSelection; title: string; artists?: string[]; partsGroupId?: string }[];
  current?: string;
  order: 'sequential' | 'shuffle';
  repeat: 'off' | 'one' | 'all';
  volume: number;
  rate: number;
  muted: boolean;
}

export interface SongLibraryState {
  modelVersion: 1;
  revision: string | null;
  snapshot: SongLibrarySnapshot;
}

export interface SongSyncLink {
  id: string;
  accountId: string;
  folderId: string;
  targetId: string;
  state: 'review' | 'ready';
  issues: string[];
  title?: string;
  observed?: string[];
  lastSync?: number;
  importCursor?: string;
  creation?: { title: string; private: boolean; beforeIds: string[] };
}
export interface SongLibraryDocument {
  snapshot: SongLibrarySnapshot;
  origins: SongMemberOrigin[];
  syncMappings: SongSyncMapping[];
  syncLinks: SongSyncLink[];
}
export interface SongLibraryEvent {
  id: string;
  revision: string;
  type: 'library-changed' | 'sync-review' | 'sync-intent';
  linkId?: string;
  bvid?: string;
  action?: 'add' | 'remove';
  createdAt: number;
}
