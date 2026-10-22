import type { SongLibraryState, SongMember, SongSyncLink, SongSyncMapping } from './song-library-types.js';
export interface BilibiliFolder { id: string; title: string; count: number; private: boolean }
export interface SongSyncState {
  accountId: string;
  revision: string | null;
  links: (SongSyncLink & { mappings: SongSyncMapping[]; unmapped: number })[];
  busy: boolean;
  folders?: BilibiliFolder[];
}
export interface SongSyncPreview {
  token: string; revision: string | null; expiresAt: number; accountId: string; folder: BilibiliFolder; targetId: string;
  assignments: { member: SongMember; versionId: string; title: string; version: string; bvid: string }[];
  remoteCount: number; remoteAdditions: string[]; remoteRemovals: string[]; unmapped: number;
}
export type SongSyncResult = { library: SongLibraryState; sync: SongSyncState };
