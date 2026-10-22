import type { Song, SongLibraryState, SongPlaylistEntry, SongVersion } from '../server/song-library-types';

export type SongCommit = (edits: unknown[], revision?: string | null, localFeedback?: boolean) => Promise<SongLibraryState | undefined>;
export type SongDialogContext = { songId: string; playlistId?: string; entryId?: string; versionId?: string };
export type SongVersionDraft = Pick<SongVersion, 'label' | 'kind' | 'performers'> & { sourceTitle?: string };
export type SongDraft = {
  title: string; artists: string[]; defaultVersionId: string | null;
  versions: Record<string, SongVersionDraft>; pinnedVersionId?: string | null;
};
export const versionKinds: Record<SongVersion['kind'], string> = { studio: '录音室', mv: 'MV', live: '现场', cover: '翻唱', remix: '混音', other: '其他' };
export const versionName = (version: SongVersion) => version.label || version.facts.title;
export const isMissingVersion = (version: SongVersion) => version.availability.state === 'unavailable' && version.availability.code === 'not-found';
export const availabilityLabel = (version: SongVersion) => ({ unknown: '尚未检查', available: '可播放', unavailable: '已确认失效', uncertain: '暂时无法确认' })[version.availability.state];
export const entryFor = (library: SongLibraryState, context: SongDialogContext) => library.snapshot.playlists.find(p => p.id === context.playlistId)?.entries.find(e => e.entryId === context.entryId && e.songId === context.songId);
export const splitArtists = (value: string) => value.split('\n').map(v => v.trim()).filter(Boolean);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function songDraft(song: Song, versions: SongVersion[], entry?: SongPlaylistEntry): SongDraft {
  return { title: song.title, artists: song.artists ?? [], defaultVersionId: song.defaultVersionId,
    versions: Object.fromEntries(versions.map(v => [v.id, { label: v.label, kind: v.kind, performers: v.performers ?? [], sourceTitle: v.facts.title }])),
    ...(entry ? { pinnedVersionId: entry.pinnedVersionId } : {}) };
}

/** Only changed fields become commands, so a rebase cannot overwrite unrelated edits. */
export function songDraftEdits(base: SongDraft, draft: SongDraft, context: SongDialogContext): unknown[] {
  const edits: unknown[] = [], patch: Record<string, unknown> = { type: 'edit-song', songId: context.songId };
  if (base.title !== draft.title.trim()) patch.title = draft.title.trim();
  if (!equal(base.artists, draft.artists)) patch.artists = draft.artists;
  if (Object.keys(patch).length > 2) edits.push(patch);
  for (const [versionId, value] of Object.entries(draft.versions)) {
    const before = base.versions[versionId]; if (!before) continue;
    const edit: Record<string, unknown> = { type: 'edit-version', versionId };
    for (const key of ['label', 'kind', 'performers'] as const) if (!equal(before[key], value[key])) edit[key] = value[key];
    if (Object.keys(edit).length > 2) edits.push(edit);
  }
  if (base.defaultVersionId !== draft.defaultVersionId) edits.push({ type: 'set-default', songId: context.songId, versionId: draft.defaultVersionId });
  if (context.playlistId && context.entryId && base.pinnedVersionId !== undefined && base.pinnedVersionId !== draft.pinnedVersionId)
    edits.push({ type: 'pin-entry', playlistId: context.playlistId, entryId: context.entryId, versionId: draft.pinnedVersionId });
  return edits;
}

export interface SongDraftChange { field: string; current: string; pending: string }
const show = (value: unknown) => Array.isArray(value) ? value.join(' / ') || '未填写' : String(value ?? '未设置');
export function changedSongFields(base: SongDraft, draft: SongDraft, current: SongDraft): SongDraftChange[] {
  const changes: SongDraftChange[] = [];
  const add = (field: string, before: unknown, pending: unknown, latest: unknown) => {
    if (!equal(before, pending)) changes.push({ field, current: show(latest), pending: show(pending) });
  };
  add('歌名', base.title, draft.title, current.title); add('歌手', base.artists, draft.artists, current.artists);
  const name = (id: string | null | undefined, state: SongDraft) => id ? state.versions[id]?.label || state.versions[id]?.sourceTitle || '所选版本' : '自动匹配 / 跟随歌曲默认';
  if (base.defaultVersionId !== draft.defaultVersionId) changes.push({ field: '歌曲默认版本', current: name(current.defaultVersionId, current), pending: name(draft.defaultVersionId, draft) });
  if (base.pinnedVersionId !== draft.pinnedVersionId) changes.push({ field: '本条歌单记录播放版本', current: name(current.pinnedVersionId, current), pending: name(draft.pinnedVersionId, draft) });
  for (const [id, value] of Object.entries(draft.versions)) {
    const before = base.versions[id]; if (!before) continue;
    for (const [key, label] of [['label', '版本名称'], ['kind', '版本类别'], ['performers', '版本演唱者']] as const)
      add(`${before.label || before.sourceTitle || '版本'} · ${label}`, key === 'kind' ? versionKinds[before.kind] : before[key], key === 'kind' ? versionKinds[value.kind] : value[key], current.versions[id] ? key === 'kind' ? versionKinds[current.versions[id].kind] : current.versions[id][key] : '版本已移除');
  }
  return changes;
}

/** Carry only the user's touched fields onto a fresh snapshot; removed identities are not recreated. */
export function rebaseSongDraft(base: SongDraft, draft: SongDraft, current: SongDraft): SongDraft {
  const next = structuredClone(current);
  for (const key of ['title', 'artists', 'defaultVersionId', 'pinnedVersionId'] as const) {
    if (!equal(base[key], draft[key])) Object.assign(next, { [key]: draft[key] });
  }
  if (next.defaultVersionId && !current.versions[next.defaultVersionId]) next.defaultVersionId = null;
  if (next.pinnedVersionId && !current.versions[next.pinnedVersionId]) next.pinnedVersionId = null;
  if (current.pinnedVersionId === undefined) delete next.pinnedVersionId;
  for (const [id, value] of Object.entries(draft.versions)) {
    const before = base.versions[id]; if (!before || !next.versions[id]) continue;
    for (const key of ['label', 'kind', 'performers'] as const) if (!equal(before[key], value[key])) Object.assign(next.versions[id], { [key]: value[key] });
  }
  return next;
}
