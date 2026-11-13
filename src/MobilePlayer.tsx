import { Button } from './ui/Button';
import { useState, type ReactNode } from 'react';
import { MusicNotesIcon, QueueIcon, VinylRecordIcon } from '@phosphor-icons/react';
import { preferenceStorage } from './preference-storage';

const lyricViewKey = 'slow-listening:mobile-lyric-view:v1';
function savedLyricView() {
  try { return preferenceStorage().getItem(lyricViewKey) === 'true' || (preferenceStorage().getItem(lyricViewKey) === null && preferenceStorage().getItem('slow-listening:playing-visual:v1') === 'lyrics'); }
  catch { return false; }
}

export function MobilePlayer({ artwork, lyrics, title, artist, source, quality, progress, transport, mode, favorite, timer, queueOpen, queueCount, onQueue, onLyricsSettings, onLyricsOffset, empty }: {
  artwork: ReactNode; lyrics: ReactNode; title: ReactNode; artist: ReactNode; source: ReactNode; quality?:ReactNode; progress: ReactNode; transport: ReactNode; mode: ReactNode; favorite: ReactNode; timer: ReactNode; queueOpen: boolean; queueCount: number; onQueue: () => void; onLyricsSettings: () => void; onLyricsOffset?: () => void; empty?: ReactNode;
}) {
  const [lyricView, setLyricView] = useState(savedLyricView);
  const toggleLyrics = () => {
    const next = !lyricView; setLyricView(next);
    try { preferenceStorage().setItem(lyricViewKey, String(next)); } catch { /* Keep the current view usable when storage is unavailable. */ }
  };
  const song = <div className="mobile-player-song"><div className="playing-title">{title}</div><div className="mobile-player-artist" title={typeof artist === 'string' ? artist : undefined}>{artist}</div>{source && <div className="mobile-player-source">{source}</div>}{!lyricView&&quality}</div>;
  return <section className={'mobile-player' + (lyricView ? ' is-lyrics' : '')} aria-label="正在播放">
    {lyricView && song}
    <div className="mobile-player-visual">{lyricView ? <div className="mobile-player-lyrics"><div className="mobile-lyrics-tools"><Button variant="ghost"  onClick={onLyricsSettings}>更换歌词</Button>{onLyricsOffset&&<Button variant="ghost"  onClick={onLyricsOffset}>校准时间</Button>}</div>{lyrics}</div> : artwork}</div>
    {!lyricView && song}
    <div className="mobile-player-controls playing-detail">
      {progress}
      <div className="playbar-controls listening-transport mobile-player-transport">{mode}{transport}{favorite || <span className="transport-balance" aria-hidden="true"/>}</div>
      <div className="mobile-player-tools">
        <Button variant="ghost" className={' ' + (lyricView ? ' saved' : '')} aria-label={lyricView ? '返回唱片' : '查看歌词'} aria-pressed={lyricView} onClick={toggleLyrics}>{lyricView ? <VinylRecordIcon size={21}/> : <MusicNotesIcon size={21}/>}<span>{lyricView ? '唱片' : '歌词'}</span></Button>
        {timer}
        <Button variant="ghost"  aria-label="播放队列" aria-expanded={queueOpen} onClick={onQueue}><QueueIcon size={22}/><span>队列</span><small>{queueCount}</small></Button>
      </div>
      {empty}
    </div>
  </section>;
}
