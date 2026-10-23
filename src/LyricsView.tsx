import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MusicNotesIcon } from '@phosphor-icons/react';
import { activeLyricLine } from '../server/lyrics-format';
import type { LyricDocument, LyricLine } from '../server/lyrics-types';
import { time } from './api';
import { lyricFill, lyricWords } from './lyric-timing';
import type { LyricsController } from './useLyrics';

export interface LyricPlayback {
  position: number;
  duration?: number;
  playing: boolean;
  readPosition: () => number;
  subscribePosition?: (listener: () => void) => () => void;
}

function LyricText({ line, index, current }: { line: LyricLine; index: number; current: boolean }) {
  const words = lyricWords(line);
  return <span className={'lyric-text' + (current ? ' is-current' : '')} data-lyric-index={index}>
    {words ? words.map((word, wordIndex) => <span className="lyric-ink" key={wordIndex} data-word-index={wordIndex}>{word.text}</span>) : <span className="lyric-ink">{line.text || '♪'}</span>}
  </span>;
}

/** Paint only the current line; update line state at boundaries, never once per frame. */
function useLyricPlayback(document: LyricDocument | null | undefined, offsetMs: number, playback: LyricPlayback, root: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1), paintRef = useRef<() => void>(() => {});
  useEffect(() => {
    let frame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion:reduce)');
    const paint = () => {
      const position = playback.readPosition();
      const index = document ? activeLyricLine(document.lines, position, offsetMs) : -1;
      if (activeRef.current !== index) { activeRef.current = index; setActive(index); }
      const line = root.current?.querySelector<HTMLElement>(`.lyric-text[data-lyric-index="${index}"]`);
      line?.querySelectorAll<HTMLElement>('.lyric-ink').forEach(ink => {
        const wordIndex = ink.dataset.wordIndex === undefined ? undefined : Number(ink.dataset.wordIndex);
        const fill = document ? lyricFill(document.lines, index, position * 1000 - offsetMs, playback.duration ? playback.duration * 1000 - offsetMs : undefined, wordIndex) : 0;
        ink.style.setProperty('--lyric-fill', (fill * 100).toFixed(2) + '%');
      });
    };
    paintRef.current = paint;
    const tick = () => {
      paint();
      if (playback.playing && !window.document.hidden && !reduced.matches && document?.synced) frame = requestAnimationFrame(tick);
    };
    const restart = () => { cancelAnimationFrame(frame); tick(); };
    restart();
    const unsubscribe = playback.subscribePosition?.(paint);
    window.document.addEventListener('visibilitychange', restart); reduced.addEventListener('change', restart);
    return () => { unsubscribe?.(); cancelAnimationFrame(frame); window.document.removeEventListener('visibilitychange', restart); reduced.removeEventListener('change', restart); };
  }, [document, offsetMs, playback.position, playback.duration, playback.playing, playback.readPosition, playback.subscribePosition, root]);
  useLayoutEffect(() => { paintRef.current(); }, [active]);
  return active;
}

function statusText(lyrics: LyricsController) {
  return lyrics.document?.instrumental ? '纯音乐，安心听' : lyrics.busy === '匹配' || lyrics.busy === '读取' ? '正在寻找歌词…' : lyrics.error ? '歌词暂不可用' : '暂无匹配歌词';
}

export function BottomLyrics({ lyrics, playback, compact = false }: { lyrics: LyricsController; playback: LyricPlayback; compact?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const active = useLyricPlayback(lyrics.document, lyrics.offsetMs, playback, root);
  const document = lyrics.document;
  const index = Math.max(0, active), current = document?.lines[index], next = document?.lines[index + 1];
  return <section ref={root} className={'bottom-lyrics' + (compact ? ' is-compact' : '')} aria-label="底部歌词">
    {!document || document.instrumental || !current ? <p className="bottom-lyrics-status" role="status"><MusicNotesIcon size={16}/>{statusText(lyrics)}</p> : <div className="bottom-lyrics-lines" key={lyrics.sourceKey + ':' + document.id + ':' + index}>
      <p className="bottom-lyrics-current" title={current.text}><LyricText line={current} index={index} current={active >= 0}/></p>
      <p className="bottom-lyrics-next">{document.synced && active < 0 ? '前奏 · ' : ''}{lyrics.translations && current.translation ? current.translation : next?.text || (document.synced ? '♪' : '纯文本歌词')}</p>
    </div>}
  </section>;
}

export function LyricsView({ lyrics, playback, onSeek }: { lyrics: LyricsController; playback: LyricPlayback; onSeek: (seconds: number) => void }) {
  const root = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [follow, setFollow] = useState(true);
  const active = useLyricPlayback(lyrics.document, lyrics.offsetMs, playback, root);
  const document = lyrics.document;
  const resume = () => { clearTimeout(timer.current); setFollow(true); };
  const browse = () => {
    if (!document?.synced) return;
    clearTimeout(timer.current); setFollow(false); timer.current = setTimeout(() => setFollow(true), 5000);
  };
  useEffect(() => { resume(); return () => clearTimeout(timer.current); }, [lyrics.sourceKey, document?.id]);
  useEffect(() => {
    const container = scroll.current;
    if (!follow || !container || !document?.synced) return;
    const center = (smooth: boolean) => {
      const line = container.querySelector<HTMLElement>('[aria-current="true"]') ?? container.querySelector<HTMLElement>('li');
      if (!line) return;
      container.style.setProperty('--lyrics-padding', Math.max(0, (container.clientHeight - line.clientHeight) / 2) + 'px');
      const top = line.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - (container.clientHeight - line.clientHeight) / 2;
      container.scrollTo({ top, behavior: smooth && !window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'smooth' : 'instant' });
    };
    center(true);
    let width = container.clientWidth, height = container.clientHeight;
    const resize = new ResizeObserver(() => {
      const nextWidth = container.clientWidth, nextHeight = container.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth; height = nextHeight; center(false);
    }); resize.observe(container);
    return () => resize.disconnect();
  }, [active, follow, document, lyrics.translations]);
  return <section ref={root} className="lyrics-panel" aria-label="当前版本歌词">
    {!document || document.instrumental || !document.lines.length ? <div className="lyrics-empty"><MusicNotesIcon size={32} weight="thin"/><p role="status">{statusText(lyrics)}</p></div> : <>
      <div className="lyrics-scroll" ref={scroll} tabIndex={0} aria-label="歌词正文" onWheel={browse} onTouchStart={browse} onTouchMove={browse} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) { browse(); event.stopPropagation(); } }}>
        <ol>{document.lines.map((line, index) => <li key={index} aria-current={active === index ? 'true' : undefined} className={(line.startMs === null ? 'unsynced ' : '') + (index < active ? 'is-past' : '')}>
          {line.startMs === null ? <span>{line.text}</span> : <button type="button" title={'跳转到 ' + time(Math.max(0, (line.startMs + lyrics.offsetMs) / 1000))} onClick={() => { resume(); onSeek(Math.max(0, (line.startMs! + lyrics.offsetMs) / 1000)); }}><LyricText line={line} index={index} current={active === index}/></button>}
          {lyrics.translations && line.translation && <small>{line.translation}</small>}
        </li>)}</ol>
      </div>
      {!follow && <button className="btn btn-ghost lyrics-resume" onClick={resume}>回到当前行</button>}
      {document.synced && active < 0 && <span className="lyrics-intro">前奏 · 等待歌词</span>}
    </>}
  </section>;
}
