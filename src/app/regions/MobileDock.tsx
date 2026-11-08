import { Transport } from '../components/PlaybackControls';
import { creator } from '../../api';
import { SongEditor } from '../../SongLibraryPage';
import { MobileMiniPlayer, MobileNavigation } from '../../MobileChrome';
import { suspendMobilePages } from '../../mobile-pages';
import { Cover, displayTitle } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 移动端底部：迷你播放器、主导航与歌曲编辑页。 */
export function MobileDock() {
  const {
    desktop,
    page,
    mobilePageOpen,
    mobilePlayerEmpty,
    current,
    playback,
    currentSong,
    snapshot,
    open,
    mobileSecondary,
    navigate,
    mobileEditedSong,
    lib,
    mobileVersionPlayback,
    mutate,
    searchForLibrarySong,
    setMobileSongId,
    updateLibrary,
  } = useWorkspace();
  return (
    <>
      {!desktop && (page !== 'playing' || mobilePageOpen) && (
        <>
          <MobileMiniPlayer
            empty={mobilePlayerEmpty}
            cover={<Cover track={current} />}
            title={current ? displayTitle(current) : '选择一首音乐'}
            artist={
              playback.error
                ? '播放失败，点开重试'
                : current
                  ? currentSong?.artists?.join(' / ') || creator(current)
                  : '好音乐，等你发现'
            }
            progress={snapshot.duration ? snapshot.position / snapshot.duration : 0}
            transport={<Transport />}
            onOpen={() => {
              if (mobilePageOpen) suspendMobilePages(true);
              open({ type: 'playing' });
            }}
          />
          {!mobileSecondary && page !== 'playing' && <MobileNavigation page={page} onNavigate={navigate} />}
        </>
      )}
      {!desktop && mobileEditedSong && lib && (
        <SongEditor
          versionPlayback={mobileVersionPlayback}
          key={mobileEditedSong.id}
          song={mobileEditedSong}
          state={lib}
          commit={(edits, revision) => mutate({ edits, revision }, false, true)}
          onPlay={(selection, song) => void playback.playSelection(selection, song, true)}
          onSearch={searchForLibrarySong}
          onClose={() => setMobileSongId(undefined)}
          onChange={updateLibrary}
        />
      )}
    </>
  );
}
