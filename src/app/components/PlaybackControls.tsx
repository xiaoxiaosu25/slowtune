import {
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  ListBulletsIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOnceIcon,
  RewindIcon,
  FastForwardIcon,
  SpeakerSlashIcon,
  MoonIcon,
  SpinnerGapIcon,
  HeartIcon,
} from '@phosphor-icons/react';
import { key, time } from '../../api';
import { DesktopPlaybackProgress } from '../../DesktopPlaybackProgress';
import { RateControl } from '../../RateControl';
import { PlaybackSource } from '../../PlaybackSource';
import { PlaybackFeedback } from '../../DesktopFeedback';
import { useWorkspace } from '../workspace-context';
import { PlayGlyph } from './PlayGlyph';

export function PlaybackRate({ labeled = false }: { labeled?: boolean } = {}) {
  const { snapshot, playback } = useWorkspace();
  return <RateControl value={snapshot.rate} onChange={playback.rate} labeled={labeled} />;
}

export function SleepButton({ labeled = false }: { labeled?: boolean } = {}) {
  const { sleepRunning, sleepBadge, open } = useWorkspace();
  return (
    <button
      type="button"
      className={
        'btn sleep-control player-setting ' + (labeled ? 'labeled ' : '') + (sleepRunning ? 'saved' : '')
      }
      title={sleepRunning ? '睡眠定时器 · 剩余 ' + sleepBadge : '睡眠定时器'}
      aria-label="睡眠定时器"
      aria-pressed={sleepRunning}
      onClick={() => open({ type: 'sleep' })}
    >
      <span className="setting-icon">
        <MoonIcon size={19} />
      </span>
      {labeled && <span className="setting-label">定时</span>}
      <span className="setting-value">{sleepRunning ? sleepBadge : labeled ? '未开启' : '定时'}</span>
    </button>
  );
}

export function Transport({ large = false }: { large?: boolean } = {}) {
  const { snapshot, preparingPlayback, startPlayback, cancelPlayback, playback } = useWorkspace();
  return (
    <div className={'transport ' + (large ? 'large' : '')}>
      <button
        className="btn btn-icon"
        title="上一首"
        aria-label="上一首"
        onClick={() => void startPlayback(() => playback.previous(), false)}
        disabled={!snapshot.canPrevious}
      >
        <SkipBackIcon size={23} weight="fill" />
      </button>
      <button
        className="play-toggle"
        title={preparingPlayback ? '取消播放准备' : snapshot.playing ? '暂停 · 空格' : '播放 · 空格'}
        aria-label={preparingPlayback ? '取消播放准备' : snapshot.playing ? '暂停' : '播放'}
        aria-busy={preparingPlayback}
        onClick={() =>
          preparingPlayback ? cancelPlayback() : void startPlayback(() => playback.toggle(), false)
        }
        disabled={!snapshot.items.length && !preparingPlayback}
      >
        {preparingPlayback ? (
          <SpinnerGapIcon size={26} />
        ) : (
          <PlayGlyph playing={snapshot.playing} />
        )}
      </button>
      <button
        className="btn btn-icon"
        title="下一首"
        aria-label="下一首"
        onClick={() => void startPlayback(() => playback.next(), false)}
        disabled={!snapshot.canNext}
      >
        <SkipForwardIcon size={23} weight="fill" />
      </button>
    </div>
  );
}

export function PlaybackProgress() {
  const { desktop, snapshot, playback, current, scrub, setScrub, scrubValue, commitScrub, releaseScrub } =
    useWorkspace();
  return desktop ? (
    <DesktopPlaybackProgress
      key={snapshot.currentId}
      clock={playback.clock}
      enabled={!!current && snapshot.state !== 'idle' && snapshot.state !== 'stopped'}
      onSeek={playback.seek}
    />
  ) : (
    <div className="progress">
      <span>{time(scrub ?? snapshot.position)}</span>
      <div className="progress-track">
        {snapshot.buffered.map((range, index) =>
          snapshot.duration && range.end > range.start ? (
            <span
              key={index}
              className="progress-buffer"
              style={{
                left: (range.start / snapshot.duration) * 100 + '%',
                width: ((range.end - range.start) / snapshot.duration) * 100 + '%',
              }}
            />
          ) : null,
        )}
        <input
          aria-label="播放进度"
          aria-valuetext={time(scrub ?? snapshot.position) + ' / ' + time(snapshot.duration)}
          type="range"
          min="0"
          max={snapshot.duration ?? 0}
          step=".1"
          value={
            snapshot.duration ? Math.min(scrub ?? snapshot.position, snapshot.duration) : snapshot.position
          }
          disabled={
            !snapshot.duration || !current || snapshot.state === 'idle' || snapshot.state === 'stopped'
          }
          style={
            {
              '--fill':
                (snapshot.duration
                  ? Math.min(100, Math.max(0, ((scrub ?? snapshot.position) / snapshot.duration) * 100))
                  : 0) + '%',
            } as React.CSSProperties
          }
          onChange={(e) => {
            const value = Number(e.target.value);
            scrubValue.current = value;
            setScrub(value);
          }}
          onPointerUp={releaseScrub}
          onPointerCancel={() => {
            scrubValue.current = null;
            setScrub(null);
          }}
          onKeyUp={(e) => {
            if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
              commitScrub();
          }}
          onBlur={commitScrub}
        />
      </div>
      <span>{time(snapshot.duration)}</span>
    </div>
  );
}

export function PlaybackMode({
  size = 22,
  showLabel = false,
}: { size?: number; showLabel?: boolean } = {}) {
  const { mode, current, playback } = useWorkspace();
  const modeLabel = { sequential: '顺序播放', shuffle: '随机播放', all: '列表循环', one: '单曲循环' }[mode];
  const nextModeLabel = { sequential: '随机播放', shuffle: '列表循环', all: '单曲循环', one: '顺序播放' }[
    mode
  ];
  const ModeIcon = {
    sequential: ListBulletsIcon,
    shuffle: ShuffleIcon,
    all: RepeatIcon,
    one: RepeatOnceIcon,
  }[mode];
  return (
    <button
      type="button"
      className={
        'btn btn-icon mode-control ' +
        (mode !== 'sequential' ? 'saved ' : '') +
        (showLabel ? 'mode-control-labeled' : '')
      }
      aria-label="播放模式"
      aria-description={modeLabel + '；点击切换为' + nextModeLabel}
      title={modeLabel + ' · 点击切换为' + nextModeLabel}
      data-mode={mode}
      onClick={playback.cycleMode}
    >
      <ModeIcon size={size} />
      {showLabel && (
        <span className="playback-mode-label" aria-live="polite">
          {current?.partsGroupId && mode === 'sequential' ? '按分 P 顺序播放' : modeLabel}
        </span>
      )}
    </button>
  );
}
export function SeekButtons({ compact = false }: { compact?: boolean } = {}) {
  const { snapshot, playback, current } = useWorkspace();
  return [-10, 10].map((delta) => {
    const Icon = delta < 0 ? RewindIcon : FastForwardIcon,
      label = delta < 0 ? '快退' : '快进';
    return (
      <button
        key={delta}
        type="button"
        className={'btn seek-button' + (compact ? ' seek-button-compact' : '')}
        aria-label={label + ' 10 秒'}
        title={label + ' 10 秒 · ' + (delta < 0 ? 'J' : 'L')}
        disabled={
          !current || !snapshot.duration || snapshot.state === 'idle' || snapshot.state === 'stopped'
        }
        onClick={() => void playback.skip(delta)}
      >
        <Icon size={compact ? 20 : 18} />
        {compact ? (
          <span className="seek-value" aria-hidden="true">
            10
          </span>
        ) : (
          <span>
            {label} <span className="seek-value">10 秒</span>
          </span>
        )}
      </button>
    );
  });
}

export function Volume() {
  const { desktop, snapshot, playback } = useWorkspace();
  return (
    <div className="volume-control">
      <button
        type="button"
        className={'btn btn-icon ' + (snapshot.muted ? 'saved' : '')}
        title={snapshot.muted ? '取消静音' : '静音'}
        aria-label={snapshot.muted ? '取消静音' : '静音'}
        aria-pressed={snapshot.muted}
        onClick={playback.mute}
      >
        {snapshot.muted || snapshot.volume === 0 ? (
          <SpeakerSlashIcon size={20} />
        ) : (
          <SpeakerHighIcon size={20} />
        )}
      </button>
      {desktop ? (
        <div className="scrubber volume-scrubber" style={{ '--fill': (snapshot.muted ? 0 : snapshot.volume * 100) + '%' } as React.CSSProperties}>
          <span className="scrubber-rail" aria-hidden="true"><span className="scrubber-fill" /></span>
          <span className="scrubber-thumb" aria-hidden="true" />
          <input
            aria-label="音量"
            aria-valuetext={Math.round(snapshot.volume * 100) + '%' + (snapshot.muted ? ' · 已静音' : '')}
            type="range"
            min="0"
            max="1"
            step=".01"
            value={snapshot.volume}
            onChange={(e) => playback.volume(Number(e.target.value))}
          />
        </div>
      ) : <input
        aria-label="音量"
        aria-valuetext={Math.round(snapshot.volume * 100) + '%' + (snapshot.muted ? ' · 已静音' : '')}
        type="range"
        min="0"
        max="1"
        step=".01"
        value={snapshot.volume}
        style={{ '--fill': (snapshot.muted ? 0 : snapshot.volume * 100) + '%' } as React.CSSProperties}
        onChange={(e) => playback.volume(Number(e.target.value))}
      />}
    </div>
  );
}

export function DesktopSongMeta() {
  const { current, currentVersion, partsStore, openVersions, versionsVisible } = useWorkspace();
  return current ? (
    <>
      <div className="playing-artist">
        <span>{current.artists?.join(' / ') || '歌手未提供'}</span>
      </div>
      <PlaybackSource
        key={key(current.ref)}
        track={current}
        version={currentVersion}
        store={partsStore}
        onVersions={openVersions}
        versionsOpen={versionsVisible}
      />
    </>
  ) : (
    <p className="muted">从发现、搜索或歌单添加音乐</p>
  );
}

export function DialogPlaybackControl() {
  const { snapshot, preparingPlayback, cancelPlayback, startPlayback, playback } = useWorkspace();
  return (
    <button
      className="btn btn-icon"
      aria-label={preparingPlayback ? '取消播放准备' : snapshot.playing ? '暂停当前播放' : '继续当前播放'}
      title={snapshot.playing ? '暂停当前播放' : '继续当前播放'}
      disabled={!snapshot.items.length && !preparingPlayback}
      onClick={() =>
        preparingPlayback ? cancelPlayback() : void startPlayback(() => playback.toggle(), false)
      }
    >
      {preparingPlayback ? (
        <SpinnerGapIcon size={20} />
      ) : (
        <PlayGlyph playing={snapshot.playing} size={20} />
      )}
    </button>
  );
}

export function PlaybackSlot() {
  const { desktop } = useWorkspace();
  return desktop ? <span className="desktop-playback-slot" data-desktop-playback-slot="" /> : null;
}

export function CurrentFavoriteButton() {
  const { current, isFavorite, favoritePending, saving, lib, favorite } = useWorkspace();
  return (
    current && (
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
    )
  );
}

export function DesktopPlaybackFeedback() {
  const {
    desktop,
    playback,
    playAction,
    preparingPlayback,
    retryPlayback,
    dismissPlayback,
    cancelPlayback,
  } = useWorkspace();
  return desktop ? (
    <PlaybackFeedback
      error={playAction?.error || playback.error}
      failures={playback.chartFailures}
      preparing={preparingPlayback}
      retryLabel={playback.chartSearchTitle ? '去搜索' : '重试播放'}
      onRetry={retryPlayback}
      onStop={cancelPlayback}
      onDismiss={dismissPlayback}
      onDismissFailures={playback.dismissChartFailures}
    />
  ) : null;
}
