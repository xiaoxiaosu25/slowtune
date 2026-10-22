import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CaretDownIcon, MusicNotesIcon } from '@phosphor-icons/react';
import type { LyricsController } from './useLyrics';
import type { LyricPlayback } from './LyricsView';
import { desktopLyricLines, desktopLyricTime } from './desktop-lyric-data';
import { lyricWords } from './lyric-timing';
import type { mountDesktopLyricEngine } from './desktop-lyric-engine';
import engineUrl from 'virtual:desktop-lyric-engine-url';
import './desktop-lyrics.css';
import { DesktopImmersiveChrome } from './desktop-chrome';
import { useDesktopLyricSize } from './DesktopLyricFont';

export function LyricsToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  const label = active ? '关闭沉浸歌词' : '打开沉浸歌词';
  return <button type="button" className={'btn btn-icon desktop-lyrics-toggle' + (active ? ' saved' : '')} aria-label={label} title={label} aria-pressed={active} onClick={onClick}><span aria-hidden="true">词</span></button>;
}

function LyricBackdrop({ artwork }: { artwork?: string }) {
  const [layers, setLayers] = useState<{ url: string; key: number }[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    let cancelled = false;
    if (!artwork) { setLayers([]); return; }
    const img = new Image(); img.referrerPolicy = 'no-referrer';
    img.onload = () => { if (!cancelled) setLayers(old => [...old.slice(-1), { url: artwork, key: ++sequence.current }]); };
    img.onerror = () => { if (!cancelled) setLayers([]); }; img.src = artwork;
    return () => { cancelled = true; img.onload = img.onerror = null; };
  }, [artwork]);
  return <div className="desktop-lyrics-backdrop" aria-hidden="true">{layers.map(layer => <img key={layer.key} src={layer.url} alt="" referrerPolicy="no-referrer" onAnimationEnd={() => setLayers(old => old.at(-1)?.key === layer.key ? [layer] : old)}/>)}</div>;
}

export function DesktopLyricsView({ lyrics, playback, artwork, visual, songInfo, controls, onSeek, onClose, onManage }: { lyrics: LyricsController; playback: LyricPlayback; artwork?: string; visual: ReactNode; songInfo: ReactNode; controls: ReactNode; onSeek: (seconds: number) => void; onClose: () => void; onManage: (section: 'select' | 'offset') => void }) {
  const fontSize = useDesktopLyricSize();
  const host = useRef<HTMLDivElement>(null), reading = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof mountDesktopLyricEngine> | null>(null);
  const wake = useRef<(seek?: boolean) => void>(() => {});
  const live = useRef({ playback, offset: lyrics.offsetMs, onSeek }); live.current = { playback, offset: lyrics.offsetMs, onSeek };
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0), [browsing, setBrowsing] = useState(false);
  const browseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const document = lyrics.document;
  const synced = document?.synced && !document.instrumental && document.lines.length > 0;
  const resume = () => { clearTimeout(browseTimer.current); setBrowsing(false); engine.current?.resume(); wake.current(true); };
  useEffect(() => { reading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    setFailed(false); setBrowsing(false); clearTimeout(browseTimer.current);
    if (!synced || !document || !host.current) return;
    let cancelled = false, frame = 0, settlingUntil = 0, previous = 0;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fail = () => {
      cancelAnimationFrame(frame); frame = 0;
      engine.current?.dispose(); engine.current = null;
      host.current?.shadowRoot?.replaceChildren();
      if (!cancelled) { setFailed(true); setBrowsing(false); clearTimeout(browseTimer.current); }
    };
    const tick = (now: number, seek = false) => {
      frame = 0;
      if (cancelled || window.document.hidden || !engine.current) return;
      const current = live.current;
      try { engine.current.sync(desktopLyricTime(current.playback.readPosition(), current.offset), current.playback.playing, motion.matches, seek, previous ? Math.min(now - previous, 64) : 0); }
      catch { fail(); return; }
      previous = now;
      if (current.playback.playing || now < settlingUntil) frame = requestAnimationFrame(tick);
    };
    const restart = (seek = false) => { cancelAnimationFrame(frame); previous = 0; settlingUntil = performance.now() + (motion.matches ? 0 : 1200); tick(performance.now(), seek); };
    wake.current = restart;
    const visibility = () => { if (window.document.hidden) { cancelAnimationFrame(frame); frame = 0; } else restart(true); };
    const changed = () => restart(true);
    window.document.addEventListener('visibilitychange', visibility); motion.addEventListener('change', changed);
    const resize = new ResizeObserver(() => restart(true)); resize.observe(host.current);
    const url = new URL(engineUrl, window.location.href);
    if (attempt) url.searchParams.set('retry', String(attempt));
    void (import(/* @vite-ignore */ url.href) as Promise<typeof import('./desktop-lyric-engine')>).then(({ mountDesktopLyricEngine }) => {
      if (cancelled || !host.current) return;
      engine.current = mountDesktopLyricEngine(host.current, desktopLyricLines(document, playback.duration, lyrics.translations), document.lines.map(line => !!lyricWords(line)), desktopLyricTime(live.current.playback.readPosition(), live.current.offset), index => {
        const start = document.lines[index]?.startMs;
        if (start === null || start === undefined) return;
        clearTimeout(browseTimer.current); setBrowsing(false); engine.current?.resume();
        live.current.onSeek(Math.max(0, (start + live.current.offset) / 1000)); restart(true);
      });
      restart(true);
    }).catch(() => { if (!cancelled) fail(); });
    return () => {
      cancelled = true; cancelAnimationFrame(frame); clearTimeout(browseTimer.current); resize.disconnect();
      window.document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', changed);
      engine.current?.dispose(); engine.current = null; wake.current = () => {};
    };
  }, [document, synced, lyrics.translations, playback.duration, attempt]);
  useEffect(() => { wake.current(); }, [playback.playing, playback.position, lyrics.offsetMs, fontSize]);
  const browse = () => {
    if (!synced || failed) return;
    engine.current?.browse(); setBrowsing(true); clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(resume, 5000); wake.current();
  };
  const hasLines = document && !document.instrumental && document.lines.length > 0;
  const status = document?.instrumental ? '纯音乐，安心听' : lyrics.busy ? '正在寻找歌词…' : lyrics.error ? '歌词暂不可用' : '暂无匹配歌词';
  return <section className="desktop-lyrics-view" aria-label="沉浸歌词" style={{ '--desktop-lyric-size': fontSize + 'px' } as CSSProperties}>
    <DesktopImmersiveChrome/>
    <LyricBackdrop artwork={artwork}/>
    <button type="button" className="btn btn-icon desktop-lyrics-close" aria-label="返回普通播放" title="收起歌词模式" onClick={onClose}><CaretDownIcon size={24}/></button>
    <div className="desktop-lyrics-stage">
    <aside className="desktop-lyrics-track" aria-label="当前歌曲">{visual}<div className="desktop-lyrics-song">{songInfo}</div></aside>
    <div className="desktop-lyrics-column">
    <div className="desktop-lyrics-management-tools"><button className="btn btn-ghost btn-sm" onClick={() => onManage('select')}>{hasLines ? '更换歌词' : '查找 / 导入歌词'}</button>{document?.synced && <button className="btn btn-ghost btn-sm" onClick={() => onManage('offset')}>校准时间</button>}</div>
    <div ref={reading} className="desktop-lyrics-reading" tabIndex={-1} aria-label="沉浸歌词正文" onWheelCapture={browse} onKeyDown={event => {
      if (event.defaultPrevented || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key) || !engine.current) return;
      event.preventDefault(); event.stopPropagation(); browse();
      const height = reading.current?.clientHeight ?? 500;
      engine.current.scroll(({ ArrowUp: -80, ArrowDown: 80, PageUp: -height * .8, PageDown: height * .8, Home: -100000, End: 100000 })[event.key]!);
    }}>
      {hasLines && synced && <div ref={host} className="desktop-lyrics-host" hidden={failed}/>}
      {hasLines ? (!synced || failed) && <div className="desktop-lyrics-fallback">
        {failed && <div className="desktop-lyrics-retry" role="status">歌词动效暂不可用<button className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>重试动效</button></div>}
        {document.lines.map((line, index) => <div className="desktop-lyrics-plain-line" key={index}>{line.startMs === null ? <span>{line.text}</span> : <button onClick={() => onSeek(Math.max(0, (line.startMs! + lyrics.offsetMs) / 1000))}>{line.text || '♪'}</button>}{lyrics.translations && line.translation && <small>{line.translation}</small>}</div>)}
      </div> : <div className="desktop-lyrics-empty" role="status"><MusicNotesIcon size={32} weight="thin"/><p>{status}</p>{lyrics.error && <button className="btn btn-ghost" onClick={() => void lyrics.resolve()}>重试读取</button>}</div>}
    </div>
    {browsing && <button className="btn btn-secondary desktop-lyrics-resume" onClick={resume}>回到当前行</button>}
    </div>
    </div>
    <footer className="desktop-lyrics-footer" aria-label="沉浸播放控制"><div className="desktop-lyrics-controls">{controls}</div></footer>
  </section>;
}
