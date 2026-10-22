import { useState } from 'react';
import { MusicNotesIcon } from '@phosphor-icons/react';
import type { Song } from '../server/song-library-types';
import { artworkUrl } from '../server/artwork-url';

export function SongCover({ song, className = '' }: { song?: Song; className?: string }) {
  const url = artworkUrl(song?.artwork), [failed, setFailed] = useState('');
  return url && failed !== url ? <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)}/> : <span className={'unknown-cover ' + className}><MusicNotesIcon size={26}/></span>;
}
