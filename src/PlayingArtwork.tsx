import { preferenceStorage } from './preference-storage';
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { ArrowClockwiseIcon, MusicNotesIcon } from '@phosphor-icons/react';
import type { PlaybackAudioAnalysis } from './audio-analysis';
import { PlayingSpectrum } from './PlayingSpectrum';

export type PlayingVisualMode = 'vinyl' | 'original' | 'square' | 'disc' | 'spectrum' | 'halo' | 'lyrics';
export const playingVisualStorageKey = 'slow-listening:playing-visual:v1';
const modes: PlayingVisualMode[] = ['vinyl', 'original', 'square', 'disc', 'spectrum', 'halo', 'lyrics'];
const names: Record<PlayingVisualMode, string> = { vinyl: '唱片', original: '原图', square: '方形', disc: '圆形', spectrum: '音波', halo: '音环', lyrics: '歌词' };
function readMode(): PlayingVisualMode {
  try { const saved = preferenceStorage().getItem(playingVisualStorageKey); return modes.find(mode => mode === saved) ?? 'vinyl'; }
  catch { return 'vinyl'; }
}
const noSubscription = () => () => {};
const idleAnalysis = () => 'idle' as const;

function VinylLabel() {
  return <>
    <span className="vinyl-label">
      <span className="vinyl-label-brand">SLOWTUNE</span>
      <span className="vinyl-label-title">慢 听</span>
      <span className="vinyl-label-side">SIDE A <span>33⅓ RPM</span></span>
      <span className="vinyl-label-edition">STEREO · ORIGINAL RECORDING</span>
    </span>
    <span className="vinyl-spindle"/>
  </>;
}

export function PlayingArtwork({ artwork, playing, muted, analysis, lyrics, allowLyrics = true, suspended = false, desktop = false }: {
  artwork?: string; playing: boolean; muted: boolean; analysis: PlaybackAudioAnalysis | null; lyrics?: ReactNode; allowLyrics?: boolean; suspended?: boolean; desktop?: boolean;
}) {
  const [storedMode, setMode] = useState<PlayingVisualMode>(readMode);
  const mode = !allowLyrics && storedMode === 'lyrics' ? 'vinyl' : storedMode;
  const [failed, setFailed] = useState('');
  const [dimensions, setDimensions] = useState({ url: '', ratio: 16 / 9 });
  const [visible, setVisible] = useState(() => !document.hidden);
  const state = useSyncExternalStore(analysis?.subscribe ?? noSubscription, analysis?.getSnapshot ?? idleAnalysis);
  // The desktop lyric view shares this preference; refresh the retained normal view on return.
  useEffect(() => { if (desktop && !suspended) setMode(readMode()); }, [desktop, suspended]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== playingVisualStorageKey && event.key !== null) return;
      try { if (event.storageArea === preferenceStorage()) setMode(readMode()); } catch { /* Session preference stays usable. */ }
    };
    const visibility = () => setVisible(!document.hidden);
    window.addEventListener('storage', sync); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    analysis?.request(!suspended && (mode === 'spectrum' || mode === 'halo'));
    return () => analysis?.request(false);
  }, [mode, analysis, suspended]);
  const availableModes = allowLyrics ? modes : modes.filter(value => value !== 'lyrics');
  const next = availableModes[(availableModes.indexOf(mode) + 1) % availableModes.length];
  const cycle = () => {
    if (next === 'spectrum' || next === 'halo') analysis?.request(true, true);
    setMode(next);
    try { preferenceStorage().setItem(playingVisualStorageKey, next); } catch { /* Apply for this session if storage is blocked. */ }
  };
  const hasArtwork = !!artwork && failed !== artwork;
  const image = () => hasArtwork ? <img className="playing-art" src={artwork} alt="" referrerPolicy="no-referrer" draggable={false}
    onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setDimensions({ url: artwork, ratio: naturalWidth / naturalHeight }); }}
    onError={() => setFailed(artwork)}/> : <span className="playing-art unknown-cover"><MusicNotesIcon size={60}/></span>;
  const ratio = hasArtwork && dimensions.url === artwork ? dimensions.ratio : 16 / 9;
  const message = state === 'unavailable' ? '当前环境暂不支持实时音波' : state !== 'ready' ? '点击播放后显示实时音波' : '';
  if (mode === 'lyrics') return <div className="playing-art-slot playing-lyrics-slot">
    <div className="playing-art-lyrics">{lyrics ?? <p className="muted">播放音乐后自动显示歌词</p>}</div>
    <button type="button" className="btn btn-ghost playing-art-switch lyrics-style-switch" data-visual-mode={mode} aria-label="封面样式：歌词，点击切换为唱片" onClick={cycle}><ArrowClockwiseIcon size={15}/>歌词 · 切换样式</button>
  </div>;
  return <div className="playing-art-slot">
    <button type="button" className="playing-art-switch" data-visual-mode={mode} data-analysis-state={state}
      aria-label={`封面样式：${names[mode]}，点击切换为${names[next]}`} onClick={cycle}
      style={{ '--artwork-ratio': ratio } as CSSProperties}>
      <span className={'playing-art-layer playing-art-vinyl' + (mode === 'vinyl' ? ' is-active' : '') + (mode === 'vinyl' && playing && visible ? ' is-playing' : '')} aria-hidden="true">
        <span className="vinyl-record"><span className="vinyl-rotor">
          <img className="vinyl-material" src="/assets/vinyl-black-red.webp" alt="" draggable={false}/>
          <VinylLabel/>
        </span><span className="vinyl-sheen"/></span>
      </span>
      <span className={'playing-art-layer playing-art-original' + (mode === 'original' ? ' is-active' : '')} aria-hidden="true"><span className="playing-art-frame">{image()}</span></span>
      <span className={'playing-art-layer playing-art-square' + (mode === 'square' ? ' is-active' : '')} aria-hidden="true"><span className="playing-art-frame">{image()}</span></span>
      <span className={'playing-art-layer playing-art-disc' + (mode === 'disc' ? ' is-active' : '') + (mode === 'disc' && playing && visible ? ' is-playing' : '')} aria-hidden="true"><span className="playing-art-frame">{image()}</span></span>
      <span className={'playing-art-layer playing-art-frequency' + (mode === 'spectrum' ? ' is-active' : '')} aria-hidden="true">
        <PlayingSpectrum active={mode === 'spectrum' && !(desktop && suspended)} playing={playing} muted={muted} analysis={analysis} state={state}/>
      </span>
      <span className={'playing-art-layer playing-art-halo' + (mode === 'halo' ? ' is-active' : '')} aria-hidden="true">
        <PlayingSpectrum variant="halo" active={mode === 'halo' && !(desktop && suspended)} playing={playing} muted={muted} analysis={analysis} state={state}/>
        <span className="playing-halo-core"><VinylLabel/></span>
      </span>
      <span className="playing-art-hint" aria-hidden="true">{names[mode]}<span className="playing-art-hint-cue"> · 点击切换</span><ArrowClockwiseIcon size={14}/></span>
      {(mode === 'spectrum' || mode === 'halo') && message && <span className="playing-spectrum-status" role="status">{message}</span>}
    </button>
  </div>;
}
