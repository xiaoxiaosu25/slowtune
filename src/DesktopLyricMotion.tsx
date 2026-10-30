import type { LyricsController, LyricMotion } from './useLyrics';

export function DesktopLyricMotion({lyrics}:{lyrics:LyricsController}) {
  return <label className="desktop-lyric-motion"><span>歌词动效</span><select className="select" aria-label="歌词动效" value={lyrics.motion} onChange={event=>lyrics.updateDisplay({motion:event.target.value as LyricMotion})}><option value="system">跟随系统</option><option value="full">完整动效</option><option value="reduced">减少动态</option></select><small>减少动态时保留同步高亮，停止缩放与平滑滚动。</small></label>;
}
