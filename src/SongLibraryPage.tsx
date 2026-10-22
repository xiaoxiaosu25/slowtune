import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HeartIcon, MusicNotesIcon, PlayIcon, DotsThreeIcon, ArrowUpIcon, ArrowDownIcon, TrashIcon, PlusIcon, CameraIcon } from '@phosphor-icons/react';
import type { Song, SongLibraryState, SongPlaybackSelection, SongPlaylistEntry, SongVersion } from '../server/song-library-types';
import { Modal } from './Modal';
import { errorText, availabilityText } from './api';
import { PagedList } from './Pagination';
import './song-library.css';
import { SongMaintenancePanel } from './SongMaintenancePanel';
import { SongOrganizationPanel } from './SongOrganizationPanel';
import { ControlPopover } from './ControlPopover';
import { SongCover } from './SongCover';
import { DesktopSongDialog } from './DesktopSongDialog';
import type { SongCommit, SongDialogContext } from './song-management';
import { desktopSongIndex } from './desktop-song-index';
import { PlaylistCover } from './PlaylistCover';
import { DesktopPlaylistCoverDialog } from './DesktopPlaylistCoverDialog';
export { SongCover } from './SongCover';
export type { SongCommit } from './song-management';

export const songFavoritesId = 'system:favorites';
function SongEditor({ song, state, commit, onSearch, onPlay, onClose, onChange }: { song: Song; state: SongLibraryState; commit: SongCommit; onSearch: (song: Song) => void; onPlay: (selection: SongPlaybackSelection, song: Song) => void; onClose: () => void; onChange: (state: SongLibraryState) => void }) {
  const [title, setTitle] = useState(song.title), [artists, setArtists] = useState(song.artists?.join('\n') ?? ''), [revision, setRevision] = useState(state.revision);
  const [dirty,setDirty]=useState({title:false,artists:false});
  const [editingInfo,setEditingInfo]=useState(false);
  useEffect(()=>{if(!dirty.title)setTitle(song.title);if(!dirty.artists)setArtists(song.artists?.join('\n')??'');},[song.title,JSON.stringify(song.artists),dirty.title,dirty.artists]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [labels, setLabels] = useState<Record<string, string>>({});
  const [kinds,setKinds]=useState<Record<string,string>>({}),[performers,setPerformers]=useState<Record<string,string>>({});
  const versions = state.snapshot.versions.filter(version => version.songId === song.id);
  const run = async (edits: unknown[]) => { setBusy(true); setError(''); try { const saved = await commit(edits, revision); if (saved) { setRevision(saved.revision); return true; } setError('未能保存，请检查提示并重读当前修订。草稿已保留。'); } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); } return false; };
  return <Modal title="歌曲与版本" className="song-editor-modal" onClose={onClose}>
    <div className="song-editor-heading"><SongCover song={song}/><div><h3>{song.title}</h3><p className="muted">{song.artists?.join(' / ')||'歌手未填写'}</p></div><button className="btn btn-ghost btn-sm" aria-expanded={editingInfo} onClick={()=>setEditingInfo(!editingInfo)}>编辑资料</button></div>
    {editingInfo&&<form className="song-info-form" onSubmit={event => { event.preventDefault(); const patch: Record<string, unknown> = { type: 'edit-song', songId: song.id }; if (dirty.title) patch.title = title.trim(); if(dirty.artists) patch.artists = artists.split('\n').map(value => value.trim()).filter(Boolean); if (Object.keys(patch).length > 2) void run([patch]).then(saved=>{if(saved){setDirty({title:false,artists:false});setEditingInfo(false);}}); }}>
      <label className="field"><span className="field-label">标准歌名</span><input className="input" aria-label="标准歌名" value={title} maxLength={1000} onChange={event => {setTitle(event.target.value);setDirty(old=>({...old,title:true}));}} required disabled={busy}/></label>
      <label className="field"><span className="field-label">歌手（每行一位）</span><textarea className="textarea" aria-label="歌曲歌手" value={artists} onChange={event => {setArtists(event.target.value);setDirty(old=>({...old,artists:true}));}} rows={3} disabled={busy}/></label>
      <button className="btn btn-primary" disabled={busy || !title.trim()}>保存歌曲资料</button>
    </form>}
    <SongOrganizationPanel song={song} revision={state.revision} disabled={busy || dirty.title || dirty.artists} onChange={saved => { setRevision(saved.revision); onChange(saved); }}/>
    <section className="song-version-section"><div className="section-heading"><h3>播放版本 <small>{versions.length}</small></h3><button className="btn btn-secondary btn-sm" onClick={()=>{onClose();onSearch(song);}}><PlusIcon size={17}/>搜索并添加版本</button></div>{!versions.length && <p className="muted">还没有版本。添加第一个版本后，将默认播放它。</p>}
      {versions.map(version => <div className="song-version-item" key={version.id}><div className="song-version-copy"><strong>{version.label || version.facts.title}</strong><p className="muted">{version.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}{version.facts.uploader ? ' · '+version.facts.uploader : ''}{version.id === song.defaultVersionId && <span className="song-default-badge">默认播放</span>}</p></div>
        <div className="song-version-actions"><button className="btn btn-secondary btn-sm" onClick={() => onPlay({ kind: 'song', songId: song.id, explicitVersionId: version.id }, song)}><PlayIcon size={16}/>播放此版本</button><button className="btn btn-ghost btn-sm" disabled={busy || song.defaultVersionId === version.id} onClick={() => void run([{ type: 'set-default', songId: song.id, versionId: version.id }])}>设为默认版本</button></div>
        <details className="song-version-details"><summary>版本详情</summary>
        <label className="field"><span className="field-label">版本名称</span><input className="input" aria-label={'版本名称 ' + version.facts.title} value={labels[version.id] ?? version.label} disabled={busy} onChange={event => setLabels(old => ({ ...old, [version.id]: event.target.value }))}/></label>
        <label className="field"><span className="field-label">版本类别</span><select className="select" aria-label={'版本类别 '+version.facts.title} value={kinds[version.id]??version.kind} onChange={event=>setKinds(old=>({...old,[version.id]:event.target.value}))}><option value="studio">录音室</option><option value="mv">MV</option><option value="live">现场</option><option value="cover">翻唱</option><option value="remix">混音</option><option value="other">其他</option></select></label>
        <label className="field"><span className="field-label">此版本演唱者（每行一位）</span><textarea className="textarea" aria-label={'版本演唱者 '+version.facts.title} rows={2} value={performers[version.id]??version.performers?.join('\n')??''} onChange={event=>setPerformers(old=>({...old,[version.id]:event.target.value}))}/></label>
        <div className="toolbar"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run([{ type: 'edit-version', versionId: version.id, label: labels[version.id] ?? version.label,kind:kinds[version.id]??version.kind,...(performers[version.id]!==undefined?{performers:performers[version.id].split('\n').map(value=>value.trim()).filter(Boolean)}:{}) }])}>保存版本资料</button><a className="btn btn-ghost btn-sm" href={version.facts.url} target="_blank" rel="noreferrer">查看来源</a></div></details>
      </div>)}{song.defaultVersionId&&<details className="song-version-details"><summary>更多设置</summary><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void run([{type:'set-default',songId:song.id,versionId:null}])}>取消默认版本</button></details>}
    </section>
    {revision !== state.revision && <div className="feedback" role="alert"><p>资料已变化，草稿已保留。核对最新资料后再采用当前修订。</p><button className="btn btn-secondary" onClick={() => setRevision(state.revision)}>采用当前修订并保留草稿</button></div>}
    {error && <p className="feedback" role="alert">{error}</p>}
  </Modal>;
}
type Props = {
  state: SongLibraryState | null; selected: string; onSelect: (id: string) => void; commit: SongCommit; onBackup: () => void; onSearch: (song?: Song, onReturn?: () => void) => void;
  onPlay: (selection: SongPlaybackSelection, song: Song) => void; onPlayAll: (items: { selection: SongPlaybackSelection; song: Song }[]) => void; busy: boolean;
  onChange: (state: SongLibraryState) => void;
  loadError?: string; onRetry?: () => void;
  youtubeEnabled?: boolean; disabledDisplay?: 'show' | 'dim' | 'hide'; source?: 'all' | 'bilibili' | 'youtube';
  sourceControls?: ReactNode; desktop?: boolean;
  onManage?: () => void;
};

const MemoSongLibraryPage = memo(SongLibraryPage);
const MemoDesktopSongDialog = memo(DesktopSongDialog);
/** Keep media-clock renders outside the desktop library, while actions see current state. */
export function SongLibraryWorkspace(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [managing, setManaging] = useState(false);
  const actions = useMemo<Pick<Props, 'onSelect' | 'commit' | 'onBackup' | 'onSearch' | 'onPlay' | 'onPlayAll' | 'onChange' | 'onRetry' | 'onManage'>>(() => ({
    onSelect: id => latest.current.onSelect(id), commit: (...args) => latest.current.commit(...args),
    onBackup: () => latest.current.onBackup(), onSearch: (...args) => latest.current.onSearch(...args),
    onPlay: (...args) => latest.current.onPlay(...args), onPlayAll: items => latest.current.onPlayAll(items),
    onChange: state => latest.current.onChange(state), onRetry: () => latest.current.onRetry?.(),
    onManage: () => setManaging(true),
  }), []);
  const managerActions = useMemo(() => ({ onClose: () => setManaging(false), commit: (edits: unknown[], revision?: string | null) => latest.current.commit(edits, revision, true) }), []);
  // Keep the same component across viewport changes so open editors retain their drafts.
  // Mobile keeps the original callbacks and render path.
  return <><MemoSongLibraryPage {...props} {...(props.desktop ? actions : {})}/>{managing && props.state && <MemoDesktopSongDialog library={props.state} commit={managerActions.commit} youtubeEnabled={props.youtubeEnabled ?? true} onChange={actions.onChange} onClose={managerActions.onClose} onSearch={actions.onSearch} onPlay={actions.onPlay}/>}</>;
}

export function SongLibraryPage({ state, selected, onSelect, commit, onBackup, onSearch, onPlay, onPlayAll, busy, onChange, loadError, onRetry, youtubeEnabled = true, disabledDisplay = 'dim', source = 'all', sourceControls, desktop = false, onManage }: Props) {
  const [filter, setFilter] = useState(''), [editing, setEditing] = useState<string>(), [name, setName] = useState(''), [creating, setCreating] = useState<'new' | 'rename'>(), [destination, setDestination] = useState(''), [remove, setRemove] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [desktopContext, setDesktopContext] = useState<SongDialogContext>(), [managing, setManaging] = useState(false), [adding, setAdding] = useState<Song>();
  const [addError, setAddError] = useState('');
  const [playlistFormError, setPlaylistFormError] = useState('');
  const [coverTarget, setCoverTarget] = useState<string>();
  useEffect(() => { setCoverTarget(undefined); }, [selected, desktop]);
  useEffect(() => { setPlaylistFormError(''); }, [creating, remove]);
  const changePlaylist = (edits: unknown[], complete: () => void) => {
    if (!desktop) { void commit(edits).then(saved => { if (saved) complete(); }); return; }
    setPlaylistFormError('');
    void commit(edits, undefined, true).then(saved => { if (saved) complete(); else setPlaylistFormError('未能保存，内容已保留，请重试。'); }).catch(issue => setPlaylistFormError(errorText(issue)));
  };
  const index = useMemo(() => {
    if (desktop && state) return desktopSongIndex(state.snapshot);
    const versionsBySong = new Map<string, SongVersion[]>();
    for (const version of state?.snapshot.versions ?? []) {
      const versions = versionsBySong.get(version.songId) ?? [];
      versions.push(version); versionsBySong.set(version.songId, versions);
    }
    return {
      songs: new Map(state?.snapshot.songs.map(song => [song.id, song]) ?? []),
      versions: new Map(state?.snapshot.versions.map(version => [version.id, version]) ?? []),
      favorites: new Map(state?.snapshot.favorites.map(favorite => [favorite.songId, favorite]) ?? []),
      versionsBySong,
    };
  }, [state, desktop]);
  if (!state) return loadError ? <div className="feedback" role="alert"><p>歌单与收藏暂时无法读取。{loadError}</p><button className="btn btn-secondary" onClick={onRetry}>重试读取歌单</button></div> : <p className="loading">正在读取歌单与收藏…</p>;
  const playlist = state.snapshot.playlists.find(playlist => playlist.id === selected), favorites = selected === songFavoritesId;
  const members = favorites ? state.snapshot.favorites.map(favorite => ({ id: favorite.favoriteId, songId: favorite.songId, entry: undefined as SongPlaylistEntry | undefined })) : (playlist?.entries ?? []).map(entry => ({ id: entry.entryId, songId: entry.songId, entry }));
  const rows = members.flatMap((member, position) => { const song = index.songs.get(member.songId); return song ? [{ ...member, position, song, selection: { kind: 'song' as const, songId: song.id, ...(member.entry?.pinnedVersionId ? { pinnedVersionId: member.entry.pinnedVersionId } : {}) } }] : []; });
  const coverImage = favorites ? state.snapshot.desktopFavoritesCover : playlist?.desktopCover;
  const autoCoverSong = desktop ? rows.find(row => row.song.artwork)?.song : rows[0]?.song;
  const chosenFor = (row: typeof rows[number]) => index.versions.get(row.entry?.pinnedVersionId ?? row.song.defaultVersionId ?? '');
  const blocked = (row: typeof rows[number]) => !youtubeEnabled && chosenFor(row)?.ref.provider === 'youtube';
  const visible = rows.filter(row => `${row.song.title} ${row.song.artists?.join(' ') ?? ''}`.toLowerCase().includes(filter.toLowerCase()) && !(blocked(row) && disabledDisplay === 'hide') && (source === 'all' || index.versionsBySong.get(row.songId)?.some(v => v.ref.provider === source)));
  const move = (id: string, delta: number) => { const ids = members.map(member => member.id), index = ids.indexOf(id), at = index + delta; if (at < 0 || at >= ids.length) return; ids.splice(index, 1); ids.splice(at, 0, id); void commit([favorites ? { type: 'reorder-favorites', favoriteIds: ids } : { type: 'reorder-entries', playlistId: selected, entryIds: ids }]); };
  const edited = index.songs.get(editing ?? '');
  const openEditor = (row: typeof rows[number]) => desktop ? setDesktopContext({ songId: row.songId, ...(row.entry ? { playlistId: selected, entryId: row.id } : {}), versionId: chosenFor(row)?.id }) : setEditing(row.songId);
  return <section className="catalog list-view">
    <div className="page-heading"><h1>我的歌单</h1><div className="page-actions"><button className="btn btn-secondary" onClick={() => desktop ? onManage ? onManage() : setManaging(true) : setMaintenance(true)}>{desktop ? '歌曲管理' : '资料库维护'}</button><button className="btn btn-secondary" onClick={onBackup}>导入 / 导出</button><button className="btn btn-primary" onClick={() => { setName(''); setCreating('new'); }}><PlusIcon size={18}/>新建歌单</button></div></div>
    {sourceControls}
    {loadError && <div className="feedback" role="status"><p>歌单更新暂时失败，当前内容保留。{loadError}</p><button className="btn btn-secondary" onClick={onRetry}>重试读取歌单</button></div>}
    <div className="segmented playlist-switcher" aria-label="选择歌单"><button className={favorites ? 'selected' : ''} onClick={() => onSelect(songFavoritesId)}>我的收藏<small>{state.snapshot.favorites.length} 首</small></button>{state.snapshot.playlists.map(playlist => <button key={playlist.id} className={selected === playlist.id ? 'selected' : ''} onClick={() => onSelect(playlist.id)}>{playlist.name}<small>{playlist.entries.length} 首</small></button>)}</div>
    <div className="playlist-intro">{desktop ? <button className="playlist-cover-button" aria-label="更换封面" title="更换封面" disabled={busy || !favorites && !playlist} onClick={() => setCoverTarget(selected)}><PlaylistCover image={coverImage} song={autoCoverSong} className="playlist-art"/><span className="playlist-cover-overlay"><CameraIcon size={28}/><span>更换封面</span></span></button> : <SongCover song={rows[0]?.song} className="playlist-art"/>}<div className="playlist-copy"><h2>{favorites ? '我的收藏' : playlist?.name}</h2><p>{members.length} 首歌曲</p><div className="toolbar"><button className="btn btn-primary play-all" disabled={!visible.some(row => !blocked(row))} onClick={() => onPlayAll(visible.map(({ selection, song }) => ({ selection, song })))}><PlayIcon size={18}/>播放全部</button>{playlist && <><button className="btn btn-secondary" onClick={() => { setName(playlist.name); setCreating('rename'); }}>改名</button><button className="btn btn-secondary" onClick={() => setRemove(true)}>删除歌单</button></>}</div></div></div>
    {desktop ? <div className="playlist-list-toolbar"><label className="search-field search-field-inline"><input aria-label="搜索歌单内音乐" placeholder="搜索歌单内音乐" value={filter} onChange={event => setFilter(event.target.value)}/></label><span className="muted">{visible.length} 首歌曲</span></div> : <label className="search-field search-field-inline"><input aria-label="搜索歌单内音乐" placeholder="搜索歌单内音乐" value={filter} onChange={event => setFilter(event.target.value)}/></label>}
    <PagedList id={'songs:' + selected + ':' + filter} group="library" label="歌单歌曲" items={visible}>{items => items.length ? <div className="track-list">{items.map(row => {
      const versions = index.versionsBySong.get(row.songId) ?? [], chosen = chosenFor(row), favorite = index.favorites.get(row.songId);
      return <div className={'song-library-row' + (blocked(row) && disabledDisplay === 'dim' ? ' source-disabled' : '')} key={row.id}>
        <span className="row-number">{row.position + 1}</span>
        <button className="row-cover" aria-label={'播放 ' + row.song.title} disabled={blocked(row)} onClick={() => onPlay(row.selection, row.song)}><SongCover song={row.song}/></button>
        <div className="row-info">
          <button className="track-name" title={row.song.title} disabled={blocked(row)} onClick={() => onPlay(row.selection, row.song)}>{row.song.title}</button>
          <p className="row-sub">{row.song.artists?.join(' / ') || '歌手待整理'}</p>
          {versions.length > 1 && <button className="song-version-link" aria-label={'选择播放版本 ' + row.song.title} title={chosen?.label || chosen?.facts.title} onClick={() => openEditor(row)}>{versions.length} 个版本</button>}
          {row.entry?.pinnedVersionId && chosen && <span className="row-status">固定 · {chosen.label || chosen.facts.title}</span>}
          {!chosen && <span className="row-status">播放时自动匹配</span>}
        {chosen && ['unavailable','uncertain'].includes(chosen.availability.state) && 'code' in chosen.availability && <span className="row-warning">{availabilityText(chosen.availability.code)}</span>}
        </div>
        <button className={'btn btn-icon ' + (favorite ? 'saved' : '')} aria-label={(favorite ? '取消收藏 ' : '收藏 ') + row.song.title} disabled={busy} onClick={() => void commit([favorite ? { type: 'remove-favorite', favoriteId: favorite.favoriteId } : { type: 'favorite', songId: row.songId }])}><HeartIcon size={20} weight={favorite ? 'fill' : 'regular'}/></button>
        {desktop ? <ControlPopover className="song-row-menu" label={'更多操作 ' + row.song.title} icon={<DotsThreeIcon size={24}/>} side="bottom">
          <button aria-label={'编辑歌曲 ' + row.song.title} onClick={() => openEditor(row)}>歌曲与版本</button>
          <button onClick={() => { setDestination(''); setAddError(''); setAdding(row.song); }}><PlusIcon size={18}/>加入歌单</button>
          <button aria-label={'上移 ' + row.song.title} disabled={busy || row.position === 0} onClick={() => move(row.id, -1)}><ArrowUpIcon size={18}/>上移</button>
          <button aria-label={'下移 ' + row.song.title} disabled={busy || row.position === members.length - 1} onClick={() => move(row.id, 1)}><ArrowDownIcon size={18}/>下移</button>
          {row.entry && <button className="danger-text" aria-label={'从歌单移除 ' + row.song.title} disabled={busy} onClick={() => void commit([{ type: 'remove-entry', playlistId: selected, entryId: row.id }])}><TrashIcon size={18}/>从歌单移除</button>}
        </ControlPopover> : <details className="song-row-options"><summary className="btn btn-icon" aria-label={'更多操作 ' + row.song.title} title="更多操作"><DotsThreeIcon size={24}/></summary>
          <div className="toolbar">
            <button className="btn btn-secondary btn-sm" aria-label={'编辑歌曲 ' + row.song.title} onClick={() => setEditing(row.songId)}>歌曲与版本</button>
            <button className="btn btn-ghost btn-sm" aria-label={'上移 ' + row.song.title} disabled={busy || row.position === 0} onClick={() => move(row.id, -1)}><ArrowUpIcon size={18}/>上移</button>
            <button className="btn btn-ghost btn-sm" aria-label={'下移 ' + row.song.title} disabled={busy || row.position === members.length - 1} onClick={() => move(row.id, 1)}><ArrowDownIcon size={18}/>下移</button>
            {row.entry && <button className="btn btn-ghost btn-sm" aria-label={'从歌单移除 ' + row.song.title} disabled={busy} onClick={() => void commit([{ type: 'remove-entry', playlistId: selected, entryId: row.id }])}><TrashIcon size={18}/>从歌单移除</button>}
          </div>
          {row.entry && versions.length > 0 && <label className="field"><span className="field-label">歌单播放版本</span><select className="select" aria-label={'固定版本 ' + row.song.title} value={row.entry.pinnedVersionId ?? ''} disabled={busy} onChange={event => void commit([{ type: 'pin-entry', playlistId: selected, entryId: row.id, versionId: event.target.value || null }])}><option value="">跟随歌曲默认</option>{versions.map(version => <option key={version.id} value={version.id}>{version.label || version.facts.title}</option>)}</select></label>}
          <label className="field"><span className="field-label">加入歌单</span><select className="select" aria-label={'添加目标 ' + row.song.title} value={destination} onChange={event => setDestination(event.target.value)}><option value="">选择歌单</option>{state.snapshot.playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button className="btn btn-secondary" disabled={busy || !destination} onClick={() => void commit([{ type: 'add-entry', playlistId: destination, songId: row.songId }])}>添加歌曲</button></label>
        </details>}
      </div>;
    })}</div> : <div className="empty"><MusicNotesIcon size={36}/><h3>这里还没有匹配的歌曲</h3><button className="btn btn-secondary" onClick={() => onSearch()}>去搜索音乐</button></div>}</PagedList>
    {creating && <Modal title={creating === 'rename' ? '歌单改名' : '新建歌单'} onClose={() => setCreating(undefined)}><form onSubmit={event => { event.preventDefault(); changePlaylist([creating === 'rename' && playlist ? { type: 'rename-playlist', playlistId: playlist.id, name: name.trim() } : { type: 'create-playlist', name: name.trim() }], () => setCreating(undefined)); }}><label className="field"><span className="field-label">歌单名称</span><input className="input" aria-label="歌单名称" value={name} maxLength={200} required onChange={event => setName(event.target.value)}/></label>{desktop && playlistFormError && <p className="feedback" role="alert">{playlistFormError}</p>}<button className="btn btn-primary" disabled={busy || !name.trim()}>保存歌单</button></form></Modal>}
    {desktop && coverTarget === selected && (favorites || playlist) && <DesktopPlaylistCoverDialog key={selected} library={state} targetId={selected} songs={rows.map(row => row.song)} image={coverImage} busy={busy} commit={commit} onClose={() => setCoverTarget(undefined)}/>}
    {remove && playlist && <Modal title="删除歌单" onClose={() => setRemove(false)}><p>删除「{playlist.name}」及 {playlist.entries.length} 个成员，歌曲资料和当前队列保留。</p>{desktop && playlistFormError && <p className="feedback" role="alert">{playlistFormError}</p>}<button className="btn btn-danger" disabled={busy} onClick={() => changePlaylist([{ type: 'delete-playlist', playlistId: playlist.id }], () => setRemove(false))}>确认删除</button></Modal>}
    {edited && <SongEditor key={edited.id} song={edited} state={state} commit={commit} onPlay={onPlay} onSearch={onSearch} onClose={() => setEditing(undefined)} onChange={onChange}/>}
    {maintenance && <SongMaintenancePanel library={state} onChange={onChange} onClose={() => setMaintenance(false)}/>}
    {(desktopContext || managing) && <DesktopSongDialog library={state} context={desktopContext} commit={(edits,revision)=>commit(edits,revision,true)} youtubeEnabled={youtubeEnabled} onChange={onChange} onPlay={onPlay} onSearch={onSearch} onClose={() => { setDesktopContext(undefined); setManaging(false); }}/>}
    {adding && <Modal title={'加入歌单 · ' + adding.title} className="form-modal" onClose={() => setAdding(undefined)}><form onSubmit={event => { event.preventDefault(); setAddError(''); void commit([{ type: 'add-entry', playlistId: destination, songId: adding.id }],undefined,true).then(saved => { if (saved) setAdding(undefined); else setAddError('未能添加，选择已保留，请重试。'); }).catch(issue => setAddError(errorText(issue))); }}><label className="field"><span className="field-label">选择目标歌单</span><select className="select" aria-label="添加目标歌单" data-autofocus="true" value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="">选择歌单</option>{state.snapshot.playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!state.snapshot.playlists.length && <p className="muted">还没有自建歌单，请先新建一个歌单。</p>}{addError && <p className="feedback" role="alert">{addError}</p>}<div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setAdding(undefined)}>取消</button><button className="btn btn-primary" disabled={busy || !destination}>添加歌曲</button></div></form></Modal>}
  </section>;
}
