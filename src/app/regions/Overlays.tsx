import { ListeningSidePanel, WorkspaceQueue } from '../components/WorkspaceControls';
import { WorkspaceNotice } from '../components/WorkspaceNotice';
import {
  PlaybackSlot,
  DialogPlaybackControl,
  Transport,
  PlaybackProgress,
  Volume,
  PlaybackMode,
  DesktopSongMeta,
  DesktopPlaybackFeedback,
} from '../components/PlaybackControls';
import { PlayerOptions } from '../components/PlayerOptions';
import type { ComponentProps } from 'react';
import { QueueIcon, SpinnerGapIcon, HeartIcon } from '@phosphor-icons/react';
import { DesktopOperationFeedback } from '../../DesktopFeedback';
import { SongVersionDialog } from '../../SongVersionDialog';
import { AudioQualityDialog } from '../../AudioQualityOptions';
import { Modal } from '../../Modal';
import { SongListImportPanel } from '../../SongListImportPanel';
import { PlayingTitle } from '../../PlayingTitle';
import { PlayingArtwork } from '../../PlayingArtwork';
import { BottomLyrics } from '../../LyricsView';
import { LyricsSettings } from '../../LyricsSettings';
import { DesktopLyricsView, LyricsToggle } from '../../DesktopLyricsView';
import { desktopFeature } from '../../DesktopRegion';
import { PlaybackVersionsDialog as managementUrl } from 'virtual:desktop-feature-urls';
import { displayTitle } from '../shared';
import { useWorkspace } from '../workspace-context';

const PlaybackVersionsDialog = desktopFeature<
  ComponentProps<typeof import('../../PlaybackVersionsDialog').PlaybackVersionsDialog>
>(managementUrl, 'PlaybackVersionsDialog', '播放版本');

/** 歌词层：桌面底部歌词、沉浸歌词与歌词设置。 */
export function LyricsLayers() {
  const {
    desktop,
    page,
    bottomLyricsVisible,
    lyrics,
    lyricPlayback,
    desktopLyricsOpen,
    chooseLyrics,
    currentArtwork,
    closeDesktopLyrics,
    playback,
    snapshot,
    current,
    queueVisible,
    toggleQueue,
    isFavorite,
    favoritePending,
    saving,
    lib,
    favorite,
    toggleDesktopLyrics,
    desktopHost,
  } = useWorkspace();
  return (
    <>
      {desktop && page !== 'playing' && bottomLyricsVisible && (
        <BottomLyrics lyrics={lyrics} playback={lyricPlayback} compact desktop />
      )}
      {desktopLyricsOpen && (
        <DesktopLyricsView
          onChooseLyrics={chooseLyrics}
          lyrics={lyrics}
          playback={lyricPlayback}
          artwork={currentArtwork}
          onClose={closeDesktopLyrics}
          onSeek={(seconds) => void playback.seek(seconds)}
          visual={
            <PlayingArtwork
              artwork={currentArtwork}
              playing={snapshot.playing && !snapshot.loading}
              muted={snapshot.muted || snapshot.volume === 0}
              analysis={playback.audioAnalysis}
              allowLyrics={false}
              desktop
            />
          }
          songInfo={
            <>
              <PlayingTitle
                key={current?.resourceId}
                title={current ? displayTitle(current) : undefined}
                fullTitle={current?.title}
              />
              <div className="playing-song-copy">
                <DesktopSongMeta />
              </div>
            </>
          }
          controls={
            <>
              <PlaybackProgress />
              <PlaybackSlot />
              <div className="desktop-lyrics-tools">
                <PlaybackMode />
                <Volume />
              </div>
              <Transport large />
              <div className="desktop-lyrics-tools">
                <button
                  className="btn btn-icon"
                  aria-label="播放队列"
                  title="播放队列"
                  aria-expanded={queueVisible}
                  onClick={toggleQueue}
                >
                  <QueueIcon size={24} />
                </button>
                {current && (
                  <button
                    className={'btn btn-icon ' + (isFavorite(current) ? 'saved' : '')}
                    title={isFavorite(current) ? '取消收藏当前歌曲' : '收藏当前歌曲'}
                    aria-label="收藏当前歌曲"
                    aria-pressed={isFavorite(current)}
                    aria-busy={favoritePending(current) || undefined}
                    disabled={saving || !lib || favoritePending(current)}
                    onClick={() => favorite(current, true, 'part')}
                  >
                    {favoritePending(current) ? (
                      <SpinnerGapIcon size={22} className="favorite-spinner" />
                    ) : (
                      <HeartIcon size={24} weight={isFavorite(current) ? 'fill' : 'regular'} />
                    )}
                  </button>
                )}
                <LyricsToggle active onClick={toggleDesktopLyrics} />
                <PlayerOptions dock />
              </div>
            </>
          }
        />
      )}
      <LyricsSettings
        lyrics={lyrics}
        desktopImmersive={desktop}
        nativeDesktop={desktopHost.available}
        playbackControl={desktop ? <DialogPlaybackControl /> : undefined}
      />
    </>
  );
}

/** 播放版本对话框与播放队列。 */
export function PlaybackLayers() {
  const {
    versionsVisible,
    setVersionsOpen,
    current,
    currentSong,
    lib,
    youtubeEnabled,
    preparingPlayback,
    saving,
    playback,
    startPlayback,
    mutate,
    groupSource,
    queueVisible,
    compactQueue,
    desktopLyricsOpen,
    page,
    listeningPanel,
    closeQueue,
  } = useWorkspace();
  return (
    <>
      {versionsVisible && (
        <PlaybackVersionsDialog
          onClose={() => setVersionsOpen(false)}
          current={current}
          song={currentSong}
          library={lib}
          youtubeEnabled={youtubeEnabled}
          preparing={preparingPlayback}
          saving={saving}
          playbackError={playback.error}
          playbackControl={<DialogPlaybackControl />}
          onPlay={(selection, song) => startPlayback(() => playback.playSelection(selection, song, true))}
          onSave={(track, song) =>
            song
              ? mutate({ save: { refs: [track.ref], target: 'version', songId: song.id } }, false)
              : groupSource(track)
          }
          onDefault={(song, version) =>
            mutate({ edits: [{ type: 'set-default', songId: song.id, versionId: version.id }] }, false)
          }
        />
      )}
      {queueVisible &&
        (compactQueue || desktopLyricsOpen ? (
          <Modal
            title={page === 'playing' && listeningPanel === 'comments' ? '视频评论' : '播放队列'}
            className="queue-drawer"
            showHeader={false}
            onClose={closeQueue}
          >
            {page === 'playing' ? <ListeningSidePanel /> : <WorkspaceQueue />}
          </Modal>
        ) : page === 'playing' ? (
          <ListeningSidePanel />
        ) : (
          <WorkspaceQueue />
        ))}
    </>
  );
}

/** 全局提示与对话框：轻提示、音质、播放反馈、桌面操作反馈、列表导入与版本归类。 */
export function WorkspaceDialogs() {
  const {
    notice,
    popup,
    desktop,
    error,
    searchOpen,
    noticeAction,
    audioQualityOpen,
    playback,
    bilibiliAccount,
    sources,
    setAudioQualityOpen,
    online,
    setError,
    reload,
    pending,
    saving,
    retryWrite,
    onLogout,
    listImport,
    lib,
    client,
    updateLibrary,
    setListImport,
    flash,
    groupTrack,
    setGroupTrack,
  } = useWorkspace();
  return (
    <>
      {notice && !popup && (!desktop || (!error && !searchOpen)) && (
        <WorkspaceNotice text={notice} action={noticeAction} desktop={desktop} />
      )}
      {audioQualityOpen && (
        <AudioQualityDialog
          playback={playback}
          generation={JSON.stringify([
            bilibiliAccount?.state,
            bilibiliAccount?.account?.id,
            sources?.sequence,
          ])}
          onClose={() => setAudioQualityOpen(false)}
        />
      )}
      <DesktopPlaybackFeedback />
      {desktop && (
        <DesktopOperationFeedback
          error={!popup && !searchOpen ? error : ''}
          offline={!online}
          onDismiss={() => setError('')}
        >
          <button className="btn btn-ghost" onClick={() => void reload()}>
            重读资料 / 检查服务
          </button>
          {pending && (
            <button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>
              重试保留编辑
            </button>
          )}
          {error.includes('会话') && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await playback.release();
                onLogout();
              }}
            >
              重新连接
            </button>
          )}
        </DesktopOperationFeedback>
      )}
      {listImport && lib && (
        <SongListImportPanel
          client={client}
          input={listImport}
          library={lib}
          onChange={updateLibrary}
          onClose={() => setListImport(undefined)}
          onSaved={(text) => flash(text)}
        />
      )}
      {groupTrack && lib && (
        <SongVersionDialog
          track={groupTrack}
          library={lib}
          desktop={desktop}
          onChange={(data) => {
            updateLibrary(data);
            flash('已保存到歌曲，当前播放继续。');
          }}
          onClose={() => setGroupTrack(undefined)}
        />
      )}
    </>
  );
}
