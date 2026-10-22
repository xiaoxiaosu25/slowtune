import { useEffect, useId, useRef, useState } from 'react';
import { ArrowSquareOutIcon, CaretRightIcon, CopyIcon, TelevisionSimpleIcon, YoutubeLogoIcon } from '@phosphor-icons/react';
import type { MusicEntry } from '@studio/music-sources';
import type { SongVersion } from '../server/song-library-types';
import { key, type Track } from './api';
import type { PartMetadataStore } from './multipart';

/** Source details are fetched on demand, independently of the projected song title. */
export function PlaybackSource({ track, version, store, onVersions, versionsOpen }: { track: Track; version?: SongVersion; store: PartMetadataStore; onVersions: () => void; versionsOpen: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), anchor = useRef<HTMLDivElement>(null), showing = useRef(false);
  const [metadata, setMetadata] = useState<MusicEntry>(), [copied, setCopied] = useState(false), [issue, setIssue] = useState('');
  const sourceKey = key(track.ref);
  useEffect(() => {
    const controller = new AbortController(), element = panel.current;
    setMetadata(undefined); setCopied(false); setIssue('');
    const place = () => {
      if (!element || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      element.style.left = Math.max(12, Math.min(rect.left, innerWidth - Math.min(360, innerWidth - 24) - 12)) + 'px';
      element.style.maxHeight = Math.max(80, innerHeight - rect.bottom - 24) + 'px';
      element.style.top = rect.bottom + 8 + 'px';
    };
    const opening = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      place();
      void store.read(track.ref, controller.signal).then(value => { if (!controller.signal.aborted) setMetadata(value); }).catch(() => { if (!controller.signal.aborted) setIssue('来源详情暂不可用，可打开原视频查看。'); });
    };
    const dismiss = () => { if (element?.matches(':popover-open')) element.hidePopover(); };
    element?.addEventListener('beforetoggle', opening); window.addEventListener('resize', dismiss);
    return () => { controller.abort(); clearTimeout(timer.current); element?.removeEventListener('beforetoggle', opening); window.removeEventListener('resize', dismiss); dismiss(); };
  }, [sourceKey, store]);
  const show = () => {
    clearTimeout(timer.current);
    if (!showing.current && panel.current?.isConnected && !panel.current.matches(':popover-open')) {
      showing.current = true;
      try { panel.current.showPopover(); } finally { showing.current = false; }
    }
  };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!anchor.current?.contains(document.activeElement) && !panel.current?.matches(':hover')) panel.current?.hidePopover(); }, 180); };
  const originalTitle = version?.facts.title || track.sourceTitle || metadata?.title || (!track.songId ? track.title : undefined);
  const parts = metadata?.parts ?? store.peek(track.ref.id)?.parts;
  const part = parts?.find(value => value.ref.part === track.ref.part);
  const url = part?.url || metadata?.url || version?.facts.url || track.url || (track.ref.provider === 'bilibili' ? 'https://www.bilibili.com/video/' + track.ref.id : 'https://www.youtube.com/watch?v=' + track.ref.id);
  const provider = track.ref.provider === 'bilibili' ? 'B站' : 'YouTube', Icon = track.ref.provider === 'bilibili' ? TelevisionSimpleIcon : YoutubeLogoIcon;
  const copy = async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(url);
      else {
        const field = document.createElement('textarea'); field.value = url; field.style.cssText = 'position:fixed;opacity:0;pointer-events:none'; panel.current?.append(field); field.select();
        try { if (!document.execCommand('copy')) throw new Error('copy'); } finally { field.remove(); trigger.current?.focus({ preventScroll: true }); }
      }
      setCopied(true);
    } catch { setIssue('复制失败，请从原视频复制链接。'); }
  };
  return <div ref={anchor} className="playback-source" onPointerEnter={() => { clearTimeout(timer.current); timer.current = setTimeout(show, 250); }} onPointerLeave={leave} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>
    <button ref={trigger} type="button" className="playback-source-trigger" aria-label="查看歌曲来源" aria-controls={id} popoverTarget={id} onFocus={() => { clearTimeout(timer.current); timer.current = setTimeout(show, 0); }} onClick={event => { event.preventDefault(); show(); }}><Icon size={15}/>来源 · {provider}<ArrowSquareOutIcon size={12}/></button>
    <div ref={panel} id={id} popover="auto" className="playback-source-card" aria-label="歌曲来源详情" onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
      <strong>{originalTitle || '来源标题未提供'}</strong>
      <dl><dt>平台</dt><dd>{provider}</dd><dt>{track.ref.provider === 'bilibili' ? 'UP主' : '作者'}</dt><dd>{version?.facts.uploader || metadata?.uploader?.name || track.uploader?.name || '未提供'}</dd>
        {track.ref.part && <><dt>分P</dt><dd>{part?.title || track.ref.part}</dd></>}
      </dl>
      {issue && <p className="muted">{issue}</p>}
      <div className="playback-source-actions"><a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={16}/>打开原视频</a><button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}><CopyIcon size={16}/>{copied ? '已复制' : '复制链接'}</button></div>
      <div className="playback-source-version"><button type="button" className="btn btn-ghost" aria-label="选择播放版本" aria-haspopup="dialog" aria-expanded={versionsOpen} onClick={() => { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); clearTimeout(timer.current); onVersions(); }}>选择版本<CaretRightIcon size={16}/></button></div>
    </div>
  </div>;
}
