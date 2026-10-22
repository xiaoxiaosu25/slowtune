import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import type { SongLibraryState, SongVersion } from '../server/song-library-types';
import type { SongMaintenanceAction, SongMaintenanceImpact } from '../server/song-library-maintenance';
import { request, cancelled, errorText } from './api';
import { SongCover } from './SongCover';
import { availabilityLabel, versionName } from './song-management';
import { desktopSongIndex } from './desktop-song-index';

type CheckResult = SongLibraryState & { summary: { checked: number; unavailable: number; uncertain: number; skipped: number; stoppedReason?: string } };
export function useSongMaintenance(onChange: (state: SongLibraryState) => void) {
  const work = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => () => work.current?.abort(), []);
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setBusy(true); setError(''); setMessage('');
    try { await task(controller.signal); return !controller.signal.aborted; }
    catch (issue) {
      if (!cancelled(issue) && !controller.signal.aborted) {
        setError((issue as { code?: string }).code === 'expired' ? '预览已到期，请重新预览后确认。' : errorText(issue));
        if ((issue as { code?: string }).code === 'conflict') try { const saved = await request<SongLibraryState>('/api/song-library', undefined, controller.signal); if (!controller.signal.aborted) onChange(saved); } catch {}
      }
      return false;
    } finally { if (work.current === controller && !controller.signal.aborted) { setBusy(false); work.current = undefined; } }
  };
  const cancel = () => { work.current?.abort(); work.current = undefined; setBusy(false); setMessage('已取消等待，已完成的结果以当前资料为准。'); };
  const check = (library: SongLibraryState, ids: string[]) => run(async signal => {
    const saved = await request<CheckResult>('/api/song-library/maintenance/check', { revision: library.revision, versionIds: ids }, signal);
    if (signal.aborted) return;
    onChange(saved);
    setMessage(`已检查 ${saved.summary.checked} 个版本：失效 ${saved.summary.unavailable}，暂时无法确认 ${saved.summary.uncertain}，跳过 ${saved.summary.skipped}。${saved.summary.stoppedReason ? '检查已停止：' + errorText({ code: saved.summary.stoppedReason }) : ''}`);
  });
  return { run, check, cancel, busy, error, message };
}

export type SongTask = { type: 'merge-songs' | 'move-version' | 'delete-song' | 'delete-version' | 'clean-unavailable'; songId?: string; versionIds?: string[] };
const titles: Record<SongTask['type'], string> = { 'merge-songs': '合并重复歌曲', 'move-version': '移动版本到其他歌曲', 'delete-song': '从资料库删除歌曲', 'delete-version': '删除播放版本', 'clean-unavailable': '清理已确认失效的版本' };
const taskVersionIds = (task: SongTask, versions: SongVersion[]) => task.type === 'merge-songs' || task.type === 'delete-song' ? versions.filter(v => v.songId === task.songId).map(v => v.id) : task.versionIds ?? [];

/** Task content stays in the existing dialog, instead of stacking maintenance dialogs. */
export function SongMaintenanceTask({ task, library, onChange, onBack, onComplete }: {
  task: SongTask; library: SongLibraryState; onChange: (state: SongLibraryState) => void; onBack: () => void; onComplete: (state: SongLibraryState) => void;
}) {
  const [filter, setFilter] = useState(''), [target, setTarget] = useState('');
  const [preview, setPreview] = useState<{ token: string; revision: string | null; expiresAt: number; impact: SongMaintenanceImpact }>();
  const [expired, setExpired] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), operation = useSongMaintenance(onChange);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    setExpired(false); if (!preview) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, preview.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);
  const index = desktopSongIndex(library.snapshot);
  const song = index.songs.get(task.songId ?? ''), targetSong = target !== task.songId && index.retainedSongIds.has(target) ? index.songs.get(target) : undefined;
  const ids = taskVersionIds(task, library.snapshot.versions), affected = library.snapshot.versions.filter(v => ids.includes(v.id));
  const requiresTarget = task.type === 'merge-songs' || task.type === 'move-version';
  const candidates = index.retainedSongs.filter(s => s.id !== task.songId && index.searchText.get(s.id)!.includes(filter.toLocaleLowerCase()));
  useEffect(() => {
    if (requiresTarget && target && !targetSong) { setTarget(''); setPreview(undefined); }
  }, [requiresTarget, target, targetSong]);
  const valid = (task.type === 'delete-song' || task.type === 'merge-songs' ? !!song : ids.length > 0 && affected.length === ids.length) && (!requiresTarget || !!targetSong);
  const action = (): SongMaintenanceAction => task.type === 'merge-songs' ? { type: task.type, sourceId: task.songId!, targetId: target } : task.type === 'move-version' ? { type: task.type, versionId: ids[0], targetId: target } : task.type === 'delete-song' ? { type: task.type, songId: task.songId! } : task.type === 'clean-unavailable' ? { type: task.type, versionIds: ids } : { type: 'delete-version', versionId: ids[0] };
  const prepare = () => operation.run(async signal => {
    if (!valid) return;
    const next = await request<typeof preview>('/api/song-library/maintenance/preview', { revision: library.revision, action: action() }, signal);
    if (!signal.aborted) setPreview(next);
  });
  const confirmLabel = task.type === 'merge-songs' ? `合并到《${targetSong?.title}》` : task.type === 'move-version' ? `移到《${targetSong?.title}》` : task.type === 'delete-song' ? '删除此歌曲及全部版本' : task.type === 'clean-unavailable' ? `清理 ${ids.length} 个失效版本` : '删除此版本';
  const playlists = library.snapshot.playlists.filter(p => p.entries.some(e => e.songId === song?.id || e.pinnedVersionId && ids.includes(e.pinnedVersionId)));
  return <div className="song-task">
    <button type="button" className="btn btn-ghost btn-sm" disabled={operation.busy} onClick={onBack}><ArrowLeftIcon size={18}/>返回</button>
    <h3 ref={heading} tabIndex={-1}>{titles[task.type]}</h3>
    <p className="muted">{task.type === 'merge-songs' ? '同一首歌保存了两次？选定要保留的歌曲，把所有版本和歌单记录合并过去。目标歌曲的歌名、歌手和默认版本会保留。' : task.type === 'move-version' ? '这个版本放错了歌曲？将它移到正确的歌曲，原歌曲继续保留。' : task.type === 'delete-song' ? '这会删除歌曲资料及其全部版本，并移除收藏和歌单中的记录。仅想从歌单移除，请返回歌单操作。' : task.type === 'clean-unavailable' ? '仅清理已确认来源不存在的版本。网络、登录或限流问题不会作为失效版本清理。' : '这会从歌曲中删除此版本。歌曲资料及其他版本继续保留。'}</p>
    {song && <div className="song-task-identity"><SongCover song={song}/><div><strong>{song.title}</strong><p className="muted">{song.artists?.join(' / ') || '歌手未填写'} · {library.snapshot.versions.filter(v => v.songId === song.id).length} 个版本</p></div><span className="muted">{requiresTarget ? '移出' : '删除对象'}</span></div>}
    {task.type !== 'merge-songs' && task.type !== 'delete-song' && <ul className="song-task-versions">{affected.map(v => <li key={v.id}><strong>{versionName(v)}</strong><small>{v.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {v.ref.id}{v.ref.part ? ' / ' + v.ref.part : ''} · {availabilityLabel(v)}</small></li>)}</ul>}
    {requiresTarget && <section className="song-task-target" aria-label="选择目标歌曲"><h4>{task.type === 'merge-songs' ? '保留哪首歌曲？' : '移到哪首歌曲？'}</h4><label className="search-field"><MagnifyingGlassIcon size={18}/><input aria-label="搜索目标歌曲" placeholder="输入歌名或歌手" value={filter} disabled={operation.busy} onChange={e => setFilter(e.target.value)}/></label>
      <div className="song-target-list" role="radiogroup" aria-label="目标歌曲">{candidates.map(s => <label className={'song-target-option' + (s.id === target ? ' selected' : '')} key={s.id}><input type="radio" name="maintenance-target" checked={target === s.id} disabled={operation.busy} onChange={() => { setTarget(s.id); setPreview(undefined); }}/><span><strong>{s.title}</strong><small>{s.artists?.join(' / ') || '歌手未填写'}</small></span><small>{library.snapshot.versions.filter(v => v.songId === s.id).length} 个版本</small></label>)}{!candidates.length && <p className="muted">没有匹配的目标歌曲。</p>}</div>
      {targetSong && <p role="status">{task.type === 'merge-songs' ? '合并到' : '移到'}：{targetSong.title} · {targetSong.artists?.join(' / ') || '歌手未填写'}</p>}
    </section>}
    <div className="toolbar"><button className="btn btn-secondary" disabled={operation.busy || !valid} onClick={() => void prepare()}>{preview ? '重新预览影响' : '预览影响'}</button>{operation.busy && <button className="btn btn-ghost" onClick={operation.cancel}>取消处理</button>}</div>
    {preview && <section className="song-impact" aria-label="操作影响预览"><h4>确认前，请核对影响</h4>
      <ul><li>{task.type === 'merge-songs' ? `将《${song?.title}》的 ${preview.impact.versions} 个版本归入《${targetSong?.title}》，歌单中的重复记录继续保留。` : task.type === 'move-version' ? `将 ${affected.length} 个版本移到《${targetSong?.title}》。` : task.type === 'delete-song' ? `删除《${song?.title}》及其 ${preview.impact.versions} 个版本。` : task.type === 'delete-version' ? `删除「${affected[0] ? versionName(affected[0]) : '所选版本'}」，歌曲资料和其他版本继续保留。` : `清理所选 ${preview.impact.versions} 个已确认失效版本。`}</li>
        {!!preview.impact.favorites && <li>减少 {preview.impact.favorites} 条收藏记录。</li>}
        {!!preview.impact.entries && <li>移除 {preview.impact.entries} 条歌单记录。</li>}
        {!!playlists.length && <li>涉及歌单：{playlists.map(p => p.name).join('、')}。</li>}
        {!!preview.impact.defaults && <li>取消 {preview.impact.defaults} 个默认版本选择。</li>}
        {!!preview.impact.pins && <li>{preview.impact.pins} 条歌单记录将取消固定版本，改为跟随歌曲默认。</li>}
        {!!preview.impact.mappings && <li>解除 {preview.impact.mappings} 条 B站同步关联记录。</li>}
      </ul>
      {!!preview.impact.remoteRemovals.length && <div className="song-remote-impact"><strong>会从关联的 B站收藏夹移除 {preview.impact.remoteRemovals.length} 个视频</strong><ul>{preview.impact.remoteRemovals.map(item => <li key={item.linkId + item.bvid}><a href={'https://www.bilibili.com/video/' + item.bvid} target="_blank" rel="noreferrer">{item.bvid}</a></li>)}</ul></div>}
      {preview.revision !== library.revision && <p role="alert">资料已变化，请重新预览后再确认。</p>}{expired && <p role="alert">预览已到期，请重新预览。</p>}
      <div className="modal-actions"><button className="btn btn-ghost" disabled={operation.busy} onClick={onBack}>取消</button><button className="btn btn-danger" disabled={operation.busy || !valid || expired || preview.expiresAt <= Date.now() || preview.revision !== library.revision} onClick={() => void operation.run(async signal => {
        const saved = await request<SongLibraryState>('/api/song-library/maintenance/commit', { revision: preview.revision, token: preview.token }, signal);
        if (!signal.aborted) { onChange(saved); onComplete(saved); }
      })}>{operation.busy ? '处理中…' : confirmLabel}</button></div>
    </section>}
    {operation.error && <p className="feedback" role="alert">{operation.error}</p>}
  </div>;
}
