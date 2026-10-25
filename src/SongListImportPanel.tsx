import { useEffect, useRef, useState } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import { selectMusicParts, type EntryRef, type MusicEntry } from '@studio/music-sources';
import type { SongLibraryState } from '../server/song-library-types';
import type { ListImportSource } from '../server/list-import-types';
import { request, cancelled, errorText, type CreatorVideos } from './api';
import { Modal } from './Modal';

/** Source previews stay bounded and transient; the product rechecks metadata at commit. */
export interface ListImportRequest {title:string;source:ListImportSource;excluded?:number;labels?:string[]}
export function SongListImportPanel({ client, input, library, onChange, onClose, onSaved }: { client: MusicClient; input: ListImportRequest; library: SongLibraryState; onChange: (state: SongLibraryState) => void; onClose: () => void; onSaved: (text: string) => void }) {
  const [refs, setRefs] = useState<{ ref: EntryRef; title: string }[]>([]), [selected, setSelected] = useState<Set<number>>(new Set()), [target, setTarget] = useState('system:favorites'), [name, setName] = useState(''), [expand, setExpand] = useState(false), [duplicates, setDuplicates] = useState('allow');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [limited, setLimited] = useState(false), [revision, setRevision] = useState(library.revision), work = useRef<AbortController | undefined>(undefined);
  const [phase,setPhase]=useState<'read'|'save'>('read'),[cancelledRead,setCancelledRead]=useState(false);
  const [failures, setFailures] = useState<{ title: string; code: string }[]>([]), [incomplete, setIncomplete] = useState(false), [narrowed, setNarrowed] = useState(false);
  useEffect(() => () => work.current?.abort(), []);
  const read = async () => {
    work.current?.abort(); const controller = new AbortController(); work.current = controller; setBusy(true);setPhase('read');setCancelledRead(false); setError(''); setRefs([]); setSelected(new Set()); setLimited(false); setFailures([]); setIncomplete(false); setNarrowed(false);
    const result: { ref: EntryRef; title: string }[] = [], failed: { title: string; code: string }[] = [];
    try {
      const source = input.source, entries: { ref: EntryRef; context: 'part' | 'video' }[] = [];
      if (source.kind === 'entries') { entries.push(...source.items.slice(0, 1000)); if (source.items.length > 1000) setLimited(true); }
      else {
        let cursor: string | undefined; const seen = new Set<string>();
        try { for (let page = 0; page < 100; page++) {
          controller.signal.throwIfAborted();
          let items: MusicEntry[], next: string | undefined;
          if (source.kind === 'playlist') { const result = await client.list({ ref: source.ref, limit: 50, cursor }, { signal: controller.signal }); items = result.items; next = result.nextCursor; }
          else { const params = new URLSearchParams({ provider: source.creator.provider, id: source.creator.id, collection: source.collectionId, ...(cursor ? { cursor } : {}) }); const result = await request<CreatorVideos>('/api/follows/collection?' + params, undefined, controller.signal); items = result.items; next = result.cursor; }
          if (items.length > 1000 - entries.length) setLimited(true);
          entries.push(...items.slice(0, 1000 - entries.length).map(entry => ({ ref: entry.ref, context: 'video' as const })));
          if (!next) break;
          if (entries.length >= 1000 || seen.has(next) || page === 99) { setLimited(true); break; }
          seen.add(next); cursor = next;
        } } catch (issue) { if (cancelled(issue)) throw issue; setIncomplete(true); failed.push({ title: '来源列表尚未读完', code: (issue as { code?: string }).code ?? 'upstream' }); }
      }
      for (const entry of entries.slice(0, 1000)) {
        controller.signal.throwIfAborted();
        try {
        const metadata = await client.metadata(entry.ref, { signal: controller.signal });
        const parts = selectMusicParts(metadata, { mode: expand && entry.context === 'video' ? 'all' : 'single', ...(entry.context === 'part' && entry.ref.part ? { part: entry.ref.part } : {}) });
        if (parts.length > 1000 - result.length) setLimited(true);
        result.push(...parts.slice(0, 1000 - result.length).map(part => ({ ref: part.ref, title: part.title })));
        if (result.length >= 1000) { setLimited(true); break; }
        } catch (issue) {
          if (cancelled(issue) || controller.signal.aborted) throw issue;
          const code = (issue as { code?: string }).code ?? 'upstream'; failed.push({ title: entry.ref.id + (entry.ref.part ? ' / ' + entry.ref.part : ''), code });
          if (!['not-found', 'unsupported'].includes(code)) { setIncomplete(true); break; }
        }
      }
      controller.signal.throwIfAborted(); setRefs(result); setFailures(failed); setSelected(new Set(result.slice(0, 500).map((_, index) => index))); setRevision(library.revision);
    } catch (issue) { if (!cancelled(issue)) setError(errorText(issue)); } finally { if (work.current === controller) setBusy(false); }
  };
  const save = async () => {
    if (!selected.size || selected.size > 500 || (limited || incomplete || failures.length > 0) && !narrowed) return;
    const controller = new AbortController(); work.current = controller; setBusy(true);setPhase('save'); setError('');
    try {
      const result = await request<SongLibraryState & { summary: { changed: number; unchanged: number } }>('/api/song-library/sources', { revision, save: { refs: refs.filter((_, index) => selected.has(index)).map(item => item.ref), target: target === 'system:favorites' ? 'favorite' : 'playlist', ...(target === 'new' ? { name } : target !== 'system:favorites' ? { playlistId: target } : {}), duplicates } }, controller.signal);
      if (!controller.signal.aborted) { onChange(result); onSaved(`已加入 ${result.summary.changed} 首，跳过 ${result.summary.unchanged} 首`); onClose(); }
    } catch (issue) { if (!cancelled(issue)) {setError(errorText(issue));if((issue as {code?:string}).code==='conflict'){try{const current=await request<SongLibraryState>('/api/song-library',undefined,controller.signal);if(!controller.signal.aborted)onChange(current);}catch{}}} } finally { if (work.current === controller) setBusy(false); }
  };
  return <Modal title={'添加歌曲 · ' + input.title} className="backup-modal song-list-import-modal" onClose={() => { work.current?.abort(); onClose(); }}>
    <label className="choice"><input type="checkbox" checked={expand} disabled={busy} onChange={event => {setExpand(event.target.checked);setRefs([]);setSelected(new Set());setFailures([]);setError('');setLimited(false);setIncomplete(false);setNarrowed(false);setCancelledRead(false);}}/>展开视频的全部分 P</label><button className="btn btn-secondary" disabled={busy} onClick={() => void read()}>读取并预览来源</button>
    {busy && <p role="status">{phase==='read'?'正在读取来源…':'正在添加歌曲…'} {phase==='read'&&<button className="btn btn-ghost" onClick={() => { work.current?.abort(); setBusy(false);setCancelledRead(true); }}>取消读取</button>}</p>}
    {cancelledRead&&<p role="status">读取已取消，可重新读取；尚未添加歌曲。</p>}
    {limited && <p role="status">已达到预览范围上限，请明确选择本次需要添加的歌曲。</p>}
    {!!failures.length && <section className="settings-group" aria-label="来源失败项"><h3>未加入本次选择的来源（{failures.length}）</h3>{failures.map((item, index) => <p key={index}>{item.title} · {item.code === 'not-found' ? '内容不存在或无法访问' : errorText({ code: item.code })}</p>)}<p>已读到的可用项保留。可重新读取重试；提交时服务会重新核对全部选中来源，失败则整体保留原资料。</p></section>}
    {(limited || incomplete || failures.length > 0) && <label className="choice"><input type="checkbox" checked={narrowed} disabled={busy} onChange={event => setNarrowed(event.target.checked)}/>确认本次仅添加已预览并选中的可用项，未读完和失败项不包含在内</label>}
    <p className="muted">已选 {selected.size}/{refs.length} 首，每次最多提交 500 首。</p><div className="toolbar"><button className="btn btn-ghost" disabled={busy} onClick={() => setSelected(new Set(refs.slice(0, 500).map((_, index) => index)))}>选择前 500 首</button><button className="btn btn-ghost" disabled={busy} onClick={() => setSelected(new Set())}>清空选择</button></div>
    <div className="source-import-preview" tabIndex={refs.length?0:undefined} aria-label="来源预览歌曲">{refs.map((entry, index) => <label className="choice" key={index}><input type="checkbox" disabled={busy || !selected.has(index) && selected.size >= 500} checked={selected.has(index)} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(index)) next.delete(index); else next.add(index); return next; })}/><span>{entry.title}</span></label>)}</div>
    <label className="field"><span className="field-label">添加到</span><select className="select" aria-label="导入目标" value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="system:favorites">我的收藏</option>{library.snapshot.playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}<option value="new">新建歌单</option></select></label>
    {target === 'new' && <label className="field"><span className="field-label">歌单名称</span><input className="input" value={name} disabled={busy} maxLength={200} onChange={event => setName(event.target.value)}/></label>}
    {target !== 'system:favorites' && <label className="field"><span className="field-label">重复歌曲</span><select className="select" value={duplicates} disabled={busy} onChange={event => setDuplicates(event.target.value)}><option value="allow">允许重复成员</option><option value="skip">跳过重复</option><option value="reject">遇到重复整体拒绝</option></select></label>}
    {revision !== library.revision && <p className="feedback" role="alert">资料已变化，当前选择保留。<button className="btn btn-secondary" onClick={() => setRevision(library.revision)}>采用当前修订</button></p>}
    {error && <p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="btn btn-ghost" onClick={()=>{work.current?.abort();onClose();}}>取消添加</button><button className="btn btn-primary" disabled={busy || !selected.size || target === 'new' && !name.trim() || revision !== library.revision || (limited || incomplete || failures.length > 0) && !narrowed} onClick={() => void save()}>{busy&&phase==='save'?'正在添加…':error&&phase==='save'?'重试添加':'确认添加'}</button></div>
  </Modal>;
}
