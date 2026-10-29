import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { HeartIcon, MusicNotesIcon, PlayIcon, DotsThreeIcon, ArrowUpIcon, ArrowDownIcon, TrashIcon, PlusIcon, CameraIcon, PencilSimpleIcon, ArrowsDownUpIcon, ListBulletsIcon, CaretDownIcon, CheckIcon, QueueIcon, UsersIcon, LinkIcon } from '@phosphor-icons/react';
import type { Song, SongLibraryState, SongPlaybackSelection, SongPlaylistEntry, SongVersion } from '../server/song-library-types';
import { Modal } from './Modal';
import { PlayAllButton } from './ListActions';
import { MobileBrowseTitle } from './MobileBrowseTitle';
import { errorText, availabilityText } from './api';
import { PagedList } from './Pagination';
import './song-library.css';
import { SongMaintenancePanel } from './SongMaintenancePanel';
import { SongOrganizationPanel } from './SongOrganizationPanel';
import { ControlPopover } from './ControlPopover';
import { SongCover } from './SongCover';
import type { ComponentProps } from 'react';
import { desktopFeature } from './DesktopRegion';
import { DesktopSongDialog as songDialogUrl, DesktopPlaylistCoverDialog as coverDialogUrl } from 'virtual:desktop-feature-urls';
import type { SongCommit, SongDialogContext } from './song-management';
import { desktopSongIndex } from './desktop-song-index';
import { PlaylistCover } from './PlaylistCover';
import './song-catalog.css';
import './playlist-cover.css';
const DesktopSongDialog = desktopFeature<ComponentProps<typeof import('./DesktopSongDialog').DesktopSongDialog>>(songDialogUrl, 'DesktopSongDialog', '歌曲管理');
const DesktopPlaylistCoverDialog = desktopFeature<ComponentProps<typeof import('./DesktopPlaylistCoverDialog').DesktopPlaylistCoverDialog>>(coverDialogUrl, 'DesktopPlaylistCoverDialog', '歌单封面');
export { SongCover } from './SongCover';
export type { SongCommit } from './song-management';

export const songFavoritesId = 'system:favorites';
const versionUrl=(version:SongVersion)=>version.facts.url||(version.ref.provider==='bilibili'?'https://www.bilibili.com/video/'+version.ref.id:'https://www.youtube.com/watch?v='+version.ref.id);
export type MobileVersionPlayback = { currentVersionId?: string; preparing: boolean; error: string; play: (selection: SongPlaybackSelection, song: Song) => Promise<unknown> };
export function SongEditor({ song, state, commit, onSearch, onPlay, onClose, onChange, versionPlayback }: { song: Song; state: SongLibraryState; commit: SongCommit; onSearch: (song: Song, onReturn?: () => void) => void; onPlay: (selection: SongPlaybackSelection, song: Song) => void; onClose: () => void; onChange: (state: SongLibraryState) => void; versionPlayback?:MobileVersionPlayback }) {
  const [title, setTitle] = useState(song.title), [artists, setArtists] = useState(song.artists?.join('\n') ?? ''), [revision, setRevision] = useState(state.revision);
  const [dirty,setDirty]=useState({title:false,artists:false});
  const [editingInfo,setEditingInfo]=useState(false);
  const [section,setSection]=useState<'versions'|'info'>('versions'),tabsId=useId();
  useEffect(()=>{if(!dirty.title)setTitle(song.title);if(!dirty.artists)setArtists(song.artists?.join('\n')??'');},[song.title,JSON.stringify(song.artists),dirty.title,dirty.artists]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [labels, setLabels] = useState<Record<string, string>>({});
  const [kinds,setKinds]=useState<Record<string,string>>({}),[performers,setPerformers]=useState<Record<string,string>>({});
  const [switching,setSwitching]=useState<string>(),[switchFeedback,setSwitchFeedback]=useState('');
  const [searching,setSearching]=useState(false);
  const switchVersion=async(version:SongVersion)=>{
    const selection:SongPlaybackSelection={kind:'song',songId:song.id,explicitVersionId:version.id};
    if(!versionPlayback){onPlay(selection,song);return;}
    setSwitching(version.id);setSwitchFeedback('正在切换版本…');
    try {const result=await versionPlayback.play(selection,song);setSwitchFeedback(result===false?'版本未能切换，请重试。当前播放保留。':'已切换到「'+(version.label||version.facts.title)+'」');}
    catch(issue){setSwitchFeedback(errorText(issue));}
    finally{setSwitching(undefined);}
  };
  const versions = state.snapshot.versions.filter(version => version.songId === song.id);
  const run = async (edits: unknown[]) => { setBusy(true); setError(''); try { const saved = await commit(edits, revision); if (saved) { setRevision(saved.revision); return true; } setError('未能保存，请检查提示并重读当前修订。草稿已保留。'); } catch (issue) { setError(errorText(issue)); } finally { setBusy(false); } return false; };
  return <Modal mobilePage suspended={searching} title="歌曲与版本" className="song-editor-modal" onClose={onClose}>
    <div className="song-editor-heading"><SongCover song={song}/><div><h3 title={song.title}>{song.title}</h3><p className="muted">{song.artists?.join(' / ')||'歌手未填写'}</p></div></div>
    <div className="song-editor-navigation"><div className="segmented song-editor-tabs" role="tablist" aria-label="歌曲与版本" onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?'versions':event.key==='End'?'info':section==='versions'?'info':'versions';
      setSection(next);event.currentTarget.querySelector<HTMLButtonElement>('[data-section="'+next+'"]')?.focus();
    }}>{([{id:'versions',label:'播放版本'},{id:'info',label:'歌曲资料'}] as const).map(item=><button key={item.id} id={tabsId+'-'+item.id} data-section={item.id} role="tab" aria-label={item.label} aria-selected={section===item.id} aria-controls={tabsId+'-'+item.id+'-panel'} tabIndex={section===item.id?0:-1} className={section===item.id?'selected':''} onClick={()=>setSection(item.id)}>{item.label}{item.id==='versions'&&<small>{versions.length}</small>}</button>)}</div>{section==='versions'&&<button className="btn btn-icon" aria-label="搜索并添加版本" title="搜索并添加版本" onClick={()=>{setSearching(true);onSearch(song,()=>setSearching(false));}}><PlusIcon size={22}/></button>}</div>
    <section role="tabpanel" id={tabsId+'-info-panel'} aria-labelledby={tabsId+'-info'} hidden={section!=='info'}>
    <dl className="mobile-song-info-summary"><dt>歌名</dt><dd>{song.title}</dd><dt>歌手</dt><dd>{song.artists?.join(' / ')||'歌手未填写'}</dd></dl>
    <button className="btn btn-ghost btn-sm" aria-expanded={editingInfo} onClick={()=>setEditingInfo(!editingInfo)}>编辑资料</button>
    {editingInfo&&<form className="song-info-form" onSubmit={event => { event.preventDefault(); const patch: Record<string, unknown> = { type: 'edit-song', songId: song.id }; if (dirty.title) patch.title = title.trim(); if(dirty.artists) patch.artists = artists.split('\n').map(value => value.trim()).filter(Boolean); if (Object.keys(patch).length > 2) void run([patch]).then(saved=>{if(saved){setDirty({title:false,artists:false});setEditingInfo(false);}}); }}>
      <label className="field"><span className="field-label">标准歌名</span><input className="input" aria-label="标准歌名" value={title} maxLength={1000} onChange={event => {setTitle(event.target.value);setDirty(old=>({...old,title:true}));}} required disabled={busy}/></label>
      <label className="field"><span className="field-label">歌手（每行一位）</span><textarea className="textarea" aria-label="歌曲歌手" value={artists} onChange={event => {setArtists(event.target.value);setDirty(old=>({...old,artists:true}));}} rows={3} disabled={busy}/></label>
      <button className="btn btn-primary" disabled={busy || !title.trim()}>保存歌曲资料</button>
    </form>}
    <SongOrganizationPanel song={song} revision={state.revision} disabled={busy || dirty.title || dirty.artists} onChange={saved => { setRevision(saved.revision); onChange(saved); }}/>
    </section>
    <section className="song-version-section" role="tabpanel" id={tabsId+'-versions-panel'} aria-labelledby={tabsId+'-versions'} hidden={section!=='versions'}>{!versions.length && <p className="muted">还没有版本。添加第一个版本后，将默认播放它。</p>}
      {switchFeedback&&<p className="feedback" role="status">{switchFeedback}{versionPlayback?.error&&<span> {versionPlayback.error}</span>}</p>}
      {versions.map(version => <div className={'song-version-item'+(versionPlayback?.currentVersionId===version.id?' current':'')} aria-current={versionPlayback?.currentVersionId===version.id?'true':undefined} key={version.id}><div className="song-version-copy"><strong>{version.label || version.facts.title}</strong><p className="muted">{version.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}{version.facts.uploader&&<span className="song-version-uploader"> · {version.facts.uploader}</span>}{versionPlayback?.currentVersionId===version.id&&<span className="song-current-badge">当前播放版本</span>}{version.id === song.defaultVersionId && <span className="song-default-badge">默认播放</span>}</p></div>
        <div className="song-version-actions"><button className="btn btn-secondary btn-sm" disabled={!!switching||versionPlayback?.preparing} aria-busy={switching===version.id||undefined} onClick={() => void switchVersion(version)}><PlayIcon size={16}/>{switching===version.id?'切换中…':'播放此版本'}</button><button className="btn btn-ghost btn-sm" disabled={busy || song.defaultVersionId === version.id} onClick={() => void run([{ type: 'set-default', songId: song.id, versionId: version.id }])}>设为默认版本</button></div>
        <details className="song-version-details"><summary>版本详情</summary>
        <label className="field"><span className="field-label">版本名称</span><input className="input" aria-label={'版本名称 ' + version.facts.title} value={labels[version.id] ?? version.label} disabled={busy} onChange={event => setLabels(old => ({ ...old, [version.id]: event.target.value }))}/></label>
        <label className="field"><span className="field-label">版本类别</span><select className="select" aria-label={'版本类别 '+version.facts.title} value={kinds[version.id]??version.kind} onChange={event=>setKinds(old=>({...old,[version.id]:event.target.value}))}><option value="studio">录音室</option><option value="mv">MV</option><option value="live">现场</option><option value="cover">翻唱</option><option value="remix">混音</option><option value="other">其他</option></select></label>
        <label className="field"><span className="field-label">此版本演唱者（每行一位）</span><textarea className="textarea" aria-label={'版本演唱者 '+version.facts.title} rows={2} value={performers[version.id]??version.performers?.join('\n')??''} onChange={event=>setPerformers(old=>({...old,[version.id]:event.target.value}))}/></label>
        <div className="toolbar"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run([{ type: 'edit-version', versionId: version.id, label: labels[version.id] ?? version.label,kind:kinds[version.id]??version.kind,...(performers[version.id]!==undefined?{performers:performers[version.id].split('\n').map(value=>value.trim()).filter(Boolean)}:{}) }])}>保存版本资料</button><a className="btn btn-ghost btn-sm" href={versionUrl(version)} target="_blank" rel="noreferrer">查看来源</a></div></details>
      </div>)}{song.defaultVersionId&&<details className="song-version-details"><summary>更多设置</summary><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void run([{type:'set-default',songId:song.id,versionId:null}])}>取消默认版本</button></details>}
      {versionPlayback&&<p className="muted song-version-note">切换本次播放与设为默认分别保存；浏览版本不改变播放。</p>}
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
  versionPlayback?:MobileVersionPlayback;
  onManage?: () => void;
  onEnqueue?: (selection: SongPlaybackSelection, song: Song) => Promise<unknown>;
  onCreator?: (song: Song, version: SongVersion) => void;
  hidden?: boolean;
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

export function SongLibraryPage({ state, selected, onSelect, commit, onBackup, onSearch, onPlay, onPlayAll, busy, onChange, loadError, onRetry, youtubeEnabled = true, disabledDisplay = 'dim', source = 'all', sourceControls, desktop = false, onManage, versionPlayback, onEnqueue, onCreator, hidden = false }: Props) {
  const [filter, setFilter] = useState(''), [editing, setEditing] = useState<string>(), [name, setName] = useState(''), [creating, setCreating] = useState<'new' | 'rename'>(), [destination, setDestination] = useState(''), [remove, setRemove] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [desktopContext, setDesktopContext] = useState<SongDialogContext>(), [managing, setManaging] = useState(false), [adding, setAdding] = useState<Song>();
  const [addError, setAddError] = useState('');
  const [playlistFormError, setPlaylistFormError] = useState('');
  const [coverTarget, setCoverTarget] = useState<string>();
  const [mobileSheet,setMobileSheet]=useState<'playlists'|'manage'|'sort'>();
  const [mobileAction,setMobileAction]=useState<string>(),[queueBusy,setQueueBusy]=useState(false),[queueError,setQueueError]=useState('');
  useEffect(() => { setCoverTarget(undefined); }, [selected, desktop]);
  useEffect(() => { setPlaylistFormError(''); }, [creating, remove]);
  const changePlaylist = (edits: unknown[], complete: () => void) => {
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
  const mobileCommit=async(edits:unknown[])=>{setQueueError('');try{const saved=await commit(edits,undefined,true);if(!saved)setQueueError('未能保存更改，当前内容已保留，请重试。');return saved;}catch(issue){setQueueError(errorText(issue));}};
  const move = (id: string, delta: number) => { const ids = members.map(member => member.id), index = ids.indexOf(id), at = index + delta; if (at < 0 || at >= ids.length) return; ids.splice(index, 1); ids.splice(at, 0, id); const edits=[favorites ? { type: 'reorder-favorites', favoriteIds: ids } : { type: 'reorder-entries', playlistId: selected, entryIds: ids }];void (desktop?commit(edits):mobileCommit(edits)); };
  const edited = index.songs.get(editing ?? '');
  const actionRow=rows.find(row=>row.id===mobileAction),actionVersion=actionRow&&(chosenFor(actionRow)??index.versionsBySong.get(actionRow.songId)?.[0]);
  const openEditor = (row: typeof rows[number]) => desktop ? setDesktopContext({ songId: row.songId, ...(row.entry ? { playlistId: selected, entryId: row.id } : {}), versionId: chosenFor(row)?.id }) : setEditing(row.songId);
  const PlaylistHeading = 'h1';
  const playlistName = favorites ? '我的收藏' : playlist?.name;
  const playAllButton=<PlayAllButton count={visible.length} disabled={!visible.some(row=>!blocked(row))} onClick={()=>onPlayAll(visible.map(({selection,song})=>({selection,song})))}/>;
  return <section className="catalog list-view song-library-page" hidden={hidden}>
    {loadError && <div className="feedback" role="status"><p>歌单更新暂时失败，当前内容保留。{loadError}</p><button className="btn btn-secondary" onClick={onRetry}>重试读取歌单</button></div>}
    {desktop&&<div className="segmented playlist-switcher" aria-label="选择歌单"><button className={favorites ? 'selected' : ''} onClick={() => onSelect(songFavoritesId)}>我的收藏<small>{state.snapshot.favorites.length} 首</small></button>{state.snapshot.playlists.map(playlist => <button key={playlist.id} className={selected === playlist.id ? 'selected' : ''} onClick={() => onSelect(playlist.id)}>{playlist.name}<small>{playlist.entries.length} 首</small></button>)}</div>}
    <div className="playlist-intro">{desktop ? <button className="playlist-cover-button" aria-label="更换封面" title="更换封面" disabled={busy || !favorites && !playlist} onClick={() => setCoverTarget(selected)}><PlaylistCover image={coverImage} song={autoCoverSong} className="playlist-art"/><span className="playlist-cover-overlay"><CameraIcon size={28}/><span>更换封面</span></span></button> : <SongCover song={rows[0]?.song} className="playlist-art"/>}<div className="playlist-copy">{desktop?<PlaylistHeading title={playlistName}>{playlistName}</PlaylistHeading>:<div className="mobile-playlist-heading"><h1 aria-label={playlistName}><button aria-label="选择歌单" onClick={()=>setMobileSheet('playlists')}><span>{playlistName}</span><CaretDownIcon size={18}/></button></h1><button className="btn btn-icon" aria-label="歌单管理" onClick={()=>setMobileSheet('manage')}><DotsThreeIcon size={25}/></button></div>}<p>{members.length} 首歌曲</p><div className="toolbar">{desktop&&playAllButton}{desktop && <ControlPopover key={selected} className="playlist-manage-menu" buttonClassName="btn-secondary" label="歌单管理" icon={<><DotsThreeIcon size={20}/><span>管理</span></>} side="bottom">
      {playlist && <><button disabled={busy} onClick={() => { setName(playlist.name); setCreating('rename'); }}><PencilSimpleIcon size={18}/>歌单改名</button><hr/></>}
      <button onClick={() => { setName(''); setCreating('new'); }}><PlusIcon size={18}/>新建歌单</button>
      <button onClick={() => onManage ? onManage() : setManaging(true)}><ListBulletsIcon size={18}/>歌曲管理</button>
      <button onClick={onBackup}><ArrowsDownUpIcon size={18}/>导入 / 导出</button>
      {playlist && <><hr/><button className="danger-text" disabled={busy} onClick={() => setRemove(true)}><TrashIcon size={18}/>删除歌单</button></>}
    </ControlPopover>}</div></div></div>
    {!desktop&&<div className="toolbar mobile-playlist-tools">{playAllButton}<button className="btn btn-secondary" onClick={()=>onSearch()}><PlusIcon size={20}/>添加歌曲</button><button className="btn btn-icon" aria-label="排序" title="排序" onClick={()=>{setQueueError('');setMobileSheet('sort');}}><ArrowsDownUpIcon size={20}/></button></div>}
    <div className="playlist-list-toolbar"><label className="search-field search-field-inline"><input aria-label="搜索歌单内音乐" placeholder="搜索歌单内音乐" value={filter} onChange={event => setFilter(event.target.value)}/></label>{sourceControls}{desktop&&<span className="muted">{visible.length === members.length ? `${visible.length} 首歌曲` : `${visible.length} / ${members.length} 首歌曲`}</span>}</div>
    <PagedList id={'songs:' + selected + ':' + filter} group="library" label="歌单歌曲" items={visible}>{items => items.length ? <div className="track-list">{items.map(row => {
      const versions = index.versionsBySong.get(row.songId) ?? [], chosen = chosenFor(row), favorite = index.favorites.get(row.songId);
      return <div className={'song-library-row' + (blocked(row) && disabledDisplay === 'dim' ? ' source-disabled' : '')} key={row.id}>
        <span className="row-number">{row.position + 1}</span>
        <button className="row-cover" aria-label={'播放 ' + row.song.title} disabled={blocked(row)} onClick={() => onPlay(row.selection, row.song)}><SongCover song={row.song}/></button>
        <div className="row-info">
          {desktop ? <button className="track-name" title={row.song.title} disabled={blocked(row)} onClick={() => onPlay(row.selection, row.song)}>{row.song.title}</button> : <MobileBrowseTitle className="track-name" title={row.song.title} disabled={blocked(row)} onPlay={() => onPlay(row.selection, row.song)}/>}
          <p className="row-sub">{row.song.artists?.join(' / ') || '歌手待整理'}</p>
          {!desktop && versions.length > 1 && <button className="song-version-link" aria-label={'选择播放版本 ' + row.song.title} title={chosen?.label || chosen?.facts.title} onClick={() => openEditor(row)}>{versions.length} 个版本</button>}
          {row.entry?.pinnedVersionId && chosen && <span className="row-status">固定 · {chosen.label || chosen.facts.title}</span>}
          {!chosen && <span className="row-status">播放时自动匹配</span>}
        {chosen && ['unavailable','uncertain'].includes(chosen.availability.state) && 'code' in chosen.availability && <span className="row-warning">{availabilityText(chosen.availability.code)}</span>}
        </div>
        {desktop && versions.length > 1 && <button className="song-version-link" aria-label={'选择播放版本 ' + row.song.title} title={chosen?.label || chosen?.facts.title} onClick={() => openEditor(row)}>{versions.length} 个版本</button>}
        <button className={'btn btn-icon ' + (favorite ? 'saved' : '')} aria-label={(favorite ? '取消收藏 ' : '收藏 ') + row.song.title} disabled={busy} onClick={() => void commit([favorite ? { type: 'remove-favorite', favoriteId: favorite.favoriteId } : { type: 'favorite', songId: row.songId }])}><HeartIcon size={20} weight={favorite ? 'fill' : 'regular'}/></button>
        {desktop ? <ControlPopover className="song-row-menu" label={'更多操作 ' + row.song.title} icon={<DotsThreeIcon size={24}/>} side="bottom">
          <button aria-label={'编辑歌曲 ' + row.song.title} onClick={() => openEditor(row)}>歌曲与版本</button>
          <button onClick={() => { setDestination(''); setAddError(''); setAdding(row.song); }}><PlusIcon size={18}/>加入歌单</button>
          <button aria-label={'上移 ' + row.song.title} disabled={busy || row.position === 0} onClick={() => move(row.id, -1)}><ArrowUpIcon size={18}/>上移</button>
          <button aria-label={'下移 ' + row.song.title} disabled={busy || row.position === members.length - 1} onClick={() => move(row.id, 1)}><ArrowDownIcon size={18}/>下移</button>
          {row.entry && <button className="danger-text" aria-label={'从歌单移除 ' + row.song.title} disabled={busy} onClick={() => void commit([{ type: 'remove-entry', playlistId: selected, entryId: row.id }])}><TrashIcon size={18}/>从歌单移除</button>}
        </ControlPopover> : <button className="btn btn-icon" aria-label={'更多操作 ' + row.song.title} aria-expanded={mobileAction===row.id} onClick={()=>{setQueueError('');setMobileAction(row.id);}}><DotsThreeIcon size={24}/></button>}
      </div>;
    })}</div> : <div className="empty"><MusicNotesIcon size={36}/><h3>这里还没有匹配的歌曲</h3><button className="btn btn-secondary" onClick={() => onSearch()}>去搜索音乐</button></div>}</PagedList>
    {!desktop&&actionRow&&<Modal title="歌曲操作" className="mobile-actions-sheet mobile-song-actions" onClose={()=>setMobileAction(undefined)}><div className="song-editor-heading"><SongCover song={actionRow.song}/><div><h3>{actionRow.song.title}</h3><p className="muted">{actionRow.song.artists?.join(' / ')||'歌手未填写'}</p></div></div><div className="mobile-action-list">
      {onEnqueue&&<button disabled={queueBusy||blocked(actionRow)} onClick={async()=>{setQueueBusy(true);setQueueError('');try{if(await onEnqueue(actionRow.selection,actionRow.song)!==false)setMobileAction(undefined);else setQueueError('未能加入队列，请重试。');}catch(issue){setQueueError(errorText(issue));}finally{setQueueBusy(false);}}}><QueueIcon size={22}/><span>{queueBusy?'正在加入…':'加入队列'}</span></button>}
      <button onClick={()=>{setMobileAction(undefined);setDestination('');setAddError('');setAdding(actionRow.song);}}><PlusIcon size={22}/><span>加入歌单</span></button>
      <button aria-label={'编辑歌曲 '+actionRow.song.title} onClick={()=>{setMobileAction(undefined);setEditing(actionRow.songId);}}><MusicNotesIcon size={22}/><span>歌曲与版本</span></button>
      {actionVersion&&onCreator&&<button onClick={()=>{setMobileAction(undefined);onCreator(actionRow.song,actionVersion);}}><UsersIcon size={22}/><span>查看 UP / 博主</span></button>}
      {actionVersion&&<a href={versionUrl(actionVersion)} target="_blank" rel="noreferrer"><LinkIcon size={22}/><span>查看来源</span></a>}
      {actionRow.entry&&<button className="danger-text" disabled={busy} onClick={()=>void mobileCommit([{type:'remove-entry',playlistId:selected,entryId:actionRow.id}]).then(saved=>{if(saved)setMobileAction(undefined);})}><TrashIcon size={22}/><span>从歌单移除</span></button>}
    </div>{actionRow.entry&&<label className="field"><span className="field-label">歌单播放版本</span><select className="select" aria-label={'固定版本 '+actionRow.song.title} value={actionRow.entry.pinnedVersionId??''} disabled={busy} onChange={event=>void mobileCommit([{type:'pin-entry',playlistId:selected,entryId:actionRow.id,versionId:event.target.value||null}])}><option value="">跟随歌曲默认</option>{(index.versionsBySong.get(actionRow.songId)??[]).map(version=><option key={version.id} value={version.id}>{version.label||version.facts.title}</option>)}</select></label>}{queueError&&<p className="feedback" role="alert">{queueError}</p>}</Modal>}
    {!desktop&&mobileSheet&&<Modal mobilePage={mobileSheet==='sort'} title={mobileSheet==='playlists'?'选择歌单':mobileSheet==='sort'?'调整歌曲顺序':'歌单管理'} className="mobile-actions-sheet" onClose={()=>setMobileSheet(undefined)}><div className={mobileSheet==='sort'?'mobile-sort-list':'mobile-action-list'}>
      {mobileSheet==='sort'?<><p className="muted">调整后立即保存，当前播放与队列保留。</p>{rows.map(row=><div className="mobile-sort-row" key={row.id}><span>{row.position+1}. {row.song.title}</span><button className="btn btn-icon" aria-label={'上移 '+row.song.title} disabled={busy||row.position===0} onClick={()=>move(row.id,-1)}><ArrowUpIcon size={21}/></button><button className="btn btn-icon" aria-label={'下移 '+row.song.title} disabled={busy||row.position===members.length-1} onClick={()=>move(row.id,1)}><ArrowDownIcon size={21}/></button></div>)}</>:mobileSheet==='playlists'?<>
        {[{id:songFavoritesId,name:'我的收藏',count:state.snapshot.favorites.length},...state.snapshot.playlists.map(item=>({id:item.id,name:item.name,count:item.entries.length}))].map(item=><button key={item.id} aria-pressed={selected===item.id} onClick={()=>{onSelect(item.id);setMobileSheet(undefined);setFilter('');}}><MusicNotesIcon size={23}/><span>{item.name}<small>{item.count} 首</small></span>{selected===item.id&&<CheckIcon size={22}/>}</button>)}
      </>:<>
        {playlist&&<button disabled={busy} onClick={()=>{setMobileSheet(undefined);setName(playlist.name);setCreating('rename');}}><PencilSimpleIcon size={22}/><span>歌单改名</span></button>}
        <button onClick={()=>{setMobileSheet(undefined);setName('');setCreating('new');}}><PlusIcon size={22}/><span>新建歌单</span></button>
        <button onClick={()=>{setMobileSheet(undefined);setMaintenance(true);}}><ListBulletsIcon size={22}/><span>资料库维护</span></button>
        <button onClick={()=>{setMobileSheet(undefined);onBackup();}}><ArrowsDownUpIcon size={22}/><span>导入 / 导出</span></button>
        {playlist&&<button className="danger-text" disabled={busy} onClick={()=>{setMobileSheet(undefined);setRemove(true);}}><TrashIcon size={22}/><span>删除歌单</span></button>}
      </>}
    </div>{mobileSheet==='sort'&&queueError&&<p className="feedback" role="alert">{queueError}</p>}</Modal>}
    {creating && <Modal title={creating === 'rename' ? '歌单改名' : '新建歌单'} onClose={() => setCreating(undefined)}><form onSubmit={event => { event.preventDefault(); changePlaylist([creating === 'rename' && playlist ? { type: 'rename-playlist', playlistId: playlist.id, name: name.trim() } : { type: 'create-playlist', name: name.trim() }], () => setCreating(undefined)); }}><label className="field"><span className="field-label">歌单名称</span><input className="input" aria-label="歌单名称" value={name} maxLength={200} required onChange={event => setName(event.target.value)}/></label>{playlistFormError && <p className="feedback" role="alert">{playlistFormError}</p>}<button className="btn btn-primary" disabled={busy || !name.trim()}>保存歌单</button></form></Modal>}
    {desktop && coverTarget === selected && (favorites || playlist) && <DesktopPlaylistCoverDialog key={selected} library={state} targetId={selected} songs={rows.map(row => row.song)} image={coverImage} busy={busy} commit={commit} onClose={() => setCoverTarget(undefined)}/>}
    {remove && playlist && <Modal title="删除歌单" onClose={() => setRemove(false)}><p>删除「{playlist.name}」及 {playlist.entries.length} 个成员，歌曲资料和当前队列保留。</p>{playlistFormError && <p className="feedback" role="alert">{playlistFormError}</p>}<button className="btn btn-danger" disabled={busy} onClick={() => changePlaylist([{ type: 'delete-playlist', playlistId: playlist.id }], () => setRemove(false))}>确认删除</button></Modal>}
    {edited && <SongEditor key={edited.id} song={edited} state={state} commit={commit} onPlay={onPlay} onSearch={onSearch} onClose={() => setEditing(undefined)} onChange={onChange} versionPlayback={versionPlayback}/>}
    {maintenance && <SongMaintenancePanel library={state} onChange={onChange} onClose={() => setMaintenance(false)}/>}
    {(desktopContext || managing) && <DesktopSongDialog library={state} context={desktopContext} commit={(edits,revision)=>commit(edits,revision,true)} youtubeEnabled={youtubeEnabled} onChange={onChange} onPlay={onPlay} onSearch={onSearch} onClose={() => { setDesktopContext(undefined); setManaging(false); }}/>}
    {adding && <Modal title={'加入歌单 · ' + adding.title} className="form-modal" onClose={() => setAdding(undefined)}><form onSubmit={event => { event.preventDefault(); setAddError(''); void commit([{ type: 'add-entry', playlistId: destination, songId: adding.id }],undefined,true).then(saved => { if (saved) setAdding(undefined); else setAddError('未能添加，选择已保留，请重试。'); }).catch(issue => setAddError(errorText(issue))); }}><label className="field"><span className="field-label">选择目标歌单</span><select className="select" aria-label="添加目标歌单" data-autofocus="true" value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="">选择歌单</option>{state.snapshot.playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!state.snapshot.playlists.length && <p className="muted">还没有自建歌单，请先新建一个歌单。</p>}{addError && <p className="feedback" role="alert">{addError}</p>}<div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setAdding(undefined)}>取消</button><button className="btn btn-primary" disabled={busy || !destination}>添加歌曲</button></div></form></Modal>}
  </section>;
}
