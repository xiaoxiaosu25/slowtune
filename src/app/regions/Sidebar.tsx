import { Button, IconButton } from '../../ui/Button';
import { GlobalTools } from '../components/WorkspaceControls';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { PlaylistCover } from '../../PlaylistCover';
import { PlaylistActions } from '../../PlaylistActions';
import { HeadphonesIcon, PlusIcon, HeartIcon } from '@phosphor-icons/react';
import { SongCover } from '../../SongLibraryPage';
import { brand } from '../../../server/brand';
import { nav, favoritesId } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 桌面侧栏：品牌、主导航、我的歌单与全局工具。 */
export function Sidebar() {
  const reducedMotion = useReducedMotion();
  const {
    page,
    navigate,
    lib,
    open,
    selected,
    setSelected,
    libraryError,
    desktop,
    mutate,
    saving,
    youtubeEnabled,
    startPlayback,
    playback,
    enqueueSongs,
  } = useWorkspace();
  const sidebarPlaylistMenu = (id: string) => (
    <PlaylistActions
      target=".sidebar-playlist-item"
      targetId={id}
      library={lib!}
      commit={(edits, revision) =>
        mutate({ edits, ...(revision !== undefined ? { revision } : {}) }, false, true)
      }
      busy={saving}
      youtubeEnabled={youtubeEnabled}
      trigger={null}
      onOpen={() => {
        setSelected(id);
        navigate('library');
      }}
      onPlay={(items) => void startPlayback(() => playback.playSelections(items), false)}
      onEnqueue={enqueueSongs}
      onCreate={() => open({ type: 'new' })}
      onBackup={() => open({ type: 'backup' })}
    />
  );
  // The large playlist sidebar has no clock-dependent state. Stable elements keep
  // its cover lookups and icon trees outside desktop media-clock commits.
  const desktopSidebarPlaylists = useMemo(() => {
    if (!desktop || !lib) return;
    const songs = new Map(lib.snapshot.songs.map((song) => [song.id, song]));
    return lib.snapshot.playlists.map((p) => (
      <div className="sidebar-playlist-item" key={p.id}>
        <Button variant="plain"
          className={'sidebar-playlist ' + (page === 'library' && selected === p.id ? 'active' : '')}
          onClick={() => {
            setSelected(p.id);
            navigate('library');
          }}
        >
          <PlaylistCover
            image={p.desktopCover}
            song={songs.get(p.entries.find((entry) => songs.get(entry.songId)?.artwork)?.songId ?? '')}
          />
          <span>
            <strong className="playlist-label">{p.name}</strong>
            <small>{p.entries.length} 首</small>
          </span>
        </Button>
        {sidebarPlaylistMenu(p.id)}
      </div>
    ));
  }, [desktop, lib, page, selected, saving, youtubeEnabled]);
  const desktopFavoriteCover = useMemo(() => {
    if (!desktop || !lib) return;
    const songs = new Map(lib.snapshot.songs.map((song) => [song.id, song]));
    const song = songs.get(
      lib.snapshot.favorites.find((favorite) => songs.get(favorite.songId)?.artwork)?.songId ?? '',
    );
    return lib.snapshot.desktopFavoritesCover || song ? (
      <PlaylistCover image={lib.snapshot.desktopFavoritesCover} song={song} />
    ) : undefined;
  }, [desktop, lib]);
  return (
    <>
      {page !== 'playing' && (
        <aside className="sidebar">
          <Button variant="plain" className="brand" aria-label="慢听" onClick={() => navigate('discover')}>
            <span className="brand-mark">
              <HeadphonesIcon size={22} weight="bold" />
            </span>
            <span className="brand-wordmark">
              {brand.name}
              <small>{brand.english.toUpperCase()}</small>
            </span>
          </Button>
          <nav className="sidebar-nav" data-sliding-selection={desktop && !reducedMotion || undefined} aria-label="主导航">
            {nav.map((n) => (
              <Button variant="plain"
                key={n.id}
                className={'nav-item ' + (page === n.id ? 'active' : '')}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => navigate(n.id)}
              >
                {page === n.id && desktop && !reducedMotion && (
                  <motion.span className="sidebar-selection" layoutId="desktop-sidebar-selection" aria-hidden="true" />
                )}
                <n.icon size={22} weight={page === n.id ? 'fill' : 'regular'} />
                <span>{n.label}</span>
              </Button>
            ))}
          </nav>
          <div className="sidebar-library">
            <div className="sidebar-heading">
              <span>我的歌单</span>
              <IconButton

                aria-label="新建歌单"
                title="新建歌单"
                disabled={!lib}
                onClick={() => open({ type: 'new' })}
              >
                <PlusIcon size={19} />
              </IconButton>
            </div>
            <div className="sidebar-playlist-item">
              <Button variant="plain"
                className={
                  'sidebar-playlist ' + (page === 'library' && selected === favoritesId ? 'active' : '')
                }
                onClick={() => {
                  setSelected(favoritesId);
                  navigate('library');
                }}
              >
                {desktopFavoriteCover ?? (
                  <span className="sidebar-favorite-art" aria-hidden="true">
                    <HeartIcon size={23} weight="fill" />
                  </span>
                )}
                <span>
                  <strong>我的收藏</strong>
                  <small>
                    {lib ? lib.snapshot.favorites.length + ' 首' : libraryError ? '暂不可用' : '读取中…'}
                  </small>
                </span>
              </Button>
              {desktop && lib && sidebarPlaylistMenu(favoritesId)}
            </div>
            {desktop
              ? desktopSidebarPlaylists
              : lib?.snapshot.playlists.map((p) => (
                  <Button variant="plain"
                    className={
                      'sidebar-playlist ' + (page === 'library' && selected === p.id ? 'active' : '')
                    }
                    key={p.id}
                    onClick={() => {
                      setSelected(p.id);
                      navigate('library');
                    }}
                  >
                    <SongCover song={lib.snapshot.songs.find((song) => song.id === p.entries[0]?.songId)} />
                    <span>
                      <strong className="playlist-label">{p.name}</strong>
                      <small>{p.entries.length} 首</small>
                    </span>
                  </Button>
                ))}
            {lib && !lib.snapshot.playlists.length && (
              <p className="sidebar-empty">把喜欢的音乐整理成歌单</p>
            )}
          </div>
          {desktop && <GlobalTools className="desktop-tools" />}
        </aside>
      )}
    </>
  );
}
