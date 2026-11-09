import { PlayIcon } from '@phosphor-icons/react';

export function TrackRowCue({ number, title, playing, disabled, onPlay }: {
  number: string | number;
  title: string;
  playing: boolean;
  disabled: boolean;
  onPlay: () => void;
}) {
  return (
    <button type="button" className="row-number row-play-cue" tabIndex={-1} disabled={disabled}
      aria-label={`播放第 ${number} 首 · ${title}`} onClick={onPlay}>
      <span className="row-index" aria-hidden="true">{number}</span>
      {playing && <span className="row-equalizer" aria-hidden="true"><i /><i /><i /></span>}
      <PlayIcon className="row-play-icon" size={14} weight="fill" aria-hidden="true" />
    </button>
  );
}

export function TrackListSkeleton({ label }: { label: string }) {
  return (
    <div className="track-list-skeleton loading" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div className="track-skeleton-row" key={index} aria-hidden="true"><span /><span /></div>
      ))}
    </div>
  );
}
