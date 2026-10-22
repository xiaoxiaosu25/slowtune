import { useEffect, useRef, useState } from 'react';
import { MusicNotesIcon, PlusIcon } from '@phosphor-icons/react';
import type { SongLibraryState } from '../server/song-library-types';
import type { SongMaintenanceImpact } from '../server/song-library-maintenance';
import { request, errorText, cancelled, type Track } from './api';
import { Modal } from './Modal';
import { artworkUrl } from '../server/artwork-url';
import { desktopSongIndex } from './desktop-song-index';
import './song-library.css';

/** Group the source already being heard; creating the first version is one atomic save. */
export function SongVersionDialog({ track, library, onChange, onClose, desktop = false }: { track: Track; library: SongLibraryState; onChange: (value: SongLibraryState) => void; onClose: () => void; desktop?: boolean }) {
  const owned = library.snapshot.versions.find(v => v.ref.provider === track.ref.provider && v.ref.id === track.ref.id && v.ref.part === track.ref.part);
  const owner = library.snapshot.songs.find(song => song.id === (owned?.songId ?? track.songId));
  const index = desktop ? desktopSongIndex(library.snapshot) : undefined;
  const songs = index?.retainedSongs ?? library.snapshot.songs;
  const initialOwner = owner && (!index || index.retainedSongIds.has(owner.id)) ? owner : undefined;
  const [target, setTarget] = useState(initialOwner?.id ?? ''), [existing, setExisting] = useState(!!initialOwner), [filter, setFilter] = useState('');
  const [title, setTitle] = useState(owner?.title ?? track.chartContext?.title ?? track.title), [artists, setArtists] = useState((owner?.artists ?? track.chartContext?.artists ?? track.artists ?? []).join(' / '));
  const [label, setLabel] = useState(owned?.label ?? ''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ token: string; revision: string | null; expiresAt: number; impact: SongMaintenanceImpact }>();
  const work = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => work.current?.abort(), []);
  const selected = songs.find(song => song.id === target), moving = existing && owned && !!selected && owned.songId !== selected.id;
  const candidates = songs.filter(song => `${song.title} ${song.artists?.join(' ') ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  useEffect(() => {
    if (desktop && target && !selected) { setTarget(''); setPreview(undefined); }
  }, [desktop, target, selected]);
  const changeTarget = (id: string) => { setTarget(id); setPreview(undefined); setError(''); };
  const save = async () => {
    if (desktop && existing && !selected) return;
    const controller = new AbortController(); work.current = controller; setBusy(true); setError('');
    try {
      if (moving) {
        if (!preview) { setPreview(await request('/api/song-library/maintenance/preview', { revision: library.revision, action: { type: 'group-version', versionId: owned.id, targetId: target } }, controller.signal)); return; }
        const saved = await request<SongLibraryState>('/api/song-library/maintenance/commit', { revision: preview.revision, token: preview.token }, controller.signal);
        onChange(saved); onClose(); return;
      }
      const save = existing ? { target: 'version', songId: target, refs: [track.ref], label } : { target: 'favorite', refs: [track.ref], ...(owner ? {songId:owner.id} : {}), ...(track.chartContext ? {context:track.chartContext} : {}), song: { title: title.trim(), artists: artists.split(/\s*[/／\n]\s*/u).map(value => value.trim()).filter(Boolean) }, label };
      const saved = await request<SongLibraryState>('/api/song-library/sources', { revision: library.revision, save }, controller.signal);
      onChange(saved); onClose();
    } catch (issue) { if (!cancelled(issue)) { setError(errorText(issue)); if ((issue as { code?: string }).code === 'conflict') { setPreview(undefined); try { onChange(await request('/api/song-library', undefined, controller.signal)); } catch {} } } }
    finally { if (work.current === controller) setBusy(false); }
  };
  const art = artworkUrl(track.artwork);
  return <Modal title="归入歌曲" className="song-group-modal" onClose={onClose}>
    <div className="song-group-source">{art ? <img src={art} alt="" referrerPolicy="no-referrer"/> : <span className="unknown-cover"><MusicNotesIcon size={24}/></span>}<div><span className="eyebrow">当前版本</span><strong>{track.title}</strong><small>{track.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}{track.uploader?.name ? ' · ' + track.uploader.name : ''}</small></div></div>
    <div className="segmented song-group-tabs"><button aria-pressed={!existing} className={!existing ? 'selected' : ''} disabled={busy} onClick={() => { setExisting(false); setPreview(undefined); }}>{owner ? '整理本首歌曲' : '新建歌曲'}</button><button aria-pressed={existing} className={existing ? 'selected' : ''} disabled={busy} onClick={() => { setExisting(true); setPreview(undefined); }}>加入已有歌曲</button></div>
    <form className="song-group-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {existing ? <><label className="field"><span className="field-label">查找歌曲</span><input className="input" aria-label="查找已有歌曲" placeholder="输入歌名或歌手" value={filter} disabled={busy} onChange={event => setFilter(event.target.value)}/></label><div className="song-group-choices" role="radiogroup" aria-label="归入的歌曲">{candidates.map(song => <label className={'song-group-choice' + (target === song.id ? ' selected' : '')} key={song.id}><input type="radio" name="target-song" value={song.id} checked={target === song.id} disabled={busy} onChange={() => changeTarget(song.id)}/><span><strong>{song.title}</strong><small>{song.artists?.join(' / ') || '歌手未填写'}</small></span><small>{(index ? index.versionsBySong.get(song.id)?.length ?? 0 : library.snapshot.versions.filter(v => v.songId === song.id).length)} 个版本</small></label>)}{!songs.length ? <p className="muted">{desktop ? '还没有收藏或加入歌单的歌曲，可以先新建一首。' : '还没有歌曲，可以先新建一首。'}</p> : desktop && !candidates.length && <p className="muted">没有匹配的歌曲。</p>}</div></> : <div className="song-group-fields"><label className="field"><span className="field-label">歌名</span><input className="input" aria-label="归组歌名" autoFocus value={title} maxLength={1000} required disabled={busy} onChange={event => setTitle(event.target.value)}/></label><label className="field"><span className="field-label">歌手</span><input className="input" aria-label="归组歌手" placeholder="例如：周杰伦" value={artists} disabled={busy} onChange={event => setArtists(event.target.value)}/></label></div>}
      {!moving && <label className="field"><span className="field-label">版本名称 <span className="muted">（可选）</span></span><input className="input" aria-label="归组版本名称" placeholder="例如：无损版、现场版" value={label} maxLength={1000} disabled={busy} onChange={event => setLabel(event.target.value)}/></label>}
      <p className="muted song-group-hint">{desktop && existing && !selected ? '请选择当前收藏或歌单中的歌曲。' : existing ? `保存到「${selected?.artists?.join(' / ') ? selected.artists.join(' / ') + ' · ' : ''}${selected?.title ?? '所选歌曲'}」，${selected?.defaultVersionId ? '保留现有默认版本。' : '首个版本自动设为默认。'}` : '保存到我的收藏，首个版本自动设为默认。后续版本只需加入这首歌曲。'}</p>
      {preview && <div className="feedback" role="status"><p>这个版本已归入「{owner?.title}」。确认后将归入「{selected?.title}」，保留歌单中的重复成员。</p>{preview.impact.remoteRemovals.length > 0 && <p>同时会解除 {preview.impact.mappings} 个同步映射，移除远端 {preview.impact.remoteRemovals.length} 个视频。</p>}{preview.revision !== library.revision && <p>资料已变化，请重新预览。</p>}</div>}
      {error && <p className="feedback" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || (existing ? desktop ? !selected : !target : !title.trim()) || !!preview && (preview.revision !== library.revision || preview.expiresAt <= Date.now())}><PlusIcon size={18}/>{busy ? '保存中…' : preview ? '确认归入此歌曲' : moving ? '预览归组影响' : existing ? '添加版本' : '保存歌曲与版本'}</button></div>
    </form>
  </Modal>;
}
