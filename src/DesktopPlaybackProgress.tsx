import { useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from 'react';
import { time } from './api';
import type { PlaybackClock } from './playback-clock';

/**
 * 桌面进度条。可见部分（轨道、缓冲、已播放、悬停预览、圆点、时间提示）都是自绘层，
 * 交互和读屏仍由下面透明的原生 range 负责。悬停时间直接写 DOM，指针移动不触发重新渲染。
 */
export function DesktopPlaybackProgress({ clock, enabled, onSeek }: { clock: PlaybackClock; enabled: boolean; onSeek: (seconds: number) => unknown }) {
  const { position, duration, buffered } = useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  const [scrub, setScrub] = useState<number | null>(null);
  const draft = useRef<number | null>(null), track = useRef<HTMLDivElement>(null), tip = useRef<HTMLSpanElement>(null);
  const commit = () => {
    const value = draft.current;
    if (value === null) return;
    draft.current = null;
    setScrub(null);
    void onSeek(value);
  };
  /** 把时间提示放到轨道上的某个比例处。 */
  const point = (ratio: number) => {
    const element = track.current, label = tip.current;
    if (!element || !label || !duration) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    element.style.setProperty('--hover', clamped * 100 + '%');
    label.textContent = time(clamped * duration);
  };
  const hover = (event: PointerEvent<HTMLDivElement>) => {
    if (draft.current !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width) point((event.clientX - rect.left) / rect.width);
  };
  const shown = scrub ?? position, active = !!duration && enabled;
  const fill = duration ? Math.min(100, Math.max(0, shown / duration * 100)) : 0;
  return <div className="progress">
    <span>{time(shown)}</span>
    <div ref={track} className="progress-track scrubber" data-scrubbing={scrub !== null || undefined} onPointerMove={active ? hover : undefined} style={{ '--fill': fill + '%' } as CSSProperties}>
      <span className="scrubber-rail" aria-hidden="true">
        {buffered.map((range, index) => duration && range.end > range.start ? <span key={index} className="progress-buffer" style={{ left: range.start / duration * 100 + '%', width: (range.end - range.start) / duration * 100 + '%' }}/> : null)}
        <span className="scrubber-preview"/>
        <span className="scrubber-fill"/>
      </span>
      <span className="scrubber-thumb" aria-hidden="true"/>
      <span ref={tip} className="scrubber-tip" aria-hidden="true"/>
      <input aria-label="播放进度" aria-valuetext={time(shown) + ' / ' + time(duration)} type="range" min="0" max={duration ?? 0} step=".1" value={duration ? Math.min(shown, duration) : position} disabled={!active}
        onChange={event => { draft.current = Number(event.target.value); setScrub(draft.current); if (duration) point(draft.current / duration); }}
        onPointerUp={() => requestAnimationFrame(commit)} onPointerCancel={() => { draft.current = null; setScrub(null); }}
        onKeyUp={event => { if (event.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }} onBlur={commit}/>
    </div>
    <span>{time(duration)}</span>
  </div>;
}
