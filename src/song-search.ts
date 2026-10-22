import type { SongSearchMode } from '../server/search-policy';

// Mobile keeps its current title-only resolver until development resumes.
export function desktopSurface(){return typeof window!=='undefined'&&!!window.matchMedia?.('(min-width:761px)').matches;}
export function desktopSongSearchOptions(audioSupport?:string[]):{searchMode?:SongSearchMode;audioSupport?:string[]} {
  return desktopSurface()
    ?{searchMode:'title-artists',...(audioSupport?{audioSupport}:{})}:{};
}
