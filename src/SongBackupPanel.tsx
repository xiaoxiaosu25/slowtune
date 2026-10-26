import { useEffect, useRef, useState } from 'react';
import { errorText } from './api';
import { maxSongLibrarySnapshotBytes, type SongLibraryState } from '../server/song-library-types';
import { previewSongBackup, readSongBackupFile, previewSongBackupImport, commitSongBackupImport } from './song-library-backup';
import type { ImportImpact } from '../server/song-library-backup';
import { desktopSurface } from './song-search';

type Preview = { token: string; revision: string | null; expiresAt: number; impact: ImportImpact };
const counts = (value: ImportImpact['before']) => `${value.songs} 首歌曲 · ${value.versions} 个版本 · ${value.favorites} 首收藏 · ${value.playlists} 个歌单 · ${value.entries} 个成员`;
const backupError = (issue: unknown) => (issue as { code?: string })?.code === 'expired' ? '导入预览已过期，请重新校验并预览。' : errorText(issue);

/** New-model panel; the host supplies the new library state and applies the committed result. */
export function SongBackupPanel({ library, onCommitted }: { library: SongLibraryState; onCommitted: (state: SongLibraryState) => void }) {
  const [draft, setDraft] = useState(''), [mode, setMode] = useState<'append' | 'replace'>('append'), [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false),[saved,setSaved]=useState('');
  const serial = useRef(0);
  const [lifetime]=useState(()=>new AbortController());
  useEffect(()=>()=>{++serial.current;lifetime.abort();},[lifetime]);
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (text: string) => {
    ++serial.current; setPreview(undefined); setAcknowledged(false); setError('');setSaved('');
    if (fileInput.current) fileInput.current.value = '';
    if (new TextEncoder().encode(text).length > maxSongLibrarySnapshotBytes) { setError('快照超过 64 MiB 上限。'); return; }
    setDraft(text);
  };
  const inspect = async () => {
    const generation = ++serial.current; setBusy(true); setError('');setSaved(''); setPreview(undefined); setAcknowledged(false);
    try { previewSongBackup(draft); const result = await previewSongBackupImport(draft, mode, library.revision,lifetime.signal); if (generation === serial.current) setPreview(result); }
    catch (issue) { if (generation === serial.current) setError(backupError(issue)); }
    finally { if (generation === serial.current) setBusy(false); }
  };
  const commit = async () => {
    if (!preview || preview.impact.conflicts.length || mode === 'replace' && !acknowledged) return;
    const generation=++serial.current;setBusy(true); setError('');
    try { const state = await commitSongBackupImport(preview.token, preview.revision,lifetime.signal); if(generation===serial.current){onCommitted(state); setPreview(undefined); setAcknowledged(false); setDraft('');if(fileInput.current)fileInput.current.value='';setSaved('资料已导入，当前播放与队列保留。');} }
    catch (issue) { if(generation===serial.current)setError(backupError(issue)); }
    finally { if(generation===serial.current)setBusy(false); }
  };
  return <div className="backup-settings settings-stack" aria-busy={busy}>
    {saved&&<p className="feedback" role="status">{saved}</p>}
    <p className="muted">{desktopSurface() ? '保存歌曲资料、全部版本、收藏和歌单成员及顺序，以及自定义收藏／歌单封面图片。只支持慢听新格式，上限 64 MiB；不包含音视频、凭据或账号同步权限。' : '保存歌曲资料、全部版本、收藏和歌单成员及顺序。只支持慢听新格式，上限 64 MiB；不包含媒体、凭据或账号同步权限。'}</p>
    <section className="settings-group"><h3>导出歌曲资料库</h3><a className="btn btn-secondary" href="/api/song-library/export" download="slowtune-library.json">导出 JSON 快照</a></section>
    <section className="settings-group"><h3>从备份恢复</h3>
      <label className="field"><span className="field-label">选择快照文件</span><input ref={fileInput} className="input" type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0], generation = ++serial.current; setPreview(undefined); setAcknowledged(false); setDraft(''); setError('');setSaved(''); if (!file) return;
        if (file.size > maxSongLibrarySnapshotBytes) { setError('快照超过 64 MiB 上限。'); return; }
        setBusy(true);
        try { const text = await readSongBackupFile(file); if (generation === serial.current) setDraft(text); }
        catch (issue) { if (generation === serial.current) setError(errorText(issue)); }
        finally { if (generation === serial.current) setBusy(false); }
      }}/></label>
      <label className="field"><span className="field-label">快照内容</span><textarea className="textarea" aria-label="新资料库快照内容" value={draft} disabled={busy} onChange={event => update(event.target.value)} rows={6}/></label>
      <label className="field"><span className="field-label">导入方式</span><select className="select" value={mode} disabled={busy} onChange={event => { ++serial.current; setMode(event.target.value as 'append' | 'replace'); setPreview(undefined); setAcknowledged(false); }}><option value="append">追加资料</option><option value="replace">替换全部资料</option></select></label>
      <button className="btn btn-secondary" disabled={busy || !draft.trim()} onClick={() => void inspect()}>校验并预览影响</button>
      {error && <p className="feedback" role="alert">{error}</p>}
      {preview && <div className="backup-preview" role="status"><p>当前：{counts(preview.impact.before)}</p><p>导入后：{counts(preview.impact.after)}</p><p>复用收藏 {preview.impact.reusedFavorites} 项；替换移除当前成员 {preview.impact.removedMembers} 项；需要重新确认同步的关联 {preview.impact.reviewLinks.length} 个。</p>
        {!!preview.impact.conflicts.length && <p role="alert">存在 {preview.impact.conflicts.length} 项身份或资料冲突，不能提交。现有人工资料保留。</p>}
        {mode === 'replace' && <label className="choice"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)}/>我已导出需要保留的资料，确认按备份完整替换</label>}
        <div className="modal-actions"><button className="btn btn-ghost" disabled={busy} onClick={()=>{setPreview(undefined);setAcknowledged(false);setError('');}}>取消预览</button><button className="btn btn-primary" disabled={busy || !!preview.impact.conflicts.length || preview.revision !== library.revision || mode === 'replace' && !acknowledged} onClick={() => void commit()}>{busy ? '提交中…' : '确认导入'}</button></div>
        {preview.revision !== library.revision && <p role="alert">资料已变化，请重新预览。</p>}
      </div>}
    </section>
  </div>;
}
