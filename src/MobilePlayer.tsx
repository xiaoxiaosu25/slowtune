import { useState, type ReactNode } from 'react';
import { MusicNotesIcon, QueueIcon, VinylRecordIcon } from '@phosphor-icons/react';
import { preferenceStorage } from './preference-storage';

const lyricViewKey = 'slow-listening:mobile-lyric-view:v1';
function savedLyricView() {
  try { return preferenceStorage().getItem(lyricViewKey) === 'true' || (preferenceStorage().getItem(lyricViewKey) === null && preferenceStorage().getItem('slow-listening:playing-visual:v1') === 'lyrics'); }
  catch { return false; }
}

export function MobilePlayer({ artwork, lyrics, title, artist, source, progress, transport, mode, favorite, timer, queueOpen, queueCount, onQueue, empty }: {
  artwork: ReactNode; lyrics: ReactNode; title: ReactNode; artist: ReactNode; source: ReactNode; progress: ReactNode; transport: ReactNode; mode: ReactNode; favorite: ReactNode; timer: ReactNode; queueOpen: boolean; queueCount: number; onQueue: () => void; empty?: ReactNode;
}) {
  const [lyricView, setLyricView] = useState(savedLyricView);
  const toggleLyrics = () => {
    const next = !lyricView; setLyricView(next);
    try { preferenceStorage().setItem(lyricViewKey, String(next)); } catch { /* Keep the current view usable when storage is unavailable. */ }
  };
  const song = <div className="mobile-player-song"><div className="playing-title">{title}</div><div className="mobile-player-artist">{artist}</div><div className="mobile-player-source">{source}</div></div>;
  return <section className={'mobile-player' + (lyricView ? ' is-lyrics' : '')} aria-label="正在播放">
    {lyricView && song}
    <div className="mobile-player-visual">{lyricView ? lyrics : artwork}</div>
    {!lyricView && song}
    <div className="mobile-player-controls playing-detail">
      {progress}
      <div className="playbar-controls listening-transport mobile-player-transport">{mode}{transport}{favorite || <span className="transport-balance" aria-hidden="true"/>}</div>
      <div className="mobile-player-tools">
        <button className={'btn btn-ghost' + (lyricView ? ' saved' : '')} aria-label={lyricView ? '返回唱片' : '查看歌词'} aria-pressed={lyricView} onClick={toggleLyrics}>{lyricView ? <VinylRecordIcon size={21}/> : <MusicNotesIcon size={21}/>}<span>{lyricView ? '唱片' : '歌词'}</span></button>
        {timer}
        <button className="btn btn-ghost" aria-label="播放队列" aria-expanded={queueOpen} onClick={onQueue}><QueueIcon size={22}/><span>队列</span><small>{queueCount}</small></button>
      </div>
      {empty}
    </div>
  </section>;
}
