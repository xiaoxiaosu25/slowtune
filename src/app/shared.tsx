import { createContext, useContext, useState } from 'react';
import { motion } from 'motion/react';
import { CompassIcon, ListBulletsIcon, MusicNotesIcon, TelevisionSimpleIcon, UsersIcon, YoutubeLogoIcon } from '@phosphor-icons/react';
import type { Track } from '../api';
import { artworkUrl } from '../../server/artwork-url';
import { isTrack, type QueueTrack } from '../chart-playback';
import { listeningArtworkId, listeningArtworkSpring } from './components/listening-motion';

export const names = { all: '全部', bilibili: 'B站', youtube: 'YouTube 视频' };

export const nav = [
  { id: 'discover', label: '发现', icon: CompassIcon },
  { id: 'charts', label: '音乐榜单', icon: MusicNotesIcon },
  { id: 'follows', label: '关注', icon: UsersIcon },
  { id: 'library', label: '歌单', icon: ListBulletsIcon },
];

export const favoritesId = 'system:favorites';

export const ArtworkContext = createContext<Record<string, string>>({});
export const YoutubeEnabledContext = createContext(true);

export const artworkKey = (t: Track) => `${t.ref.provider}:${t.ref.id}`;

export const displayTitle = (t: QueueTrack) => {
  const divider = t.title.lastIndexOf(' / ');
  return isTrack(t) && !t.songId && t.ref.provider === 'bilibili' && t.ref.part && divider >= 0
    ? t.title.slice(divider + 3)
    : t.title;
};

export function Badge({ provider }: { provider: string }) {
  const Icon = provider === 'bilibili' ? TelevisionSimpleIcon : YoutubeLogoIcon;
  return <span className={'source-badge ' + provider}>
    <Icon size={18}/>{provider === 'bilibili' ? 'B站' : 'YouTube 视频'}</span>;
}

/** 曲目当前可显示的封面地址；YouTube 关闭时不显示其封面。 */
export function useArtworkUrl(track?: QueueTrack | null) {
  const cache = useContext(ArtworkContext), youtubeEnabled = useContext(YoutubeEnabledContext);
  const visible = track && (youtubeEnabled || !isTrack(track) || track.ref.provider !== 'youtube');
  return visible ? artworkUrl(track.artwork ?? (isTrack(track) ? cache[artworkKey(track)] : undefined)) : undefined;
}

export function Cover({ track, className = '', sharedArtwork = false }: { track?: QueueTrack | null; className?: string; sharedArtwork?: boolean }) {
  const artwork = useArtworkUrl(track);
  const [failed, setFailed] = useState('');
  const Image = sharedArtwork ? motion.img : 'img';
  const layout = sharedArtwork ? { layoutId: listeningArtworkId, transition: { layout: listeningArtworkSpring } } : {};
  return artwork && failed !== artwork
    ? <Image {...layout} className={className} src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(artwork)}/>
    : <span className={'unknown-cover ' + className} aria-label="封面未知">
      <MusicNotesIcon size={28}/>
    </span>;
}
