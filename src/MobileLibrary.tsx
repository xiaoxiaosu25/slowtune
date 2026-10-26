import { useMemo, useState } from 'react';
import { ArrowsDownUpIcon, DotsThreeIcon, HeartIcon, ListBulletsIcon, MusicNotesIcon, PlusIcon } from '@phosphor-icons/react';
import type { SongLibraryState } from '../server/song-library-types';
import { PlaylistCover } from './PlaylistCover';
import { Modal } from './Modal';
import { SongMaintenancePanel } from './SongMaintenancePanel';

export function MobileLibrary({ library, error, onRetry, onSelect, onCreate, onBackup, onChange, active = true }: {
  library: SongLibraryState | null; error?: string; onRetry: () => void; onSelect: (id: string) => void;
  onCreate: () => void; onBackup: () => void; onChange: (library: SongLibraryState) => void; active?: boolean;
}) {
  const [menu, setMenu] = useState(false), [maintenance, setMaintenance] = useState(false);
  const songs = useMemo(() => new Map(library?.snapshot.songs.map(song => [song.id, song]) ?? []), [library]);
  if (!library) return error ? <div className="feedback" role="alert"><p>音乐库暂时无法读取。{error}</p><button className="btn btn-secondary" onClick={onRetry}>重试读取歌单</button></div> : <p className="loading">正在读取音乐库…</p>;
  return <section className="mobile-library" aria-label="音乐库" hidden={!active}>
    {error && <div className="feedback" role="status"><p>更新暂时失败，已保留音乐库。{error}</p><button className="btn btn-ghost" onClick={onRetry}>重试读取歌单</button></div>}
    <div className="mobile-library-heading"><h2 id="mobile-playlists-heading">我的歌单 <small>{library.snapshot.playlists.length + 1}</small></h2><button className="btn btn-icon" aria-label="音乐库管理" aria-expanded={menu} onClick={() => setMenu(true)}><DotsThreeIcon size={25}/></button></div>
    <div className="toolbar mobile-library-tools"><button className="btn btn-secondary" onClick={onCreate}><PlusIcon size={21}/>新建歌单</button><button className="btn btn-ghost" onClick={onBackup}><ArrowsDownUpIcon size={21}/>导入</button></div>
    <div className="mobile-library-playlists" role="group" aria-labelledby="mobile-playlists-heading">
      <button onClick={() => onSelect('system:favorites')}><span className="mobile-library-heart"><HeartIcon size={44} weight="fill"/></span><span className="mobile-library-copy"><strong>我的收藏</strong><small>{library.snapshot.favorites.length} 首歌曲</small></span></button>
      {library.snapshot.playlists.map(playlist => <button key={playlist.id} onClick={() => onSelect(playlist.id)}><PlaylistCover image={playlist.desktopCover} song={songs.get(playlist.entries.find(entry => songs.get(entry.songId)?.artwork)?.songId ?? playlist.entries[0]?.songId ?? '')}/><span className="mobile-library-copy"><strong>{playlist.name}</strong><small>{playlist.entries.length} 首歌曲</small></span></button>)}
    </div>
    {!library.snapshot.playlists.length && <div className="empty"><MusicNotesIcon size={36}/><h3>把喜欢的音乐放在一起</h3><button className="btn btn-secondary" onClick={onCreate}>创建第一张歌单</button></div>}
    {menu && <Modal title="音乐库管理" className="mobile-actions-sheet" onClose={() => setMenu(false)}><div className="mobile-action-list"><button onClick={() => { setMenu(false); setMaintenance(true); }}><ListBulletsIcon size={22}/><span>资料库维护</span></button><button onClick={() => { setMenu(false); onBackup(); }}><ArrowsDownUpIcon size={22}/><span>导入 / 导出</span></button></div></Modal>}
    {maintenance && <SongMaintenancePanel library={library} onChange={onChange} onClose={() => setMaintenance(false)}/>}
  </section>;
}
