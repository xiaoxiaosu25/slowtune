import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ImageSquareIcon, UploadSimpleIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import type { Song, SongLibraryState } from '../server/song-library-types';
import { maxPlaylistCoverLength, playlistCoverSize as size, validatePlaylistCover } from '../server/playlist-cover';
import { Modal } from './Modal';
import { PagedList } from './Pagination';
import { PlaylistCover } from './PlaylistCover';
import { SongCover } from './SongCover';
import type { SongCommit } from './song-management';
import { errorText, request } from './api';
import './playlist-cover.css';

type Mode = 'upload' | 'songs' | 'auto';
type Crop = { x: number; y: number; zoom: number };
const centered = (): Crop => ({ x: 0, y: 0, zoom: 1 });
const clamp = (value: number) => Math.min(1, Math.max(-1, value));

export function DesktopPlaylistCoverDialog({ library, targetId, songs, image, busy, commit, onClose }: {
  library: SongLibraryState; targetId: string; songs: Song[]; image?: string; busy: boolean; commit: SongCommit; onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('upload'), [query, setQuery] = useState('');
  const [prepared, setPrepared] = useState<{ bitmap: ImageBitmap; mode: Mode; songId?: string }>();
  const [crop, setCrop] = useState(centered), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [revision, setRevision] = useState(library.revision);
  const canvas = useRef<HTMLCanvasElement>(null), work = useRef<AbortController | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; crop: Crop } | undefined>(undefined);
  useEffect(() => () => { work.current?.abort(); }, []);
  useEffect(() => () => prepared?.bitmap.close(), [prepared]);
  const bitmap = prepared?.mode === mode ? prepared.bitmap : undefined;
  const ratio = bitmap ? Math.max(size / bitmap.width, size / bitmap.height) * crop.zoom : 1;
  const overflowX = bitmap ? bitmap.width * ratio - size : 0, overflowY = bitmap ? bitmap.height * ratio - size : 0;
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context || !bitmap) return;
    context.fillStyle = '#F3F0E9'; context.fillRect(0, 0, size, size);
    context.drawImage(bitmap, -overflowX / 2 + crop.x * overflowX / 2, -overflowY / 2 + crop.y * overflowY / 2, bitmap.width * ratio, bitmap.height * ratio);
  }, [bitmap, crop, ratio, overflowX, overflowY]);
  const autoSong = songs.find(song => song.artwork);
  const candidates = [...new Map(songs.filter(song => song.artwork).map(song => [song.id, song])).values()]
    .filter(song => `${song.title} ${song.artists?.join(' ') ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const locked = busy || saving;
  const close = () => { if (!saving) onClose(); };
  const changeMode = (value: Mode) => { work.current?.abort(); work.current = undefined; drag.current = undefined; setLoading(false); setError(''); setMode(value); };
  async function prepare(load: (signal: AbortSignal) => Promise<Blob>, source: Mode, songId?: string) {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setLoading(true); setError('');
    let next: ImageBitmap | undefined;
    try {
      const blob = await load(controller.signal); controller.signal.throwIfAborted();
      next = await createImageBitmap(blob); controller.signal.throwIfAborted();
      if (!next.width || !next.height || next.width * next.height > 60_000_000) throw new Error('图片尺寸过大，请先缩小后重新选择。');
      if (Math.max(next.width, next.height) > 2048) {
        const scale = 2048 / Math.max(next.width, next.height);
        const resized = await createImageBitmap(next, { resizeWidth: Math.max(1, Math.round(next.width * scale)), resizeHeight: Math.max(1, Math.round(next.height * scale)), resizeQuality: 'high' });
        next.close(); next = resized; controller.signal.throwIfAborted();
      }
      setPrepared({ bitmap: next, mode: source, songId }); next = undefined; setCrop(centered());
    } catch (issue) {
      if (!controller.signal.aborted) setError((issue as Error).message === '图片尺寸过大，请先缩小后重新选择。' ? (issue as Error).message : '无法读取这张图片，请重试或选择其他图片。');
    } finally { next?.close(); if (work.current === controller) { work.current = undefined; setLoading(false); } }
  }
  const chooseSong = (song: Song) => void prepare(async signal => {
    const result = await request<{ image: string }>('/api/song-library/covers/source', { targetId, songId: song.id }, signal);
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.image);
    if (!match) throw new Error('image');
    return new Blob([Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))], { type: match[1] });
  }, 'songs', song.id);
  const move = (x: number, y: number, base = crop) => setCrop({ ...base, x: overflowX > 0 ? clamp(base.x + x * 2 / overflowX) : 0, y: overflowY > 0 ? clamp(base.y + y * 2 / overflowY) : 0 });
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const scale = size / event.currentTarget.getBoundingClientRect().width;
    move((event.clientX - drag.current.x) * scale, (event.clientY - drag.current.y) * scale, drag.current.crop);
  };
  async function save() {
    if (locked || loading || conflict || mode !== 'auto' && !bitmap) return;
    setSaving(true); setError('');
    try {
      const next = mode === 'auto' ? null : canvas.current!.toDataURL('image/jpeg', .88);
      if (next) { if (next.length > maxPlaylistCoverLength) throw new Error('cover-size'); validatePlaylistCover(next); }
      const saved = await commit([{ type: 'set-playlist-cover', targetId, image: next }], revision, true);
      if (saved) onClose(); else setError('暂未保存，当前选择已保留，请重试。');
    } catch (issue) {
      setConflict((issue as { code?: string }).code === 'conflict');
      setError((issue as Error).message === 'cover-size' ? '图片压缩后仍过大，请降低缩放或选择其他图片。' : errorText(issue));
    } finally { setSaving(false); }
  }
  return <Modal title="更换封面" className="playlist-cover-modal" onClose={close}>
    <p className="muted playlist-cover-title">{targetId === 'system:favorites' ? '我的收藏' : library.snapshot.playlists.find(p => p.id === targetId)?.name}</p>
    <div className="segmented playlist-cover-modes" role="group" aria-label="封面来源">
      {([['upload', '上传图片', UploadSimpleIcon], ['songs', '从歌曲选择', ImageSquareIcon], ['auto', '恢复自动封面', ArrowCounterClockwiseIcon]] as const).map(([value, label, Icon]) => <button key={value} disabled={locked} className={mode === value ? 'selected' : ''} aria-pressed={mode === value} onClick={() => changeMode(value)}><Icon size={18}/>{label}</button>)}
    </div>
    <div className="playlist-cover-body">
      <div className="playlist-cover-source">
        {mode === 'upload' && <><label className="field"><span className="field-label">选择图片</span><input className="input" type="file" aria-label="上传封面图片" accept="image/jpeg,image/png,image/webp" disabled={locked} data-autofocus="true" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) { work.current?.abort(); work.current = undefined; setLoading(false); setError('请选择不超过 12 MiB 的 JPG、PNG 或 WebP 图片。'); return; }
          void prepare(async () => file, 'upload');
        }}/></label><p className="muted">支持 JPG、PNG、WebP，最大 12 MiB。选择后可拖动和缩放，保存为正方形封面。</p></>}
        {mode === 'songs' && <><label className="field"><span className="field-label">搜索当前列表中的歌曲</span><input className="input" aria-label="搜索封面歌曲" value={query} onChange={event => setQuery(event.target.value)} disabled={locked}/></label>
          <PagedList id={'cover:' + targetId + ':' + query} group="library" label="封面歌曲" items={candidates}>{items => <div className="playlist-cover-grid">{items.map(song => <button className={'playlist-cover-choice' + (prepared?.mode === 'songs' && prepared.songId === song.id ? ' selected' : '')} key={song.id} disabled={locked} aria-pressed={prepared?.mode === 'songs' && prepared.songId === song.id} aria-label={'使用封面 ' + song.title} title={song.title + (song.artists?.length ? ' · ' + song.artists.join(' / ') : '')} onClick={() => chooseSong(song)}><SongCover song={song}/><strong>{song.title}</strong><small>{song.artists?.join(' / ') || '歌手待整理'}</small></button>)}</div>}</PagedList>
          {!candidates.length && <p className="muted">{songs.some(song => song.artwork) ? '没有匹配的歌曲。' : '当前列表还没有可用的歌曲封面，可以上传图片。'}</p>}
        </>}
        {mode === 'auto' && <p className="muted">使用列表中第一首有封面的歌曲，随歌曲顺序自动更新。列表没有可用封面时显示默认图标。</p>}
      </div>
      <div className="playlist-cover-preview"><span className="field-label">{bitmap || mode === 'auto' ? '封面预览' : '当前封面'}</span>
        {bitmap ? <><canvas ref={canvas} width={size} height={size} tabIndex={0} role="img" aria-label="封面裁剪预览，可拖动或用方向键移动图片" onPointerDown={event => { if (locked) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop }; }} onPointerMove={pointerMove} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }} onKeyDown={event => { const delta: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }; if (delta[event.key] && !locked) { event.preventDefault(); move(...delta[event.key]); } }}/>
          <label className="playlist-cover-zoom"><span>缩放</span><input type="range" aria-label="封面缩放" min="1" max="4" step="0.01" value={crop.zoom} disabled={locked} onChange={event => setCrop(old => ({ ...old, zoom: Number(event.target.value) }))}/><output>{Math.round(crop.zoom * 100)}%</output></label><button className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setCrop(centered())}>重新居中</button>
        </> : <PlaylistCover image={mode === 'auto' ? undefined : image} song={autoSong} className="playlist-cover-sample"/>}
        {mode !== 'auto' && <p className="muted">保存后固定使用这张图片，移除歌曲也会保留。</p>}
      </div>
    </div>
    {loading && <p role="status" className="muted">正在读取图片…</p>}
    {error && <p className="feedback" role="alert">{error}</p>}
    {conflict && <div className="playlist-cover-conflict"><PlaylistCover image={image} song={autoSong}/><span>资料库当前封面</span><button className="btn btn-secondary" onClick={() => { setRevision(library.revision); setConflict(false); setError('当前选择已保留，请确认预览后再次保存。'); }}>已核对，保留我的选择</button></div>}
    <div className="modal-actions"><button className="btn btn-ghost" disabled={saving} onClick={close}>取消</button><button className="btn btn-primary" disabled={locked || loading || conflict || mode !== 'auto' && !bitmap} onClick={() => void save()}>{saving ? '正在保存…' : '保存封面'}</button></div>
  </Modal>;
}
