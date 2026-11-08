import {
  DotsThreeIcon,
  XIcon,
  PlusIcon,
  LinkIcon,
  StopIcon,
  ArrowCounterClockwiseIcon,
  MusicNotesIcon,
  UsersIcon,
  ListBulletsIcon,
  QueueIcon,
} from '@phosphor-icons/react';
import { MobilePlayerOptions } from '../../MobilePlayerOptions';
import { AudioPreferenceSelect } from '../../AudioQualityOptions';
import { ControlPopover } from '../../ControlPopover';
import { DesktopLyricFont } from '../../DesktopLyricFont';
import { DesktopLyricMotion } from '../../DesktopLyricMotion';
import { mobileVisuals, type MobileVisual } from '../useMobileVisual';
import { useWorkspace } from '../workspace-context';
import { PlaybackRate, SleepButton, SeekButtons, Volume } from './PlaybackControls';

export function PlayerOptions({ dock = false }: { dock?: boolean }) {
  const {
    desktop,
    playback,
    mobileVisual,
    selectMobileVisual,
    desktopHost,
    current,
    preparingPlayback,
    setAudioQualityOpen,
    cancelPlayback,
    openLyricsManagement,
    open,
    currentSong,
    setMobileSongId,
    authorBusy,
    openCreator,
    groupSource,
    snapshot,
    playerStyle,
    selectPlayerStyle,
    lyrics,
    page,
    desktopLyricsOpen,
    queueVisible,
    toggleQueue,
    startPlayback,
  } = useWorkspace();
  return !desktop ? (
    <MobilePlayerOptions>
      {(close) => (
        <>
          <div className="mobile-playback-adjustments">
            <div className="mobile-option-volume">
              <span>音量</span>
              <Volume />
            </div>
            <PlaybackRate labeled />
            <AudioPreferenceSelect playback={playback} />
            <div className="popover-seek">
              <SeekButtons />
            </div>
            <label className="field">
              <span className="field-label">封面样式</span>
              <select
                className="select"
                aria-label="封面样式"
                value={mobileVisual}
                onChange={(event) => {
                  const mode = event.target.value as MobileVisual;
                  if (mode === 'spectrum' || mode === 'halo') playback.audioAnalysis?.request(true, true);
                  selectMobileVisual(mode);
                }}
              >
                {Object.entries(mobileVisuals).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {desktopHost.available && (
            <label className="choice">
              <input type="checkbox" checked={desktopHost.visible} onChange={desktopHost.toggle} />
              桌面悬浮歌词
            </label>
          )}
          <div className="mobile-action-list">
            <button
              disabled={!current}
              onClick={() => {
                close();
                setAudioQualityOpen(true);
              }}
            >
              <MusicNotesIcon size={22} />
              <span>音质与音轨</span>
            </button>
            {preparingPlayback && (
              <button
                onClick={() => {
                  close();
                  cancelPlayback();
                }}
              >
                <XIcon size={22} />
                <span>取消播放准备</span>
              </button>
            )}
            <button
              onClick={() => {
                close();
                openLyricsManagement();
              }}
            >
              <MusicNotesIcon size={22} />
              <span>歌词设置</span>
            </button>
            {current && (
              <button
                onClick={() => {
                  close();
                  open({ type: 'track', track: current, entryContext: 'part', intent: 'playlist' });
                }}
              >
                <ListBulletsIcon size={22} />
                <span>加入歌单</span>
              </button>
            )}
            {currentSong && (
              <button
                onClick={() => {
                  close();
                  setMobileSongId(currentSong.id);
                }}
              >
                <MusicNotesIcon size={22} />
                <span>歌曲与版本</span>
              </button>
            )}
            {current && (
              <button
                disabled={authorBusy}
                onClick={() => {
                  close();
                  void openCreator(current);
                }}
              >
                <UsersIcon size={22} />
                <span>查看 UP / 博主</span>
              </button>
            )}
            {current && (
              <button
                onClick={() => {
                  close();
                  groupSource(current);
                }}
              >
                <PlusIcon size={22} />
                <span>归入歌曲</span>
              </button>
            )}
            {current && (
              <a
                href={
                  current.url ||
                  (current.ref.provider === 'bilibili'
                    ? 'https://www.bilibili.com/video/' + current.ref.id
                    : 'https://www.youtube.com/watch?v=' + current.ref.id)
                }
                target="_blank"
                rel="noreferrer"
                onClick={close}
              >
                <LinkIcon size={22} />
                <span>查看来源</span>
              </a>
            )}
            <button
              disabled={!current || snapshot.state === 'idle' || snapshot.state === 'stopped'}
              onClick={() => {
                close();
                void playback.stop();
              }}
            >
              <StopIcon size={22} />
              <span>停止播放</span>
            </button>
            <button
              disabled={!current || snapshot.state === 'idle'}
              onClick={() => {
                close();
                void playback.reset();
              }}
            >
              <ArrowCounterClockwiseIcon size={22} />
              <span>停止并归零</span>
            </button>
          </div>
        </>
      )}
    </MobilePlayerOptions>
  ) : (
    <ControlPopover className="player-options" label="更多播放选项" icon={<DotsThreeIcon size={25} />}>
      {dock && (
        <div className="popover-player-style" role="radiogroup" aria-label="底栏样式">
          <p className="popover-heading">底栏样式</p>
          <label className="player-style-option">
            <input
              type="radio"
              name="player-style"
              value="floating"
              checked={playerStyle === 'floating'}
              onChange={() => selectPlayerStyle('floating')}
            />
            <span>悬浮播放岛</span>
          </label>
          <label className="player-style-option">
            <input
              type="radio"
              name="player-style"
              value="bar"
              checked={playerStyle === 'bar'}
              onChange={() => selectPlayerStyle('bar')}
            />
            <span>底部长条</span>
          </label>
        </div>
      )}
      <p className="popover-heading">播放选项</p>
      {preparingPlayback && (
        <button onClick={cancelPlayback}>
          <XIcon size={19} />
          取消播放准备
        </button>
      )}
      {dock && (
        <>
          <div className="popover-settings">
            <PlaybackRate labeled />
            <SleepButton labeled />
          </div>
          <div className="popover-seek">
            <SeekButtons />
          </div>
        </>
      )}
      <AudioPreferenceSelect playback={playback} />
      <button
        disabled={!current}
        onClick={(event) => {
          const popover = event.currentTarget.closest<HTMLElement>('[popover]');
          popover?.hidePopover();
          popover
            ?.closest('.control-popover')
            ?.querySelector<HTMLButtonElement>('button[popovertarget]')
            ?.focus();
          setAudioQualityOpen(true);
        }}
      >
        <MusicNotesIcon size={19} />
        音质与音轨
      </button>
      {desktop && !desktopHost.available && (
        <label className="choice popover-lyrics-choice">
          <input
            type="checkbox"
            checked={lyrics.bottom}
            onChange={(event) => lyrics.updateDisplay({ bottom: event.target.checked })}
          />
          底部歌词
        </label>
      )}
      {desktopHost.available && (
        <label className="choice popover-lyrics-choice">
          <input type="checkbox" checked={desktopHost.visible} onChange={desktopHost.toggle} />
          桌面悬浮歌词
        </label>
      )}
      <button
        onClick={(event) => {
          event.currentTarget
            .closest('.control-popover')
            ?.querySelector<HTMLButtonElement>('button[popovertarget]')
            ?.focus();
          openLyricsManagement();
        }}
      >
        <MusicNotesIcon size={19} />
        {desktop && page === 'playing' ? '歌词管理' : '歌词设置'}
      </button>
      {desktop && page === 'playing' && (
        <>
          <DesktopLyricFont />
          <DesktopLyricMotion lyrics={lyrics} />
        </>
      )}
      {desktopLyricsOpen && (
        <>
          <label className="choice popover-lyrics-choice">
            <input
              type="checkbox"
              checked={lyrics.translations}
              onChange={(event) => lyrics.updateDisplay({ translations: event.target.checked })}
            />
            显示翻译
          </label>
          <a href="/legal/desktop-lyrics-source.tar.gz" download="slowtune-desktop-lyrics-source.tar.gz">
            下载当前构建对应源码
          </a>
          <a href="/legal/THIRD-PARTY-NOTICES.txt" download>
            下载第三方许可全文
          </a>
        </>
      )}
      {!dock && page === 'playing' && (
        <div className="popover-listening-extras">
          <div className="popover-seek">
            <SeekButtons />
          </div>
          <div className="popover-volume">
            <Volume />
          </div>
        </div>
      )}
      {!dock && page === 'playing' && (
        <div className="popover-short-settings">
          <PlaybackRate labeled />
          <SleepButton labeled />
          <button
            className="btn btn-ghost"
            aria-label="播放队列"
            aria-expanded={queueVisible}
            onClick={toggleQueue}
          >
            <QueueIcon size={19} />
            播放队列
          </button>
        </div>
      )}
      {current && (
        <button onClick={() => open({ type: 'track', track: current, entryContext: 'part' })}>
          <MusicNotesIcon size={19} />
          歌曲操作
        </button>
      )}
      {current && (
        <button onClick={() => groupSource(current)}>
          <PlusIcon size={19} />
          归入歌曲
        </button>
      )}
      {current && (
        <a
          href={
            current.url ||
            (current.ref.provider === 'bilibili'
              ? 'https://www.bilibili.com/video/' + current.ref.id
              : 'https://www.youtube.com/watch?v=' + current.ref.id)
          }
          target="_blank"
          rel="noreferrer"
        >
          <LinkIcon size={19} />
          查看来源
        </a>
      )}
      {!dock && page === 'playing' && (
        <div className="player-help">
          {snapshot.state === 'idle' && snapshot.items.length > 0 && (
            <p className="restore-hint">队列已恢复，播放将从头开始。</p>
          )}
          <p className="player-shortcuts">
            <kbd>空格</kbd> 播放 / 暂停
          </p>
          <p className="player-shortcuts">
            <kbd>←</kbd>
            <kbd>→</kbd> 跳转 5 秒
          </p>
        </div>
      )}
      <button
        disabled={!current || snapshot.state === 'idle' || snapshot.state === 'stopped'}
        onClick={() => void startPlayback(() => playback.stop(), false)}
      >
        <StopIcon size={19} />
        停止播放
      </button>
      <button
        disabled={!current || snapshot.state === 'idle'}
        onClick={() => void startPlayback(() => playback.reset(), false)}
      >
        <ArrowCounterClockwiseIcon size={19} />
        停止并归零
      </button>
    </ControlPopover>
  );
}
