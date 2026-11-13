import { Button } from '../../ui/Button';
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
  SlidersHorizontalIcon,
  SubtitlesIcon,
} from '@phosphor-icons/react';
import { MobilePlayerOptions } from '../../MobilePlayerOptions';
import { AudioPreferenceSelect } from '../../AudioQualityOptions';
import { ControlPopover } from '../../ControlPopover';
import { closeLayer, OPEN_LAYER } from '../../ui/layers';
import { mobileVisuals, type MobileVisual } from '../useMobileVisual';
import { useWorkspace } from '../workspace-context';
import { PlaybackRate, SeekButtons, Volume } from './PlaybackControls';

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
            <Button variant="plain"
              disabled={!current}
              onClick={() => {
                close();
                setAudioQualityOpen(true);
              }}
            >
              <MusicNotesIcon size={22} />
              <span>音质与音轨</span>
            </Button>
            {preparingPlayback && (
              <Button variant="plain"
                onClick={() => {
                  close();
                  cancelPlayback();
                }}
              >
                <XIcon size={22} />
                <span>取消播放准备</span>
              </Button>
            )}
            <Button variant="plain"
              onClick={() => {
                close();
                openLyricsManagement();
              }}
            >
              <MusicNotesIcon size={22} />
              <span>歌词设置</span>
            </Button>
            {current && (
              <Button variant="plain"
                onClick={() => {
                  close();
                  open({ type: 'track', track: current, entryContext: 'part', intent: 'playlist' });
                }}
              >
                <ListBulletsIcon size={22} />
                <span>加入歌单</span>
              </Button>
            )}
            {currentSong && (
              <Button variant="plain"
                onClick={() => {
                  close();
                  setMobileSongId(currentSong.id);
                }}
              >
                <MusicNotesIcon size={22} />
                <span>歌曲与版本</span>
              </Button>
            )}
            {current && (
              <Button variant="plain"
                disabled={authorBusy}
                onClick={() => {
                  close();
                  void openCreator(current);
                }}
              >
                <UsersIcon size={22} />
                <span>查看 UP / 博主</span>
              </Button>
            )}
            {current && (
              <Button variant="plain"
                onClick={() => {
                  close();
                  groupSource(current);
                }}
              >
                <PlusIcon size={22} />
                <span>归入歌曲</span>
              </Button>
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
            <Button variant="plain"
              disabled={!current || snapshot.state === 'idle' || snapshot.state === 'stopped'}
              onClick={() => {
                close();
                void playback.stop();
              }}
            >
              <StopIcon size={22} />
              <span>停止播放</span>
            </Button>
            <Button variant="plain"
              disabled={!current || snapshot.state === 'idle'}
              onClick={() => {
                close();
                void playback.reset();
              }}
            >
              <ArrowCounterClockwiseIcon size={22} />
              <span>停止并归零</span>
            </Button>
          </div>
        </>
      )}
    </MobilePlayerOptions>
  ) : (
    <ControlPopover className="player-options" label="更多播放选项" icon={<DotsThreeIcon size={25} />}>
      {!dock && <div className="popover-volume popover-listening-extras"><Volume /></div>}
      {preparingPlayback && (
        <div className="player-options-section">
          <Button variant="plain" onClick={cancelPlayback}>
            <XIcon size={19} />
            取消播放准备
          </Button>
        </div>
      )}
      <div className="player-options-section">
        <p className="popover-heading">音质与歌词</p>
        <Button variant="plain"
          onClick={(event) => {
            const popover = event.currentTarget.closest<HTMLElement>(OPEN_LAYER);
            if (popover) closeLayer(popover);
            popover
              ?.closest('.control-popover')
              ?.querySelector<HTMLButtonElement>(':scope > button')
              ?.focus();
            setAudioQualityOpen(true);
          }}
        >
          <SlidersHorizontalIcon size={19} />
          音质与音轨
        </Button>
        <Button variant="plain"
          onClick={(event) => {
            event.currentTarget
              .closest('.control-popover')
              ?.querySelector<HTMLButtonElement>(':scope > button')
              ?.focus();
            openLyricsManagement();
          }}
        >
          <SubtitlesIcon size={19} />
          歌词设置
        </Button>
        <label className="choice popover-lyrics-choice">
          <input
            type="checkbox"
            checked={desktopHost.available ? desktopHost.visible : lyrics.bottom}
            onChange={desktopHost.available ? desktopHost.toggle : (event) => lyrics.updateDisplay({ bottom: event.target.checked })}
          />
          {desktopHost.available ? '桌面悬浮歌词' : '底部歌词'}
        </label>
      </div>
      {current && (
        <div className="player-options-section">
          <p className="popover-heading">当前歌曲</p>
          <Button variant="plain" onClick={() => open({ type: 'track', track: current, entryContext: 'part' })}>
            <MusicNotesIcon size={19} />
            歌曲操作
          </Button>
          <Button variant="plain" onClick={() => groupSource(current)}>
            <PlusIcon size={19} />
            归入歌曲
          </Button>
          {dock && (
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
        </div>
      )}
      {dock && (
        <div className="player-options-section" role="radiogroup" aria-label="底栏样式">
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
    </ControlPopover>
  );
}
