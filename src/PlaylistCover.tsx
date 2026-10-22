import { useState } from 'react';
import type { Song } from '../server/song-library-types';
import { SongCover } from './SongCover';

export function PlaylistCover({ image, song, className = '' }: { image?: string; song?: Song; className?: string }) {
  const [failed, setFailed] = useState('');
  return image && failed !== image ? <img className={className} src={image} alt="" onError={() => setFailed(image)}/> : <SongCover song={song} className={className}/>;
}
