import type { Shelf } from '@studio/music-sources';

export const youtubeRegions = [
  { id: 'HK', name: '香港' },
  { id: 'TW', name: '台湾' },
  { id: 'SG', name: '新加坡' },
  { id: 'MY', name: '马来西亚' },
  { id: 'US', name: '美国' },
  { id: 'GB', name: '英国' },
  { id: 'AU', name: '澳大利亚' },
  { id: 'JP', name: '日本' },
  { id: 'KR', name: '韩国' },
  { id: 'IN', name: '印度' },
] as const;
export type YoutubeRegion = typeof youtubeRegions[number]['id'];
export const defaultYoutubeRegion: YoutubeRegion = 'HK';
export const youtubeMusicChannel = 'UC-9-kyTW8ZkZNDHQJ6FgpwQ';
export const youtubeMusicUrl = `https://www.youtube.com/channel/${youtubeMusicChannel}`;
export const chineseMusicRegions = new Set<string>(['HK', 'TW', 'SG', 'MY']);
export function isYoutubeRegion(value: unknown): value is YoutubeRegion {
  return youtubeRegions.some(region => region.id === value);
}
export interface YoutubeMusicResult {
  region: YoutubeRegion;
  shelf: Shelf;
  sourceUrl: string;
  fetchedAt: number;
  catalogueUpdatedAt: number;
  playlists: { id: string; title: string; url: string }[];
  warnings: { title: string; code: string }[];
}
