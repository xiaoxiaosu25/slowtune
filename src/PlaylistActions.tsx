import { useState, type ComponentProps, type ReactNode } from 'react';
import { CameraIcon, ListBulletsIcon, PencilSimpleIcon, PlayIcon, PlusIcon, QueueIcon, TrashIcon } from '@phosphor-icons/react';
import type { SongLibraryState, SongPlaybackSelection, Song } from '../server/song-library-types';
import type { SongCommit } from './song-management';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { Modal } from './Modal';
import { errorText } from './api';
import { desktopFeature } from './DesktopRegion';
import { DesktopPlaylistCoverDialog as coverDialogUrl } from 'virtual:desktop-feature-urls';

const CoverDialog = desktopFeature<ComponentProps<typeof import('./DesktopPlaylistCoverDialog').DesktopPlaylistCoverDialog>>(coverDialogUrl, 'DesktopPlaylistCoverDialog', '歌单封面');
type Selection = { selection: SongPlaybackSelection; song: Song };
export function PlaylistActions({ library, targetId, commit, busy, target, className, trigger, selections, onOpen, onPlay, onEnqueue, onCreate, onManage, onBackup, onRename, onDelete, onCover, youtubeEnabled = true }: {
  library: SongLibraryState; targetId: string; commit: SongCommit; busy: boolean; target: string; className?: string; trigger?: ReactNode;
  onOpen?: () => void; onPlay: (items: Selection[]) => void; onEnqueue?: (items: Selection[]) => Promise<unknown>; onCreate: () => void; onManage?: () => void; onBackup: () => void; youtubeEnabled?: boolean;
  onRename?: () => void; onDelete?: () => void; onCover?: () => void;
  selections?: Selection[];
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'cover'>(), [name, setName] = useState(''), [error, setError] = useState('');
  const snapshot = library.snapshot, playlist = snapshot.playlists.find(item => item.id === targetId), favorites = targetId === 'system:favorites';
  const songs = new Map(snapshot.songs.map(song => [song.id, song]));
  const members = favorites ? snapshot.favorites : playlist?.entries ?? [];
  const items: Selection[] = members.flatMap(member => {
    const song = songs.get(member.songId); if (!song) return [];
    const pinned = 'pinnedVersionId' in member ? member.pinnedVersionId : undefined;
    return [{ song, selection: { kind: 'song', songId: song.id, ...(pinned ? { pinnedVersionId: pinned } : {}) } }];
  });
  const playable = (selections ?? items).filter(({ song, selection }) => {
    const versionId = selection.kind === 'song' ? selection.pinnedVersionId ?? song.defaultVersionId : undefined;
    return youtubeEnabled || snapshot.versions.find(version => version.id === versionId)?.ref.provider !== 'youtube';
  });
  const title = favorites ? '我的收藏' : playlist?.name ?? '歌单';
  const image = favorites ? snapshot.desktopFavoritesCover : playlist?.desktopCover;
  const open = (next: typeof dialog) => { setError(''); setDialog(next); };
  const save = async (edits: unknown[]) => {
    setError('');
    try { if (await commit(edits, undefined, true)) setDialog(undefined); else setError('未能保存，内容已保留，请重试。'); }
    catch (issue) { setError(errorText(issue)); }
  };
  const actions: MenuAction[] = [
    ...(onOpen ? [{ id: 'open', label: '打开歌单', onSelect: onOpen }] : []),
    { id: 'play', label: '播放全部', icon: <PlayIcon size={18}/>, disabled: !playable.length, onSelect: () => onPlay(playable) },
    ...(onEnqueue ? [{ id: 'enqueue', label: '加入队尾', icon: <QueueIcon size={18}/>, disabled: !playable.length, onSelect: () => { void onEnqueue(playable); } }] : []),
    { separator: true },
    { id: 'cover', label: '更换封面…', icon: <CameraIcon size={18}/>, disabled: busy, onSelect: onCover ?? (() => open('cover')) },
    ...(playlist ? [{ id: 'rename', label: '歌单改名', icon: <PencilSimpleIcon size={18}/>, disabled: busy, onSelect: onRename ?? (() => { setName(playlist.name); open('rename'); }) }] : []),
    { id: 'create', label: '新建歌单', icon: <PlusIcon size={18}/>, onSelect: onCreate },
    ...(onManage ? [{ id: 'manage', label: '歌曲管理', icon: <ListBulletsIcon size={18}/>, onSelect: onManage }] : []),
    { id: 'backup', label: '导入 / 导出', onSelect: onBackup },
    ...(playlist ? [{ separator: true } as const, { id: 'delete', label: '删除歌单', icon: <TrashIcon size={18}/>, disabled: busy, danger: true, onSelect: onDelete ?? (() => open('delete')) }] : []),
  ];
  return <>
    <ActionMenu label="歌单管理" title={title} subtitle={selections && selections.length !== items.length ? `当前筛选 ${selections.length} / ${items.length} 首` : items.length + ' 首歌曲'} target={target} className={className} trigger={trigger} buttonClassName="btn-secondary" actions={actions}/>
    {dialog === 'rename' && playlist && <Modal title="歌单改名" onClose={() => setDialog(undefined)}><form onSubmit={event => { event.preventDefault(); void save([{ type: 'rename-playlist', playlistId: targetId, name: name.trim() }]); }}><label className="field"><span className="field-label">歌单名称</span><input className="input" aria-label="歌单名称" data-autofocus="true" value={name} maxLength={200} required onChange={event => setName(event.target.value)}/></label>{error && <p className="feedback" role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy || !name.trim()}>保存歌单</button></form></Modal>}
    {dialog === 'delete' && playlist && <Modal title="删除歌单" onClose={() => setDialog(undefined)}><p>删除「{title}」及 {items.length} 个成员，歌曲资料和当前队列保留。</p>{error && <p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="btn btn-ghost" onClick={() => setDialog(undefined)}>取消</button><button className="btn btn-danger" disabled={busy} onClick={() => void save([{ type: 'delete-playlist', playlistId: targetId }])}>确认删除</button></div></Modal>}
    {dialog === 'cover' && <CoverDialog library={library} targetId={targetId} songs={items.map(item => item.song)} image={image} busy={busy} commit={commit} onClose={() => setDialog(undefined)}/>}
  </>;
}
