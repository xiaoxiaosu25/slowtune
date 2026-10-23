import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { time } from './api';
import type { PlaybackClock } from './playback-clock';

export function DesktopPlaybackProgress({ clock, enabled, onSeek }: { clock: PlaybackClock; enabled: boolean; onSeek: (seconds: number) => unknown }) {
  const { position, duration, buffered } = useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  const [scrub, setScrub] = useState<number | null>(null);
  const draft = useRef<number | null>(null);
  const commit = () => {
    const value = draft.current;
    if (value === null) return;
    draft.current = null;
    setScrub(null);
    void onSeek(value);
  };
  const shown = scrub ?? position;
  return <div className="progress">
    <span>{time(shown)}</span>
    <div className="progress-track">
      {buffered.map((range, index) => duration && range.end > range.start ? <span key={index} className="progress-buffer" style={{ left: range.start / duration * 100 + '%', width: (range.end - range.start) / duration * 100 + '%' }}/> : null)}
      <input aria-label="播放进度" aria-valuetext={time(shown) + ' / ' + time(duration)} type="range" min="0" max={duration ?? 0} step=".1" value={duration ? Math.min(shown, duration) : position} disabled={!duration || !enabled} style={{ '--fill': (duration ? Math.min(100, Math.max(0, shown / duration * 100)) : 0) + '%' } as CSSProperties}
        onChange={event => { draft.current = Number(event.target.value); setScrub(draft.current); }}
        onPointerUp={() => requestAnimationFrame(commit)} onPointerCancel={() => { draft.current = null; setScrub(null); }}
        onKeyUp={event => { if (event.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }} onBlur={commit}/>
    </div>
    <span>{time(duration)}</span>
  </div>;
}
