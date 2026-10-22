import type { EntryRef, MusicEntry, ProviderId } from '@studio/music-sources';

export interface CreatorRef { provider: ProviderId; id: string }
export interface CreatorProfile extends CreatorRef { name: string; url: string; artwork?: string }
export interface FollowedCreator extends CreatorProfile { followedAt: number }
export interface FollowState { revision: string; creators: FollowedCreator[] }
export interface CreatorCollection { id: string; kind: 'season'|'series'|'playlist'; title: string; url: string; artwork?: string; count?: number; ref?: EntryRef }
export interface CreatorCollections { items: CreatorCollection[]; cursor?: string }
export interface CreatorVideos { items: MusicEntry[]; cursor?: string; total?: number; page?: number; pageSize?: number }
export interface FollowFeed { items: MusicEntry[]; total: number; cursor?: string; snapshot?: string; page?: number; pageSize?: number; fetchedAt: number; warnings: { creator: CreatorRef; name: string; code: string }[] }
export const creatorKey = (creator: CreatorRef) => `${creator.provider}:${creator.id}`;
