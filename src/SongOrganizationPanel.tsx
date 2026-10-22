import { useEffect, useRef, useState } from 'react';
import type { Song, SongLibraryState } from '../server/song-library-types';
import type { SongOrganizationPreview, SongOrganizationField } from '../server/song-library-organization';
import { request, errorText, cancelled } from './api';

const fieldNames = { title: '歌名', artists: '歌手' };
const display = (value: string | string[] | undefined) => Array.isArray(value) ? value.join(' / ') || '未填写' : value || '未填写';

export function SongOrganizationPanel({ song, revision, disabled, onChange, autoOpen = false }: {
  song: Song; revision: string | null; disabled: boolean; onChange: (state: SongLibraryState) => void; autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false), [preview, setPreview] = useState<SongOrganizationPreview>();
  const [selected, setSelected] = useState<Record<string, SongOrganizationField[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const work = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => work.current?.abort(), []);
  const stale = preview && preview.revision !== revision;
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setBusy(true); setError(''); setMessage('');
    try { await task(controller.signal); }
    catch (issue) {
      if (!cancelled(issue) && !controller.signal.aborted) {
        setError((issue as { code?: string }).code === 'expired' ? '建议已到期，请重新生成后核对。' : errorText(issue));
        if ((issue as { code?: string }).code === 'conflict') {
          try { const current = await request<SongLibraryState>('/api/song-library', undefined, controller.signal); if (!controller.signal.aborted) onChange(current); } catch {}
        }
      }
    } finally { if (work.current === controller) { setBusy(false); work.current = undefined; } }
  };
  const generate = () => {
    setOpen(true); setPreview(undefined);
    void run(async signal => {
      const result = await request<SongOrganizationPreview>('/api/song-library/organization/preview', { revision, songId: song.id }, signal);
      if (signal.aborted) return;
      setPreview(result); setSelected(Object.fromEntries(result.candidates.map(candidate => [candidate.id, Object.keys(candidate.patch) as SongOrganizationField[]])));
    });
  };
  useEffect(() => { if (autoOpen) generate(); }, []);
  return <section className="song-organization" aria-label="整理建议">
    <div className="toolbar"><button className="btn btn-ghost btn-sm" disabled={disabled || busy} aria-expanded={open} onClick={generate}>{open ? '重新生成建议' : '查看整理建议'}</button>{open && <button className="btn btn-ghost btn-sm" onClick={() => { work.current?.abort(); work.current = undefined; setBusy(false); setOpen(false); setPreview(undefined); setError(''); setMessage(''); }}>收起建议</button>}</div>
    {disabled && <p className="muted">先保存歌曲资料，再查看或采用整理建议。</p>}
    {open && <div className="song-organization-content">
      <p className="muted">仅根据已保存的资料提供建议。核对后按字段采用，采用后标记为已整理；不会合并歌曲或改变播放版本。</p>
      {busy && <p role="status">正在处理整理建议… <button className="btn btn-ghost btn-sm" onClick={() => { work.current?.abort(); work.current = undefined; setBusy(false); }}>取消</button></p>}
      {preview?.warnings.map(warning => <p className="muted" key={warning}>{warning}</p>)}
      {stale && <p role="status">资料已变化，请重新生成建议后核对，现有资料和播放保持。</p>}
      {preview?.candidates.map((candidate, index) => <div className="song-organization-candidate" key={candidate.id}>
        <h4>建议 {index + 1}</h4>
        {(Object.keys(candidate.patch) as SongOrganizationField[]).map(field => <label className="song-organization-field" key={field}><input type="checkbox" aria-label={'采用建议 ' + (index + 1) + ' 的' + fieldNames[field]} checked={selected[candidate.id]?.includes(field) ?? false} disabled={disabled || busy || !!stale} onChange={event => setSelected(old => ({ ...old, [candidate.id]: event.target.checked ? [...(old[candidate.id] ?? []), field] : (old[candidate.id] ?? []).filter(value => value !== field) }))}/><span><strong>{fieldNames[field]}</strong><span className="muted">当前：{display(preview.current[field])}</span><span>建议：{display(candidate.patch[field])}</span></span></label>)}
        <details className="song-version-details"><summary>查看建议依据</summary>{candidate.evidence.map((evidence, index) => <p key={index}>{evidence.kind === 'catalog' ? '目录资料' : evidence.kind === 'metadata' ? '来源歌手资料' : '来源标题提取'}：{evidence.title}</p>)}</details>
        <button className="btn btn-secondary btn-sm" disabled={disabled || busy || !!stale || !selected[candidate.id]?.length} onClick={() => void run(async signal => {
          const saved = await request<SongLibraryState>('/api/song-library/organization/adopt', { revision: preview.revision, token: preview.token, candidateId: candidate.id, fields: selected[candidate.id] }, signal);
          if (signal.aborted) return;
          onChange(saved); setPreview(undefined); setMessage('已采用所选建议，人工字段已保护。');
        })}>采用建议 {index + 1}</button>
      </div>)}
      {message && <p role="status">{message}</p>}
      {error && <p className="feedback" role="alert">{error}</p>}
    </div>}
  </section>;
}
