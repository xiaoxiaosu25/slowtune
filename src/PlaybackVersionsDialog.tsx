import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, MagnifyingGlassIcon, PlayIcon, PlusIcon } from '@phosphor-icons/react';
import type { Song, SongLibraryState, SongPlaybackSelection, SongVersion } from '../server/song-library-types';
import { songSearchText, type SearchPage } from '../server/search-policy';
import { key, request, time, errorText, cancelled, type Track } from './api';
import { Modal } from './Modal';
import { versionKinds } from './song-management';
import { VersionStatus } from './VersionStatus';

type Props = {
  onClose: () => void;
  current: Track | null; song?: Song; library: SongLibraryState | null; youtubeEnabled: boolean;
  preparing: boolean; saving: boolean; playbackError: string;
  playbackControl?:ReactNode;
  onPlay: (selection: SongPlaybackSelection, song: Pick<Song, 'title' | 'artists' | 'artwork'>) => Promise<unknown>;
  onSave: (track: Track, song?: Song) => Promise<unknown> | void; onDefault: (song: Song, version: SongVersion) => Promise<unknown>;
};

export function PlaybackVersionsDialog(props: Props) {
  return <Modal title="播放版本" className="playback-versions-dialog" onClose={props.onClose}><p className="playback-versions-title">{props.song?.title||props.current?.title||'等待音乐'}</p><div className="playback-versions-body"><PlaybackVersions {...props}/></div><footer className="playback-versions-footer"><div className="playback-versions-context">{props.playbackControl}<span>试听只切换当前播放，设为默认需单独操作。</span></div><button className="btn btn-secondary" onClick={props.onClose}>完成</button></footer></Modal>;
}

function PlaybackVersions({ current, song, library, youtubeEnabled, preparing, saving, playbackError, onPlay, onSave, onDefault }: Props) {
  const [searching, setSearching] = useState(false), [query, setQuery] = useState(''), [provider, setProvider] = useState<'bilibili' | 'youtube'>('bilibili');
  const [results, setResults] = useState<Track[]>([]), [cursor, setCursor] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState('');
  const work = useRef<AbortController | null>(null);
  useEffect(() => {
    work.current?.abort(); setSearching(false); setResults([]); setCursor(undefined); setError(''); setBusy(false);
    setQuery(current ? songSearchText(song ?? current) : '');
    return () => work.current?.abort();
  }, [current?.resourceId]);
  useEffect(() => { if (!youtubeEnabled && provider === 'youtube') { work.current?.abort(); setProvider('bilibili'); setResults([]); setCursor(undefined); setBusy(false); } }, [youtubeEnabled, provider]);
  const search = async (next?: string) => {
    if (!query.trim()) return;
    work.current?.abort(); const controller = new AbortController(); work.current = controller; setBusy(true); setError('');
    try {
      const text = next ? searched : query.trim();
      const value = await request<SearchPage>('/api/search', { provider, query: text, ...(next ? { cursor: next } : {}), song: { title: song?.title ?? current?.title ?? text, artists: song?.artists ?? current?.artists } }, AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]));
      if (!controller.signal.aborted) { setResults(old => next ? [...old, ...value.items.filter(item => !old.some(saved => key(saved.ref) === key(item.ref)))] : value.items); setCursor(value.nextCursor); setSearched(text); }
    } catch (issue) { if (!controller.signal.aborted && !cancelled(issue)) setError(errorText(issue)); }
    finally { if (work.current === controller) setBusy(false); }
  };
  const versions = library?.snapshot.versions.filter(version => version.songId === song?.id) ?? [];
  const display = song ?? current;
  if (!current || !display) return <p className="muted">播放音乐后，可在这里选择版本。</p>;
  const blocked = (ref: Track['ref']) => ref.provider === 'youtube' && !youtubeEnabled;
  const play = (selection: SongPlaybackSelection) => void onPlay(selection, display);
  return <div className="playback-versions">
    {!searching ? <>
      <button className="btn btn-secondary" onClick={() => setSearching(true)}><MagnifyingGlassIcon size={18}/>搜索其他版本</button>
      {!song && <div className="playback-version-card"><strong>当前音源</strong><p>{current.sourceTitle ?? current.title}</p><small>{current.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {current.uploader?.name || '作者未提供'} · {time(current.durationSeconds)}</small><button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void onSave(current)}><PlusIcon size={16}/>归入歌曲并保存版本</button></div>}
      {song && !versions.length && <p className="muted">还没有保存播放版本，可以搜索后添加。</p>}
      {versions.map(version => <article className={'playback-version-card' + (key(version.ref) === key(current.ref) ? ' is-current' : '')} key={version.id}>
        <div className="playback-version-heading"><strong>{version.label || versionKinds[version.kind]}</strong><VersionStatus version={version}/></div>
        <div className="playback-version-markers">{key(version.ref) === key(current.ref) && <span>正在播放</span>}{song?.defaultVersionId === version.id && <span>默认版本</span>}</div>
        <p>{version.performers?.join(' / ') || version.facts.artists?.join(' / ') || song?.artists?.join(' / ') || '演唱者未提供'} · {time(version.facts.durationSeconds)}</p>
        <small>{version.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {version.facts.uploader || '作者未提供'}</small>
        <details><summary>来源完整标题</summary><p>{version.facts.title}</p></details>
        <div className="playback-version-actions"><button className="btn btn-secondary btn-sm" disabled={preparing || blocked(version.ref) || key(version.ref) === key(current.ref)} onClick={() => play({ kind: 'song', songId: version.songId, explicitVersionId: version.id })}><PlayIcon size={16}/>播放此版本</button><button className="btn btn-ghost btn-sm" disabled={saving || song?.defaultVersionId === version.id} onClick={() => song && void onDefault(song, version)}>设为默认</button></div>
      </article>)}
    </> : <>
      <button className="btn btn-ghost btn-sm" onClick={() => setSearching(false)}><ArrowLeftIcon size={16}/>返回已保存版本</button>
      <form className="playback-version-search" onSubmit={event => { event.preventDefault(); void search(); }}><label className="field"><span className="field-label">搜索其他播放版本</span><input className="input" aria-label="版本搜索关键词" maxLength={512} value={query} onChange={event => setQuery(event.target.value)}/></label><div className="toolbar">{youtubeEnabled && <select className="select" aria-label="版本搜索来源" value={provider} onChange={event => { work.current?.abort(); setBusy(false); setResults([]); setCursor(undefined); setProvider(event.target.value as 'bilibili' | 'youtube'); }}><option value="bilibili">B站</option><option value="youtube">YouTube</option></select>}<button className="btn btn-primary" disabled={busy || !query.trim()}><MagnifyingGlassIcon size={17}/>搜索</button></div></form>
      <p className="muted">先试听，喜欢的再保存为歌曲版本。</p>
      {results.map(track => { const saved = library?.snapshot.versions.find(version => key(version.ref) === key(track.ref)), isCurrent = key(current.ref) === key(track.ref); return <article className="playback-version-card" key={key(track.ref)}><strong>{track.title}</strong><p>{track.artists?.join(' / ') || '演唱者未提供'} · {time(track.durationSeconds)}</p><small>{track.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {track.uploader?.name || '作者未提供'}{isCurrent ? ' · 正在播放' : ''}</small><div className="playback-version-actions"><button className="btn btn-secondary btn-sm" disabled={preparing || blocked(track.ref) || isCurrent} onClick={() => play({ kind: 'source', ref: track.ref as SongVersion['ref'], ...(song ? { songId: song.id } : {}) })}><PlayIcon size={16}/>试听</button><button className="btn btn-ghost btn-sm" disabled={saving || !!saved || blocked(track.ref)} onClick={() => void onSave(track, song)}><PlusIcon size={16}/>{saved ? '已保存版本' : '保存版本'}</button></div></article>; })}
      {!busy && searched && !results.length && !error && <p role="status">没有找到版本，请调整关键词。</p>}
      {cursor && <button className="btn btn-secondary" disabled={busy} onClick={() => void search(cursor)}>加载更多版本</button>}
    </>}
    {busy && <p role="status">正在搜索版本… <button className="btn btn-ghost btn-sm" onClick={() => { work.current?.abort(); setBusy(false); }}>取消</button></p>}
    {(error || playbackError) && <p className="feedback" data-tone="error" role="alert">{error || playbackError}</p>}
  </div>;
}
