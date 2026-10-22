import { useEffect, useRef, useState } from 'react';
import type { Song, SongCatalogRecord, SongLibraryState } from '../server/song-library-types';
import { request, cancelled, errorText } from './api';
import { SongCover } from './SongCover';

export function catalogStatus(song: Song): string {
  const catalog = song.desktopCatalog;
  if (!catalog) return '等待自动匹配目录资料。';
  if (catalog.state === 'matched') return `已${catalog.selection === 'manual' ? '手动选择' : '自动匹配'}网易云目录${catalog.record?.album ? ' · ' + catalog.record.album : ''}`;
  return { review: '有待核对的资料，请搜索并选择对应歌曲。', 'not-found': '暂未找到目录歌曲，继续使用现有资料。', error: '目录暂时无法读取，现有资料保留，可手动重试。', disabled: '已保留来源资料，自动匹配已停止。' }[catalog.state];
}

/** Desktop editor only. Source selection and catalogue selection are separate actions. */
export function SongCatalogPanel({ song, revision, disabled, onChange, onClose }: {
  song: Song; revision: string | null; disabled: boolean; onChange: (state: SongLibraryState) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState([song.title, ...(song.artists ?? [])].join(' '));
  const [candidates, setCandidates] = useState<SongCatalogRecord[]>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => work.current?.abort(), [song.id]);
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setBusy(true); setError('');
    try { await operation(controller.signal); }
    catch (issue) { if (!controller.signal.aborted && !cancelled(issue)) setError(errorText(issue)); }
    finally { if (work.current === controller && !controller.signal.aborted) setBusy(false); }
  };
  const select = (selection: { id: string } | { disabled: true }) => void run(async signal => {
    const saved = await request<SongLibraryState>('/api/song-library/catalog/select', { revision, selection: { songId: song.id, ...selection } }, signal);
    if (!signal.aborted) { onChange(saved); onClose(); }
  });
  return <section className="song-catalog-panel" aria-label="匹配目录资料">
    <p className="muted">选择网易云中的专辑或单曲资料，作为这首歌的统一封面、歌名和歌手。人工修改过的字段继续保留，播放版本由你归组。</p>
    <form className="song-catalog-search" onSubmit={event => { event.preventDefault(); if (!query.trim() || busy || disabled) return; void run(async signal => {
      const result = await request<{ candidates: SongCatalogRecord[] }>('/api/song-library/catalog/search', { query: query.trim() }, signal);
      if (!signal.aborted) setCandidates(result.candidates);
    }); }}><label className="field"><span className="field-label">目录搜索关键词</span><input className="input" aria-label="目录搜索关键词" value={query} maxLength={500} disabled={disabled || busy} onChange={e => setQuery(e.target.value)}/></label><button className="btn btn-secondary" disabled={disabled || busy || !query.trim()}>搜索目录</button></form>
    {busy && <p role="status">正在读取目录… <button className="btn btn-ghost btn-sm" onClick={() => { work.current?.abort(); setBusy(false); }}>取消</button></p>}
    {error && <p className="feedback" role="alert">{error}</p>}
    {candidates && (candidates.length ? <div className="song-catalog-results">{candidates.map(record => <article className="song-catalog-candidate" key={record.id}>
      <SongCover song={{ ...song, artwork: record.artwork }}/><div><strong>{record.title}</strong><p>{record.artists.join(' / ')}</p><small className="muted">{record.album || '专辑未提供'} · 网易云</small><a href={record.url} target="_blank" rel="noreferrer">查看目录来源</a></div>
      <button className="btn btn-secondary btn-sm" aria-label={'采用目录资料 ' + record.title + ' · ' + (record.album ?? record.id)} disabled={disabled || busy} onClick={() => select({ id: record.id })}>采用这份资料</button>
    </article>)}</div> : <p role="status" className="muted">没有找到目录歌曲，可以调整歌名、歌手后重试。</p>)}
    <button className="btn btn-ghost btn-sm" disabled={disabled || busy || song.desktopCatalog?.state === 'disabled'} onClick={() => select({ disabled: true })}>保留来源资料，停止自动匹配</button>
  </section>;
}
