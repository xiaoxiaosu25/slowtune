import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HeartIcon, ListBulletsIcon, PlayIcon, QueueIcon } from '@phosphor-icons/react';
import { selectMusicParts, type MusicEntry } from '@studio/music-sources';
import type { SongPlaylist as Playlist, SongDuplicatePolicy as DuplicatePolicy } from '../server/song-library-types';
import type { MusicActionIntent, PartPlaybackMode } from './multipart';
import { PagedList } from './Pagination';

export type PartBatchAction = 'favorite' | 'unfavorite' | 'add-entries' | 'create-playlist';
interface Props {
  track: MusicEntry; parts: MusicEntry[]; playlists: Playlist[]; busy: boolean; loading: boolean;
  intent: MusicActionIntent; targetId?: string; anchorId?: string; step?:number; decisionStale: boolean; preference?: PartPlaybackMode;
  intro: ReactNode; more: ReactNode; feedback: ReactNode;
  isFavorite: (entry: MusicEntry) => boolean; renderRow: (entry: MusicEntry) => ReactNode;
  playSingle: () => Promise<unknown>; addSingle: () => Promise<unknown>; favoriteSingle: () => void;
  play: (entries: MusicEntry[]) => Promise<unknown>; add: (entries: MusicEntry[]) => Promise<unknown>;
  save: (action: PartBatchAction, entries: MusicEntry[], options?: { playlistId?: string; duplicates?: DuplicatePolicy; name?: string }) => Promise<unknown>;
  choose: (mode: PartPlaybackMode) => Promise<unknown>; changePreference: (mode: PartPlaybackMode) => void;
}
type View = MusicActionIntent | 'destination';

/** Selection, destination and scroll survive every step within the same media dialog. */
export function PartsPanel({ track, parts, playlists, busy, loading, intent, targetId, anchorId, step, decisionStale, preference, intro, more, feedback, isFavorite, renderRow, playSingle, addSingle, favoriteSingle, play, add, save, choose, changePreference }: Props) {
  const [view, setView] = useState<View>(intent), [custom, setCustom] = useState(false);
  const [selected, setSelected] = useState<string[]>(track.ref.part ? [track.ref.part] : []);
  const selectionInitialized=useRef(!!track.ref.part);
  useEffect(()=>{if(!selectionInitialized.current&&track.ref.part){selectionInitialized.current=true;setSelected([track.ref.part]);}},[track.ref.part]);
  const [target, setTarget] = useState(targetId ?? playlists[0]?.id ?? 'new'), [duplicates, setDuplicates] = useState<DuplicatePolicy>('skip'), [name, setName] = useState(''), [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null), scroll = useRef<Partial<Record<View, number>>>({});
  const switchView = (next: View) => { scroll.current[view] = body.current?.scrollTop ?? 0; setView(next); };
  useEffect(() => { scroll.current[view]=body.current?.scrollTop??0;setView(intent); }, [intent, anchorId, step]);
  useEffect(() => { if (targetId) setTarget(targetId); }, [targetId]);
  useEffect(() => { if (body.current) body.current.scrollTop = scroll.current[view] ?? 0; }, [view]);
  const all = useMemo(()=>parts.length ? selectMusicParts({ ...track, parts }, { mode: 'all' }) : [track],[parts,track]);
  const single = all.find(entry => entry.ref.part === track.ref.part) ?? all[0];
  const chosen = all.filter(entry => selected.includes(entry.ref.part!));
  const multiple = all.length > 1, saved = all.filter(isFavorite).length, showList = view === 'parts' || custom && ['favorite','playlist','enqueue'].includes(view);
  const toggle = (part: string) => setSelected(previous => previous.includes(part) ? previous.filter(value => value !== part) : [...previous, part]);
  const finished = async (work: Promise<unknown>) => { if (await work) switchView('overview'); };
  const savePlaylist = (entries: MusicEntry[]) => save(target === 'new' ? 'create-playlist' : 'add-entries', entries, { playlistId: target === 'new' ? undefined : target, duplicates, name: name.trim() });
  const commit = (entries: MusicEntry[]) => view === 'favorite' ? save('favorite', entries) : view === 'enqueue' ? add(entries) : savePlaylist(entries);
  const actionName = view === 'favorite' ? '收藏' : view === 'enqueue' ? '加入队列' : '添加';
  const disabled = busy || loading, playlistInvalid = view === 'playlist' && (target === 'new' ? !name.trim() : !playlists.some(playlist => playlist.id === target));
  return <>
    <div className="music-action-content" ref={body}>
      {intro}
      {loading && <p className="muted" role="status">正在读取分 P 信息…</p>}
      {view !== 'overview' && view !== 'play-choice' && <button className="btn btn-ghost btn-sm action-back" disabled={busy} onClick={() => switchView('overview')}>返回歌曲操作</button>}
      {view === 'play-choice' && <div className="part-play-decision"><p>这个视频包含 <strong>{all.length} 个分 P</strong>，是否接着播放整组？</p><p className="muted">整组按原顺序入队，当前歌曲继续播放；选择会记住到这个视频。</p>{decisionStale && <p className="error-text" role="status">当前歌曲已切换，请重新点播后选择。</p>}</div>}
      {view === 'overview' && <>
        {multiple && <div className="part-overview"><button className="btn btn-secondary" onClick={() => switchView('parts')}><ListBulletsIcon size={18}/>{all.length} 个分 P · 查看整组</button><p className="muted">已收藏 {saved}/{all.length}</p><fieldset className="part-preference"><legend>这个视频的播放偏好</legend><div className="segmented"><button type="button" className={preference === 'single' ? 'selected' : ''} aria-pressed={preference === 'single'} onClick={() => changePreference('single')}>本 P</button><button type="button" className={preference === 'all' ? 'selected' : ''} aria-pressed={preference === 'all'} onClick={() => changePreference('all')}>整组顺序播放</button></div>{!preference && <small className="muted">首次点播时询问</small>}</fieldset></div>}
        <div className="music-more">{more}</div>
      </>}
      {view === 'destination' && <div className="action-destinations"><p>添加选中的 {chosen.length} 首到</p><button className="btn btn-secondary" onClick={() => switchView('favorite')}><HeartIcon size={18}/>我的收藏</button><button className="btn btn-secondary" onClick={() => switchView('enqueue')}><QueueIcon size={18}/>播放队列</button><button className="btn btn-secondary" onClick={() => switchView('playlist')}><ListBulletsIcon size={18}/>歌单</button></div>}
      {view === 'playlist' && <div className="parts-playlist">
        <label className="field"><span className="field-label">目标歌单</span><select className="select" aria-label="分 P 目标歌单" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>{playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}<option value="new">新建歌单</option></select></label>
        {target === 'new' && <label className="field"><span className="field-label">歌单名称</span><input className="input" aria-label="分 P 新歌单名称" maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="为这些歌曲起个名字"/></label>}
        <details className="duplicate-options"><summary>重复处理 · {duplicates === 'skip' ? '跳过重复' : duplicates === 'allow' ? '允许重复' : '全部拒绝'}</summary><label className="field"><span className="field-label">重复条目</span><select className="select" aria-label="分 P 重复处理" value={duplicates} disabled={busy} onChange={event => setDuplicates(event.target.value as DuplicatePolicy)}><option value="skip">跳过重复</option><option value="allow">允许重复</option><option value="reject">遇到重复时全部拒绝</option></select></label></details>
      </div>}
      {['favorite', 'playlist', 'enqueue'].includes(view) && multiple && !custom && <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => { setCustom(true); if (!selected.length && single.ref.part) setSelected([single.ref.part]); }}>选择部分分 P</button>}
      {showList && <section className="parts-panel" aria-label="分 P 批量选择">
        <div className="toolbar parts-toolbar"><strong role="status">已选 {chosen.length}/{all.length}</strong><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setSelected(all.map(entry => entry.ref.part!))}>全选分 P</button><button className="btn btn-ghost btn-sm" disabled={disabled || !selected.length} onClick={() => setSelected([])}>清空选择</button><button className="btn btn-ghost btn-sm" disabled={disabled || !saved} onClick={() => setSelected(all.filter(isFavorite).map(entry => entry.ref.part!))}>选择已收藏</button></div>
        <label className="field part-search"><span className="field-label">搜索分 P</span><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="歌曲名或 P 序号"/></label>
        <PagedList id={'parts:'+track.ref.provider+':'+track.ref.id+':'+query} group="parts" label="分 P" items={all.map((entry,index)=>({entry,index})).filter(({entry,index})=>`${entry.title} P${index+1}`.toLowerCase().includes(query.trim().toLowerCase()))}>{items=><div className="parts-list">{items.map(({ entry, index }) => <div className="part-entry" key={entry.ref.part ?? entry.resourceId}><label className="part-select"><input type="checkbox" aria-label={`选择 P${index + 1} ${entry.title}`} checked={selected.includes(entry.ref.part!)} disabled={disabled} onChange={() => toggle(entry.ref.part!)}/><span>P{index + 1}</span></label><div className="part-content">{renderRow(entry)}</div></div>)}</div>}</PagedList>
      </section>}
      {feedback}
    </div>
    <div className="music-action-footer">
      {view==='playlist'&&<p className="action-target" role="status">添加到「{target==='new'?name.trim()||'新建歌单':playlists.find(playlist=>playlist.id===target)?.name??'请选择歌单'}」</p>}
      {view==='destination'&&<button className="btn btn-secondary" onClick={()=>switchView('parts')}>返回分 P 列表</button>}
      {view === 'overview' && <div className="music-action-grid"><button className="btn btn-primary" disabled={disabled} onClick={() => void playSingle()}><PlayIcon size={18} weight="fill"/>立即播放</button><button className="btn btn-secondary" disabled={disabled} onClick={() => void addSingle()}><QueueIcon size={18}/>加入队列</button><button className="btn btn-secondary" disabled={disabled} aria-pressed={isFavorite(track)} onClick={favoriteSingle}><HeartIcon size={18} weight={isFavorite(track) ? 'fill' : 'regular'}/>{isFavorite(track) ? '取消收藏' : '收藏'}</button><button className="btn btn-secondary" disabled={disabled} onClick={() => { setCustom(false); switchView('playlist'); }}><ListBulletsIcon size={18}/>加入歌单</button></div>}
      {view === 'play-choice' && <div className="music-action-grid"><button className="btn btn-primary" disabled={disabled || decisionStale} onClick={() => void choose('all')}>播放整组 {all.length} 首</button><button className="btn btn-secondary" disabled={disabled || decisionStale} onClick={() => void choose('single')}>保持本 P</button></div>}
      {view === 'parts' && <div className="music-action-grid"><button className="btn btn-primary" disabled={disabled || !chosen.length} onClick={() => void play(chosen)}>播放所选 {chosen.length} 首</button><button className="btn btn-secondary" disabled={disabled || !chosen.length} onClick={() => { setCustom(true); switchView('destination'); }}>添加所选 {chosen.length} 首</button></div>}
      {['favorite', 'playlist', 'enqueue'].includes(view) && <div className="music-action-grid">{custom ? <><button className="btn btn-primary" disabled={disabled || playlistInvalid || !chosen.length} onClick={() => void finished(commit(chosen))}>{actionName}选中 {chosen.length} 首</button>{view === 'favorite' && <button className="btn btn-secondary" disabled={disabled || !chosen.some(isFavorite)} onClick={() => void finished(save('unfavorite', chosen))}>取消收藏选中</button>}</> : <><button className="btn btn-primary" disabled={disabled || playlistInvalid} onClick={() => void finished(view === 'favorite' && isFavorite(single) ? save('unfavorite', [single]) : commit([single]))}>{view === 'favorite' && isFavorite(single) ? '取消收藏' : actionName}{multiple ? '本 P' : '本首'}</button>{multiple && <button className="btn btn-secondary" disabled={disabled || playlistInvalid} onClick={() => void finished(commit(all))}>{actionName}全部 {all.length} 首</button>}</>}</div>}
    </div>
  </>;
}
