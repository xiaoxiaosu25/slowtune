import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ArrowLeftIcon, MagnifyingGlassIcon, MusicNotesIcon, PlayIcon, PlusIcon, TrashIcon, ArrowSquareOutIcon, ArrowsMergeIcon, ArrowRightIcon, HeartIcon } from '@phosphor-icons/react';
import type { Song, SongLibraryState, SongPlaybackSelection, SongVersion } from '../server/song-library-types';
import { Modal } from './Modal';
import { SongCover } from './SongCover';
import { SongCatalogPanel, catalogStatus } from './SongCatalogPanel';
import './song-catalog.css';
import { desktopCatalogLibrary } from '../server/song-catalog-display';
import { SongOrganizationPanel } from './SongOrganizationPanel';
import { PagedList } from './Pagination';
import { errorText, availabilityText } from './api';
import { SongMaintenanceTask, useSongMaintenance, type SongTask } from './SongMaintenanceTask';
import { desktopSongIndex } from './desktop-song-index';
import { changedSongFields, entryFor, isMissingVersion, rebaseSongDraft, songDraft, songDraftEdits, splitArtists, versionKinds, versionName, type SongCommit, type SongDialogContext, type SongDraft } from './song-management';
import { VersionStatus } from './VersionStatus';

type Props = {
  library: SongLibraryState; context?: SongDialogContext; commit: SongCommit; youtubeEnabled: boolean;
  onChange: (state: SongLibraryState) => void; onClose: () => void;
  onSearch: (song: Song, onReturn: () => void) => void;
  onPlay: (selection: SongPlaybackSelection, song: Song) => void;
};

/** One dialog hosts the manager, editor and impact preview. Search temporarily suspends it. */
export function DesktopSongDialog(props: Props) {
  props = { ...props, library: desktopCatalogLibrary(props.library) };
  const [context, setContext] = useState(props.context), [searching, setSearching] = useState(false);
  const [task, setTask] = useState<SongTask>(), [message, setMessage] = useState('');
  const close = useRef(props.onClose);
  const managerAnchor = useRef<HTMLElement | null>(null);
  useEffect(() => { if (!context) managerAnchor.current?.focus({ preventScroll: true }); }, [context?.songId]);
  const song = desktopSongIndex(props.library.snapshot).songs.get(context?.songId ?? '');
  const managerLibrary = useRef(props.library);
  if (!song && !task && !searching) managerLibrary.current = props.library;
  const edit = useCallback((next: SongDialogContext) => { managerAnchor.current = document.activeElement as HTMLElement; setContext(next); }, []);
  if (!context || !song) close.current = props.onClose;
  const search = (song: Song) => {
    setSearching(true); props.onSearch(song, () => setSearching(false));
  };
  return <Modal title={context && song ? '歌曲与版本' : '歌曲管理'} className="desktop-song-workspace" suspended={searching} onClose={() => close.current()}>
    <span className="desktop-playback-slot" data-desktop-playback-slot=""/>
    {!props.context && <div className="song-manager-host" hidden={!!song || !!task}><SongManager library={managerLibrary.current} onChange={props.onChange} onEdit={edit} onTask={setTask} message={message}/></div>}
    {context && song ? <DesktopSongEditor key={context.songId + ':' + (context.entryId ?? '')} {...props} song={song} context={context} active={!searching} onSearch={search} closeHandler={close}
      onBack={props.context ? undefined : () => setContext(undefined)} onClose={props.onClose}/> : task ? <div className="song-workspace-body"><SongMaintenanceTask task={task} library={props.library} onChange={props.onChange} onBack={() => setTask(undefined)} onComplete={() => { setTask(undefined); setMessage('已清理所选失效版本。'); }}/></div> :
      props.context ? <div className="song-workspace-body"><p role="status">这首歌曲已被移除或合并。</p><button className="btn btn-secondary" onClick={props.onClose}>关闭</button></div> : null}
  </Modal>;
}

function DesktopSongEditor({ song, context, library, commit, onChange, onPlay, onSearch, onClose, onBack, youtubeEnabled, closeHandler, active }: Omit<Props, 'context' | 'onSearch'> & {
  song: Song; context: SongDialogContext; onSearch: (song: Song) => void; onBack?: () => void; closeHandler: MutableRefObject<() => void>; active: boolean;
}) {
  const index = desktopSongIndex(library.snapshot);
  const versions = index.versionsBySong.get(song.id) ?? [], entry = entryFor(library, context);
  const current = songDraft(song, versions, entry);
  const [base, setBase] = useState(current), [draft, setDraft] = useState(current), [revision, setRevision] = useState(library.revision);
  const [artistsText, setArtistsText] = useState(current.artists.join('\n')), [performerTexts, setPerformerTexts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(context.versionId ?? entry?.pinnedVersionId ?? song.defaultVersionId ?? versions[0]?.id);
  const [tab, setTab] = useState<'versions' | 'info'>('versions'), [task, setTask] = useState<SongTask>(), [organization, setOrganization] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [playlistTarget, setPlaylistTarget] = useState('');
  const [pending, setPending] = useState<{ action: (saved: SongLibraryState) => void; closing: boolean }>();
  const tabId = useId(), operation = useSongMaintenance(onChange), mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null), guardHeading = useRef<HTMLHeadingElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (pending) guardHeading.current?.focus(); }, [pending]);
  useEffect(() => {
    if (!active || tab !== 'versions') return;
    const frame = requestAnimationFrame(() => selectedButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [active, selected, tab]);
  const edits = songDraftEdits(base, draft, context), dirty = edits.length > 0, stale = dirty && revision !== library.revision;
  const busy = saving || operation.busy;
  const reset = (next: SongDraft, nextRevision: string | null) => {
    setBase(next); setDraft(next); setRevision(nextRevision); setArtistsText(next.artists.join('\n')); setPerformerTexts({}); setError('');
  };
  useEffect(() => {
    if (!dirty) {
      const added = versions.find(v => !base.versions[v.id]);
      reset(current, library.revision); if (added) setSelected(added.id);
    }
  }, [library.revision]);
  useEffect(() => {
    if (!versions.some(v => v.id === selected)) setSelected(versions[0]?.id);
  }, [versions.map(v => v.id).join('|'), selected]);
  const requestAction = (action: (saved: SongLibraryState) => void, closing = false) => {
    if (busy) return;
    if (dirty) setPending({ action, closing }); else action(library);
  };
  useEffect(() => {
    closeHandler.current = () => {
      if (pending) { setPending(undefined); return; }
      requestAction(onClose, true);
    };
  });
  const save = async (): Promise<SongLibraryState | undefined> => {
    if (!draft.title.trim() || busy || stale) return;
    if (!dirty) return library;
    setSaving(true); setError(''); setMessage('');
    try {
      const saved = await commit(edits, revision);
      if (!mounted.current) return;
      if (saved) {
        const savedSong = desktopCatalogLibrary(saved).snapshot.songs.find(s => s.id === song.id);
        if (!savedSong) { onClose(); return; }
        reset(songDraft(savedSong, saved.snapshot.versions.filter(v => v.songId === song.id), entryFor(saved, context)), saved.revision);
        setMessage('更改已保存。'); return saved;
      }
      setError('未能保存，草稿已保留。请检查最新资料和提示后重试。');
    } catch (issue) { if (mounted.current) setError(errorText(issue)); }
    finally { if (mounted.current) setSaving(false); }
  };
  const startTask = (next: SongTask) => requestAction(() => { setTask(next); setMessage(''); });
  const saveMembership = (commands: unknown[], success: string) => requestAction(saved => {
    setSaving(true); setError('');
    void commit(commands, saved.revision).then(result => { if (mounted.current) { if (result) setMessage(success); else setError('未能保存，选择已保留，请核对最新资料后重试。'); } }).catch(issue => { if (mounted.current) setError(errorText(issue)); }).finally(() => { if (mounted.current) setSaving(false); });
  });
  const version = versions.find(v => v.id === selected), versionDraft = version && (draft.versions[version.id] ?? current.versions[version.id]);
  const patchVersion = (patch: Partial<NonNullable<typeof versionDraft>>) => {
    if (version) {
      // A concurrent addition may be visible while older edits keep the base frozen.
      // Capture its saved fields before accepting the first local edit.
      setBase(old => old.versions[version.id] ? old : { ...old, versions: { ...old.versions, [version.id]: current.versions[version.id] } });
      setDraft(old => ({ ...old, versions: { ...old.versions, [version.id]: { ...(old.versions[version.id] ?? current.versions[version.id]), ...patch } } }));
    }
    setMessage('');
  };
  const versionOptions = versions.map(v => <option key={v.id} value={v.id}>{draft.versions[v.id]?.label || versionName(v)} · {v.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}</option>);
  const goBack = () => requestAction(onBack ?? onClose, true);
  const conflicts = stale ? changedSongFields(base, draft, current) : [];
  const favorite = index.favorites.has(song.id), memberLists = index.playlistsBySong.get(song.id) ?? [];
  if (pending) return <div className="song-workspace-body song-draft-guard"><h3 ref={guardHeading} tabIndex={-1}>有尚未保存的更改</h3><p className="muted">{pending.closing ? '保存后离开，或放弃这次修改。' : '继续前先处理当前草稿，避免丢失修改。'}</p>{stale && <p className="feedback" role="alert">资料已变化，请返回编辑，核对最新资料后再保存。</p>}{error && <p className="feedback" role="alert">{error}</p>}<div className="song-guard-actions"><button className="btn btn-primary" disabled={saving || stale || !draft.title.trim()} onClick={async () => { const saved = await save(); if (saved) { const action = pending.action; setPending(undefined); action(saved); } }}>{saving ? '保存中…' : pending.closing ? '保存并关闭' : '保存并继续'}</button><button className="btn btn-secondary" disabled={saving} onClick={() => { reset(current, library.revision); const action = pending.action; setPending(undefined); action(library); }}>{pending.closing ? '放弃更改并离开' : '放弃并继续'}</button><button className="btn btn-ghost" disabled={saving} data-autofocus="true" onClick={() => setPending(undefined)}>继续编辑</button></div></div>;
  if (task) return <div className="song-workspace-body"><SongMaintenanceTask task={task} library={library} onChange={onChange} onBack={() => setTask(undefined)} onComplete={saved => {
    setTask(undefined); setMessage('操作已完成。');
    if (!saved.snapshot.songs.some(s => s.id === song.id)) (onBack ?? onClose)();
  }}/></div>;
  return <div className="desktop-song-editor">
    <div className="song-workspace-heading">{onBack && <button className="btn btn-ghost btn-sm" onClick={goBack}><ArrowLeftIcon size={18}/>全部歌曲</button>}<div className="song-editor-heading"><SongCover song={song}/><div><h3 ref={heading} tabIndex={-1}>{song.title}</h3><p className="muted">{song.artists?.join(' / ') || '歌手未填写'} · {versions.length} 个版本</p></div></div>
      <div className="song-workspace-tabs" role="tablist" aria-label="歌曲维护">{([['versions', '播放版本'], ['info', '歌曲资料']] as const).map(([value, label], i) => <button id={tabId + '-' + value} role="tab" aria-selected={tab === value} aria-controls={tabId + '-panel'} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => { setTab(value); setOrganization(false); }} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'versions' : e.key === 'End' ? 'info' : i === 0 ? 'info' : 'versions'; setTab(next); setOrganization(false); document.getElementById(tabId + '-' + next)?.focus(); } }}>{label}</button>)}</div>
    </div>
    <div className="song-workspace-body" id={tabId + '-panel'} role="tabpanel" aria-labelledby={tabId + '-' + tab}>
      {tab === 'versions' ? <>
        <div className="section-heading"><p className="muted">选择版本查看详情，试听不会修改默认版本。</p><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => requestAction(saved => { const fresh = saved.snapshot.songs.find(s => s.id === song.id); if (fresh) onSearch(fresh); })}><PlusIcon size={17}/>搜索并添加版本</button></div>
        <section className="song-playback-preferences" aria-label="播放选择"><label className="field"><span className="field-label">歌曲默认版本</span><select className="select" aria-label="歌曲默认版本" value={draft.defaultVersionId ?? ''} disabled={busy || !versions.length} onChange={e => { setDraft(old => ({ ...old, defaultVersionId: e.target.value || null })); setMessage(''); }}><option value="">不指定，播放时自动匹配</option>{versionOptions}</select><small className="muted">保存后影响后续播放，当前音轨继续播放。</small></label>
          {entry && <label className="field"><span className="field-label">本条歌单记录播放版本 · {library.snapshot.playlists.find(p => p.id === context.playlistId)?.name}</span><select className="select" aria-label="本条歌单记录播放版本" value={draft.pinnedVersionId ?? ''} disabled={busy || !versions.length} onChange={e => { setDraft(old => ({ ...old, pinnedVersionId: e.target.value || null })); setMessage(''); }}><option value="">跟随歌曲默认版本</option>{versionOptions}</select><small className="muted">仅影响这条记录。同一首歌在歌单中重复出现时，可分别固定不同版本。</small></label>}
          {context.entryId && !entry && <p role="status" className="muted">这条歌单记录已移除，歌曲资料仍可编辑。</p>}
        </section>
        {versions.length ? <div className="song-version-layout"><div className="song-version-picker" role="group" aria-label="已保存的播放版本">{versions.map(v => <button className={'song-version-option' + (v.id === selected ? ' selected' : '')} aria-pressed={selected === v.id} ref={selected === v.id ? selectedButton : undefined} key={v.id} onClick={() => setSelected(v.id)}><strong>{draft.versions[v.id]?.label || versionName(v)}</strong><small>{v.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {versionKinds[draft.versions[v.id]?.kind ?? v.kind]}{v.facts.uploader ? ' · ' + v.facts.uploader : ''}</small><span className="song-version-tags">{draft.defaultVersionId === v.id && <span className="song-default-badge">歌曲默认</span>}{draft.pinnedVersionId === v.id && <span className="song-default-badge">本条歌单固定</span>}<VersionStatus version={v}/></span></button>)}</div>
          {version && versionDraft && <section className="song-version-inspector" aria-label="版本详情"><div className="section-heading"><h4>版本详情</h4><button className="btn btn-secondary btn-sm" disabled={!youtubeEnabled && version.ref.provider === 'youtube'} onClick={() => onPlay({ kind: 'song', songId: song.id, explicitVersionId: version.id }, song)}><PlayIcon size={16}/>播放此版本</button></div>
            <div className="song-version-original"><SongCover song={{ ...song, artwork: version.facts.artwork }}/><div><strong>{version.facts.title}</strong><p className="muted">{version.facts.artists?.join(' / ') || version.performers?.join(' / ') || version.facts.uploader || '演唱者未提供'}</p><small className="muted">来源封面与原标题</small></div></div>
            {!youtubeEnabled && version.ref.provider === 'youtube' && <p className="muted">YouTube 已关闭，启用来源后可试听。</p>}
            <label className="field"><span className="field-label">版本名称</span><input className="input" aria-label="版本名称" value={versionDraft.label} placeholder={version.facts.title} maxLength={1000} disabled={busy} onChange={e => patchVersion({ label: e.target.value })}/></label>
            <div className="song-version-fields"><label className="field"><span className="field-label">版本类别</span><select className="select" aria-label="版本类别" value={versionDraft.kind} disabled={busy} onChange={e => patchVersion({ kind: e.target.value as SongVersion['kind'] })}>{Object.entries(versionKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="field"><span className="field-label">演唱者（每行一位）</span><textarea className="textarea" aria-label="版本演唱者" rows={2} value={performerTexts[version.id] ?? versionDraft.performers?.join('\n') ?? ''} disabled={busy} onChange={e => { setPerformerTexts(old => ({ ...old, [version.id]: e.target.value })); patchVersion({ performers: splitArtists(e.target.value) }); }}/></label></div>
            <details className="song-source-details" key={version.id}><summary>来源信息与检查状态 <VersionStatus version={version}/></summary><dl className="song-source-facts"><dt>来源标题</dt><dd>{version.facts.title}</dd><dt>上传者</dt><dd>{version.facts.uploader || '未提供'}</dd><dt>来源 / 时长</dt><dd>{version.ref.provider === 'bilibili' ? 'B站' : 'YouTube'} · {version.facts.durationSeconds === undefined ? '时长未知' : Math.floor(version.facts.durationSeconds / 60) + ':' + String(Math.floor(version.facts.durationSeconds % 60)).padStart(2, '0')}</dd><dt>来源标识</dt><dd>{version.ref.id}{version.ref.part ? ' / ' + version.ref.part : ''}</dd><dt>可用状态</dt><dd><VersionStatus version={version}/>{'checkedAt' in version.availability && <small>检查于 {new Date(version.availability.checkedAt).toLocaleString('zh-CN')}</small>}{'code' in version.availability && <small>{availabilityText(version.availability.code)}</small>}</dd></dl></details>
            <div className="song-version-tools">{version.facts.url && <a className="btn btn-ghost btn-sm" href={version.facts.url} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={16}/>查看来源</a>}<button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => requestAction(saved => { void operation.check(saved, [version.id]); })}>检查是否可播放</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => startTask({ type: 'move-version', songId: song.id, versionIds: [version.id] })}><ArrowRightIcon size={16}/>移到其他歌曲</button><button className="btn btn-ghost btn-sm danger-text" disabled={busy} onClick={() => startTask({ type: 'delete-version', songId: song.id, versionIds: [version.id] })}><TrashIcon size={16}/>删除版本</button></div>
          </section>}
        </div> : <div className="song-no-versions"><MusicNotesIcon size={30}/><h4>还没有保存播放版本</h4><p className="muted">播放时会自动匹配。搜索并添加第一个版本后，它将成为歌曲默认版本。</p></div>}
      </> : organization ? <><button className="btn btn-ghost btn-sm" onClick={() => setOrganization(false)}><ArrowLeftIcon size={17}/>返回歌曲资料</button><SongOrganizationPanel key={song.id} song={song} revision={library.revision} disabled={busy} autoOpen onChange={onChange}/></> : <div className="desktop-song-info"><label className="field"><span className="field-label">标准歌名</span><input className="input" aria-label="标准歌名" value={draft.title} required maxLength={1000} disabled={busy} onChange={e => { setDraft(old => ({ ...old, title: e.target.value })); setMessage(''); }}/></label><label className="field"><span className="field-label">歌手（每行一位）</span><textarea className="textarea" aria-label="歌曲歌手" rows={3} value={artistsText} disabled={busy} onChange={e => { setArtistsText(e.target.value); setDraft(old => ({ ...old, artists: splitArtists(e.target.value) })); setMessage(''); }}/></label>
        <section className="song-info-section"><h4>收藏与歌单</h4><p className="muted">{favorite ? '已加入我的收藏。' : '尚未收藏。'}{memberLists.length ? '已加入：' + memberLists.map(p => p.name).join('、') + '。' : '尚未加入自建歌单。'}</p><button className="btn btn-secondary btn-sm" disabled={busy || favorite} onClick={() => saveMembership([{ type: 'favorite', songId: song.id }], '已加入我的收藏。')}><HeartIcon size={17} weight={favorite ? 'fill' : 'regular'}/>{favorite ? '已收藏' : '收藏歌曲'}</button>
          {library.snapshot.playlists.length > 0 && <div className="song-membership-add"><label className="field"><span className="field-label">加入歌单</span><select className="select" aria-label="歌曲加入目标歌单" value={playlistTarget} disabled={busy} onChange={e => setPlaylistTarget(e.target.value)}><option value="">选择歌单</option>{library.snapshot.playlists.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><button className="btn btn-secondary" disabled={busy || !library.snapshot.playlists.some(p => p.id === playlistTarget)} onClick={() => saveMembership([{ type: 'add-entry', playlistId: playlistTarget, songId: song.id }], '已加入所选歌单。')}><PlusIcon size={17}/>添加歌曲</button></div>}
        </section>
        <section className="song-info-section"><h4>目录封面与歌曲资料</h4><p className="muted">{catalogStatus(song)}</p>{catalog ? <><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCatalog(false)}>收起目录匹配</button><SongCatalogPanel key={song.id} song={song} revision={library.revision} disabled={busy || dirty} onChange={onChange} onClose={() => setCatalog(false)}/></> : <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => requestAction(() => setCatalog(true))}>匹配或更换目录资料</button>}</section>
        <section className="song-info-section"><h4>整理歌曲资料</h4><p className="muted">根据已经保存的资料核对歌名与歌手，逐项选择需要采用的建议。</p><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => requestAction(() => setOrganization(true))}>查看整理建议</button></section>
        <section className="song-info-section"><h4>重复或不再需要的歌曲</h4><p className="muted">合并用于同一首歌保存了多次的情况。操作前会展示影响，供你确认。</p><div className="toolbar"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => startTask({ type: 'merge-songs', songId: song.id })}><ArrowsMergeIcon size={17}/>合并到另一首歌曲</button><button className="btn btn-ghost btn-sm danger-text" disabled={busy} onClick={() => startTask({ type: 'delete-song', songId: song.id })}><TrashIcon size={17}/>从资料库删除</button></div></section>
      </div>}
      {stale && <section className="song-draft-conflict feedback" role="alert"><h4>资料已变化，你的修改已保留</h4><p>核对最新内容后，再保存你的修改。</p><table><thead><tr><th>字段</th><th>最新内容</th><th>你的修改</th></tr></thead><tbody>{conflicts.map((change, i) => <tr key={i}><th>{change.field}</th><td>{change.current}</td><td>{change.pending}</td></tr>)}</tbody></table><button className="btn btn-secondary btn-sm" onClick={() => { const rebased = rebaseSongDraft(base, draft, current); setBase(current); setDraft(rebased); setRevision(library.revision); setArtistsText(rebased.artists.join('\n')); setPerformerTexts({}); setError(''); setMessage('已载入最新资料，请确认更改后保存。'); }}>已核对，保留修改并继续</button></section>}
      {(error || operation.error) && <p className="feedback" role="alert">{error || operation.error}</p>}{operation.message && <p className="song-inline-message" role="status">{operation.message}</p>}{operation.busy && <p role="status">正在检查来源… <button className="btn btn-ghost btn-sm" onClick={operation.cancel}>取消检查</button></p>}
    </div>
    <footer className="song-workspace-footer"><span className="muted" role="status">{saving ? '正在保存…' : dirty ? '有未保存的更改' : message || '所有更改已保存'}</span><div className="toolbar"><button className="btn btn-ghost" disabled={busy} onClick={goBack}>{onBack ? '返回歌曲管理' : '完成'}</button><button className="btn btn-primary" disabled={busy || !dirty || stale || !draft.title.trim()} onClick={() => void save()}>{saving ? '保存中…' : '保存更改'}</button></div></footer>
  </div>;
}

type Filter = 'all' | 'missing' | 'pending';
const SongManager = memo(function SongManager({ library, onChange, onEdit, onTask, message }: {
  library: SongLibraryState; onChange: (state: SongLibraryState) => void; onEdit: (context: SongDialogContext) => void; onTask: (task: SongTask) => void; message: string;
}) {
  const [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const operation = useSongMaintenance(onChange);
  const index = desktopSongIndex(library.snapshot), songs = index.retainedSongs;
  const filtered = useMemo(() => {
    const text = query.toLocaleLowerCase();
    return songs.filter(song => (filter === 'all' || index[filter].has(song.id)) && index.searchText.get(song.id)!.includes(text));
  }, [index, filter, query]);
  const selectedVersions = selected.flatMap(id => { const version = index.versions.get(id); return version ? [version] : []; });
  useEffect(() => { setSelected(old => old.every(id => index.retainedVersionIds.has(id)) ? old : old.filter(id => index.retainedVersionIds.has(id))); }, [index]);
  const toggle = (id: string) => setSelected(old => old.includes(id) ? old.filter(v => v !== id) : old.length < 20 ? [...old, id] : old);
  return <div className="song-manager">
    <div className="song-manager-heading"><p className="muted">管理当前收藏和歌单中的歌曲，整理重复歌曲和无法播放的版本。</p><label className="search-field"><MagnifyingGlassIcon size={18}/><input aria-label="搜索已保存歌曲" placeholder="搜索歌名或歌手" data-autofocus="true" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="song-manager-filters" role="group" aria-label="歌曲筛选">{([['all', '全部歌曲'], ['missing', '存在失效版本'], ['pending', '待检查']] as const).map(([value, label]) => <button aria-pressed={filter === value} className={filter === value ? 'selected' : ''} key={value} onClick={() => setFilter(value)}>{label}<small>{index.counts[value]}</small></button>)}</div>
      <div className="song-manager-batch"><span className="muted">已选 {selected.length} / 20 个版本</span><div className="toolbar"><button className="btn btn-secondary btn-sm" disabled={operation.busy || !selected.length} onClick={() => void operation.check(library, selected)}>检查所选版本</button><button className="btn btn-ghost btn-sm danger-text" disabled={operation.busy || !selectedVersions.length || selectedVersions.some(v => !isMissingVersion(v))} onClick={() => onTask({ type: 'clean-unavailable', versionIds: selected })}>清理所选失效版本</button><button className="btn btn-ghost btn-sm" disabled={operation.busy || !selected.length} onClick={() => setSelected([])}>清除选择</button></div></div>
    </div>
    <div className="song-workspace-body song-manager-list">
      {filter === 'missing' && <p className="muted song-manager-note">仅列出已确认来源不存在的版本。网络、登录或限流问题归入“待检查”。</p>}
      {operation.error && <p className="feedback" role="alert">{operation.error}</p>}{(operation.message || message) && <p className="song-inline-message" role="status">{operation.message || message}</p>}{operation.busy && <p role="status">正在检查来源… <button className="btn btn-ghost btn-sm" onClick={operation.cancel}>取消检查</button></p>}
      <PagedList id={'song-manager:' + filter + ':' + query} group="song-manager" label="已保存歌曲" items={filtered}>{items => items.length ? <div>{items.map(song => {
        const versions = index.versionsBySong.get(song.id) ?? [], playlists = index.playlistsBySong.get(song.id) ?? [], favorite = index.favorites.has(song.id);
        return <article className="song-manager-row" key={song.id}><div className="song-manager-song"><SongCover song={song}/><button className="song-manager-open" aria-label={'管理歌曲 ' + song.title} onClick={() => onEdit({ songId: song.id })}><strong>{song.title}</strong><small>{song.artists?.join(' / ') || '歌手未填写'}</small></button><span className="song-manager-membership">{favorite ? '已收藏' : ''}{favorite && playlists.length ? ' · ' : ''}{playlists.map(p => p.name).join('、')}</span><button className="btn btn-ghost btn-sm" onClick={() => onEdit({ songId: song.id })}>管理<ArrowRightIcon size={16}/></button></div>
          {versions.length ? <SongManagerVersions key={filter} versions={versions} filter={filter} selected={selected} busy={operation.busy} toggle={toggle}/> : <p className="muted song-manager-no-version">没有已保存版本，播放时自动匹配。</p>}
        </article>;
      })}</div> : <div className="empty"><MusicNotesIcon size={32}/><h3>{songs.length ? '没有符合条件的歌曲' : '还没有收藏或加入歌单的歌曲'}</h3><p>收藏歌曲或加入歌单后，可以在这里管理。</p></div>}</PagedList>
    </div>
    <footer className="song-workspace-footer"><span className="muted">共 {filtered.length} 首歌曲 · 检查不会自动删除版本</span></footer>
  </div>;
});

function SongManagerVersions({ versions, filter, selected, busy, toggle }: { versions: SongVersion[]; filter: Filter; selected: string[]; busy: boolean; toggle: (id: string) => void }) {
  const [open, setOpen] = useState(filter !== 'all');
  return <details className="song-manager-versions" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{versions.length} 个版本 · 展开选择和检查{versions.some(isMissingVersion) && <span className="version-status-unavailable"> · 存在失效版本</span>}{versions.some(v => v.availability.state === 'uncertain') && <span> · 暂时无法确认</span>}</summary>
    {open && <div>{versions.filter(v => filter === 'missing' ? isMissingVersion(v) : true).map(version => <label className="song-manager-version" key={version.id}><input type="checkbox" aria-label={'选择版本 ' + versionName(version)} checked={selected.includes(version.id)} disabled={busy || !selected.includes(version.id) && selected.length >= 20} onChange={() => toggle(version.id)}/><span><strong>{versionName(version)}</strong><small>{version.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}{version.facts.uploader ? ' · ' + version.facts.uploader : ''}</small></span><VersionStatus version={version}/></label>)}</div>}
  </details>;
}
