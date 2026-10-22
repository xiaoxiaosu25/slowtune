import { preferenceStorage } from './preference-storage';
import { defaultYoutubeRegion, isYoutubeRegion, type YoutubeRegion } from '../server/youtube-regions';

/** YouTube 音乐精选的候选读取：地区选择与请求地址由发现页 shelf 与设置页共用。 */
const regionStorageKey = 'slow-listening:youtube-music:region:v1';

export function readYoutubeRegion(): YoutubeRegion {
  try { const saved = preferenceStorage().getItem(regionStorageKey); if (isYoutubeRegion(saved)) return saved; } catch {}
  return defaultYoutubeRegion;
}

export function writeYoutubeRegion(region: YoutubeRegion) { preferenceStorage().setItem(regionStorageKey, region); }

export function youtubeMusicPath(region: YoutubeRegion, { refresh = false }: { refresh?: boolean } = {}) {
  return `/api/youtube/music?region=${region}&refresh=${refresh ? '1' : '0'}&shared=1`;
}
