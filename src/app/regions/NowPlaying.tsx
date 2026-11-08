import { CreatorContent } from '../components/TrackList';
import {
  PlaybackSlot,
  Transport,
  PlaybackProgress,
  Volume,
  PlaybackRate,
  SleepButton,
  PlaybackMode,
  SeekButtons,
  DesktopSongMeta,
  CurrentFavoriteButton,
} from '../components/PlaybackControls';
import { PlayerOptions } from '../components/PlayerOptions';
import { TelevisionSimpleIcon, YoutubeLogoIcon, ArrowRightIcon, QueueIcon } from '@phosphor-icons/react';
import { MobilePlayer } from '../../MobilePlayer';
import { audioQualityLabel } from '../../audio-quality';
import { PartBadge } from '../../PartBadge';
import { PlayingTitle } from '../../PlayingTitle';
import { PlayingArtwork } from '../../PlayingArtwork';
import { LyricsView, BottomLyrics } from '../../LyricsView';
import { LyricsToggle } from '../../DesktopLyricsView';
import { displayTitle } from '../shared';
import { useWorkspace } from '../workspace-context';

/** 移动完整播放页。 */
export function MobilePlayerView() {
  const {
    page,
    desktop,
    currentArtwork,
    snapshot,
    playback,
    mobileVisual,
    lyrics,
    lyricPlayback,
    current,
    currentSong,
    mobileArtist,
    currentVersion,
    setAudioQualityOpen,
    setMobileSongId,
    open,
    mobileVersionCount,
    partsStore,
    popup,
    searchOpen,
    showParts,
    queueVisible,
    listeningPanel,
    toggleQueue,
    navigate,
  } = useWorkspace();
  return (
    <>
      {page === 'playing' && !desktop && (
        <MobilePlayer
          artwork={
            <PlayingArtwork
              artwork={currentArtwork}
              playing={snapshot.playing && !snapshot.loading}
              muted={snapshot.muted || snapshot.volume === 0}
              analysis={playback.audioAnalysis}
              allowLyrics={false}
              visualMode={mobileVisual}
              interactive={false}
            />
          }
          lyrics={
            <LyricsView
              lyrics={lyrics}
              playback={lyricPlayback}
              onSeek={(seconds) => void playback.seek(seconds)}
              recovery
            />
          }
          title={
            <PlayingTitle
              key={current?.resourceId}
              title={current ? (currentSong?.title ?? displayTitle(current)) : undefined}
              fullTitle={current?.title}
              details={
                current && (
                  <dl className="mobile-track-details">
                    {currentSong && (
                      <>
                        <dt>歌曲</dt>
                        <dd>{currentSong.title}</dd>
                      </>
                    )}
                    {mobileArtist && (
                      <>
                        <dt>歌手</dt>
                        <dd>{mobileArtist}</dd>
                      </>
                    )}
                    <dt>当前来源</dt>
                    <dd>
                      {current.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}
                      {currentVersion?.label ? ' · ' + currentVersion.label : ''}
                    </dd>
                  </dl>
                )
              }
            />
          }
          artist={
            current ? mobileArtist || <CreatorContent track={current} /> : '从发现、搜索或歌单添加音乐'
          }
          quality={
            snapshot.format && (
              <button
                type="button"
                className="btn btn-ghost mobile-audio-quality"
                aria-label="当前音质"
                onClick={() => setAudioQualityOpen(true)}
              >
                {audioQualityLabel(snapshot.format)}
              </button>
            )
          }
          source={
            current && (
              <>
                <button
                  className="btn btn-ghost mobile-player-version"
                  aria-label={currentSong ? '选择播放版本 ' + currentSong.title : '查看当前来源'}
                  title={currentVersion?.label || '查看当前来源与版本'}
                  onClick={() =>
                    currentSong
                      ? setMobileSongId(currentSong.id)
                      : open({ type: 'track', track: current, entryContext: 'part' })
                  }
                >
                  <span className="mobile-source-platform">
                    {current.ref.provider === 'bilibili' ? (
                      <TelevisionSimpleIcon size={16} />
                    ) : (
                      <YoutubeLogoIcon size={16} />
                    )}
                    <span>{current.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}</span>
                  </span>
                  {currentVersion?.label && (
                    <span className="mobile-version-copy">{currentVersion.label}</span>
                  )}
                  <span className="mobile-version-count">
                    {mobileVersionCount ? '版本 · ' + mobileVersionCount : '来源详情'}
                    <ArrowRightIcon size={14} />
                  </span>
                </button>
                <PartBadge
                  track={current}
                  store={partsStore}
                  active={!popup}
                  current
                  viewKey={page + ':' + searchOpen}
                  onOpen={() => void showParts(current)}
                />
              </>
            )
          }
          progress={<PlaybackProgress />}
          transport={<Transport large />}
          mode={<PlaybackMode size={23} />}
          favorite={current ? <CurrentFavoriteButton /> : null}
          timer={<SleepButton />}
          queueOpen={queueVisible && listeningPanel === 'queue'}
          queueCount={snapshot.items.length}
          onQueue={toggleQueue}
          onLyricsSettings={lyrics.openSelector}
          onLyricsOffset={
            lyrics.document?.synced
              ? () => {
                  lyrics.openSettings();
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLDetailsElement>('.mobile-page .lyrics-offset')
                      ?.scrollIntoView({ block: 'start' }),
                  );
                }
              : undefined
          }
          empty={
            !current && (
              <button className="btn btn-primary" onClick={() => navigate('discover')}>
                去发现音乐
              </button>
            )
          }
        />
      )}
    </>
  );
}

/** 桌面正在播放页。 */
export function ListeningStage() {
  const {
    page,
    desktop,
    currentArtwork,
    snapshot,
    desktopLyricsOpen,
    playback,
    playbackLabel,
    setAudioQualityOpen,
    current,
    partsStore,
    popup,
    searchOpen,
    showParts,
    toggleDesktopLyrics,
    queueVisible,
    listeningPanel,
    toggleQueue,
    navigate,
    bottomLyricsVisible,
    lyrics,
    lyricPlayback,
  } = useWorkspace();
  return (
    <>
      {page === 'playing' && desktop && (
        <section className="listening-stage">
          {currentArtwork && (
            <img className="listening-backdrop" src={currentArtwork} alt="" referrerPolicy="no-referrer" />
          )}
          <div className="listening-content">
            <PlayingArtwork
              artwork={currentArtwork}
              playing={snapshot.playing && !snapshot.loading && !desktopLyricsOpen}
              muted={snapshot.muted || snapshot.volume === 0}
              analysis={playback.audioAnalysis}
              allowLyrics={false}
              desktop
              suspended={desktopLyricsOpen}
            />
            <div className="playing-detail">
              <div className="playing-title">
                <div className="playing-status">
                  <span
                    className={'playback-status ' + (snapshot.playing ? 'is-playing' : '')}
                    role="status"
                  >
                    {playbackLabel}
                  </span>
                  {!playback.preparing && !snapshot.loading && snapshot.format && (
                    <button
                      type="button"
                      className="audio-quality"
                      aria-label="当前音质"
                      title="查看来源规格与选择音轨"
                      onClick={() => setAudioQualityOpen(true)}
                    >
                      {audioQualityLabel(snapshot.format)}
                    </button>
                  )}
                </div>
                <PlayingTitle
                  key={current?.resourceId}
                  title={current ? displayTitle(current) : undefined}
                  fullTitle={current?.title}
                />
                {current && (
                  <PartBadge
                    track={current}
                    store={partsStore}
                    active={!popup}
                    current
                    viewKey={page + ':' + searchOpen}
                    onOpen={() => void showParts(current)}
                  />
                )}
                <div className="playing-meta desktop-playing-meta">
                  <div className="playing-song-copy">
                    <DesktopSongMeta />
                  </div>
                  <div className="playing-song-actions">
                    <LyricsToggle active={false} onClick={toggleDesktopLyrics} />
                    <PlayerOptions />
                  </div>
                </div>
              </div>
              <div className="listening-playback">
                <PlaybackProgress />
                <div className="playbar-controls listening-transport">
                  <PlaybackMode size={23} />
                  <Transport large />
                  {current ? (
                    <CurrentFavoriteButton />
                  ) : (
                    <span className="transport-balance" aria-hidden="true" />
                  )}
                  <PlaybackSlot />
                </div>
                <div className="listening-seek">
                  <SeekButtons compact />
                </div>
              </div>
              <div className="stage-volume">
                <Volume />
                <span className="volume-value">
                  {snapshot.muted ? '静音' : Math.round(snapshot.volume * 100) + '%'}
                </span>
              </div>
              <div className="stage-controls">
                <PlaybackRate labeled />
                <SleepButton labeled />
                <button
                  className="btn btn-secondary stage-queue"
                  aria-label="播放队列"
                  aria-expanded={queueVisible && listeningPanel === 'queue'}
                  onClick={toggleQueue}
                >
                  <QueueIcon size={21} />
                  <span>队列</span>
                  <small>{snapshot.items.length}</small>
                </button>
              </div>
              {!current && (
                <button className="btn btn-primary" onClick={() => navigate('discover')}>
                  去发现音乐
                </button>
              )}
            </div>
          </div>
          {bottomLyricsVisible && <BottomLyrics lyrics={lyrics} playback={lyricPlayback} />}
        </section>
      )}
    </>
  );
}
