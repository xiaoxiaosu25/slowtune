import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { catalogSongKey, songSourceKey } from './song-library-policy.js';
import { maxSongLibrarySnapshotBytes, type SongLibrarySnapshot } from './song-library-types.js';
import { validatePlaylistCover } from './playlist-cover.js';

const fail = (): never => { throw new LibraryError('invalid-input'); };
export function object(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) fail();
}
export function text(value: unknown, max = 500, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail();
}
export function integer(value: unknown): asserts value is number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(); }
export function list(value: unknown, max = 100000): asserts value is any[] { if (!Array.isArray(value) || value.length > max) fail(); }
const oneOf = (value: unknown, values: readonly unknown[]) => { if (!values.includes(value)) fail(); };
const strings = (value: unknown, max = 100, length = 1000) => { list(value, max); value.forEach(item => text(item, length)); };
const optional = (value: unknown, validate: (value: any) => void) => { if (value !== undefined) validate(value); };
function url(value: unknown) {
  text(value, 4000);
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || [...parsed.searchParams.keys()].some(key => /token|credential|signature|cookie|auth|expire|lease|session/i.test(key))) fail();
    // Only source pages and cover URLs belong here; media deliveries never do.
    if (/(^|\.)(bilivideo\.(com|cn|net)|googlevideo\.com)$/i.test(parsed.hostname)) fail();
  } catch { fail(); }
}
function ref(value: unknown) {
  object(value, ['provider', 'kind', 'id', 'part']);
  text(value.id, 200); optional(value.part, part => text(part, 100));
  songSourceKey(value as any);
  if (value.provider === 'bilibili' && (!/^BV[\da-zA-Z]{10}$/.test(value.id) || typeof value.part !== 'string' || !/^[1-9]\d{0,19}$/.test(value.part))) fail();
  if (value.provider === 'youtube' && !/^[\w-]{11}$/.test(value.id)) fail();
}
function field(value: unknown) { object(value, ['source', 'protected']); oneOf(value.source, ['manual', 'catalog', 'parsed']); if (typeof value.protected !== 'boolean' || value.source === 'manual' && !value.protected) fail(); }
function desktopCatalog(value: unknown) {
  object(value, ['state', 'checkedAt', 'selection', 'record', 'issue']);
  oneOf(value.state, ['matched', 'review', 'not-found', 'error', 'disabled']); integer(value.checkedAt);
  optional(value.selection, v => oneOf(v, ['automatic', 'manual'])); optional(value.issue, v => text(v, 80));
  if (value.state === 'matched' ? !value.record || !value.selection : value.record !== undefined || value.selection !== undefined) fail();
  if (value.record !== undefined) {
    const r = value.record; object(r, ['provider', 'id', 'title', 'artists', 'album', 'artwork', 'durationSeconds', 'url']);
    if (r.provider !== 'netease' || typeof r.id !== 'string' || !/^[1-9]\d{0,15}$/u.test(r.id) || !Number.isSafeInteger(Number(r.id))) fail();
    text(r.title, 1000); strings(r.artists); optional(r.album, v => text(v, 1000)); optional(r.artwork, url); url(r.url);
    if (r.url !== 'https://music.163.com/song?id=' + r.id) fail();
    optional(r.durationSeconds, v => { if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 86400) fail(); });
  }
}
function facts(value: unknown) {
  object(value, ['title', 'artists', 'uploader', 'uploaderId', 'artwork', 'durationSeconds', 'url']);
  text(value.title, 1000); optional(value.artists, strings); optional(value.uploader, v => text(v, 1000)); optional(value.uploaderId, v => text(v, 500));
  optional(value.artwork, url); optional(value.url, url);
  optional(value.durationSeconds, v => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 31536000) fail(); });
}
function sourcePage(value: any, reference: any) {
  if (value === undefined) return;
  const parsed = new URL(value);
  if (reference.provider === 'bilibili') {
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.bilibili.com' || parsed.pathname.replace(/\/$/, '') !== '/video/' + reference.id || [...parsed.searchParams.keys()].some(key => key !== 'p') || parsed.searchParams.has('p') && !/^[1-9]\d*$/.test(parsed.searchParams.get('p')!)) fail();
  } else if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.youtube.com' || parsed.pathname !== '/watch' || parsed.searchParams.get('v') !== reference.id || [...parsed.searchParams.keys()].some(key => key !== 'v')) fail();
}
function availability(value: unknown) {
  object(value, ['state', ...(value && (value as any).state !== 'unknown' ? ['checkedAt', ...((value as any).state !== 'available' ? ['code'] : [])] : [])]);
  oneOf(value.state, ['unknown', 'available', 'unavailable', 'uncertain']);
  if (value.state !== 'unknown') integer(value.checkedAt);
  if (['unavailable', 'uncertain'].includes(value.state)) { text(value.code, 80); if (!/^[a-z0-9-]+$/.test(value.code)) fail(); }
}
function context(value: unknown) {
  object(value, ['source', 'title', 'artists', 'upstreamSongId', 'chart', 'periodId', 'rank', 'sourceUrl', 'artwork']);
  oneOf(value.source, ['netease', 'qq', 'bilibili', 'apple']); text(value.title, 1000); optional(value.artists, strings);
  optional(value.upstreamSongId, v => text(v, 500)); optional(value.chart, v => oneOf(v, ['hot', 'new', 'rising', 'most-played']));
  optional(value.periodId, integer); optional(value.rank, integer); optional(value.sourceUrl, url); optional(value.artwork, url);
}
export const emptySongLibrary = (): SongLibrarySnapshot => ({ format: 'slowtune-library', version: 1, songs: [], versions: [], favorites: [], playlists: [], catalogLinks: [], redirects: [] });

/** Browser-safe, strict boundary for untrusted JSON. Unknown/runtime fields are rejected at every level. */
export function decodeSongLibrarySnapshot(input: unknown, copy = true): SongLibrarySnapshot {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > maxSongLibrarySnapshotBytes) fail();
    try { input = JSON.parse(input); } catch { fail(); }
  }
  object(input, ['format', 'version', 'songs', 'versions', 'favorites', 'desktopFavoritesCover', 'playlists', 'catalogLinks', 'redirects']);
  if (input.format !== 'slowtune-library') fail();
  if (input.version !== 1) throw new LibraryError('unknown-version');
  for (const key of ['songs', 'versions', 'favorites', 'playlists', 'catalogLinks', 'redirects']) list(input[key], key === 'playlists' ? 1000 : 100000);
  optional(input.desktopFavoritesCover, validatePlaylistCover);
  for (const s of input.songs) {
    object(s, ['id', 'title', 'artists', 'artwork', 'contentKind', 'fields', 'desktopCatalog', 'originals', 'aliases', 'defaultVersionId', 'organization', 'createdAt', 'updatedAt']);
    text(s.id, 200); text(s.title, 1000); optional(s.artists, strings); optional(s.artwork, url);
    oneOf(s.contentKind, ['single', 'medley', 'collection', 'unknown']); oneOf(s.organization, ['organized', 'pending']);
    object(s.fields, ['title', 'artists', 'artwork']); field(s.fields.title); field(s.fields.artists); optional(s.fields.artwork, field);
    optional(s.desktopCatalog, desktopCatalog);
    if (s.defaultVersionId !== null) text(s.defaultVersionId, 200);
    integer(s.createdAt); integer(s.updatedAt); if (s.updatedAt < s.createdAt) fail();
    strings(s.aliases, 10000); list(s.originals, 10000);
    for (const original of s.originals) { object(original, ['title', 'artists', 'ref']); text(original.title, 1000); optional(original.artists, strings); optional(original.ref, ref); }
  }
  for (const v of input.versions) {
    object(v, ['id', 'songId', 'ref', 'label', 'kind', 'performers', 'facts', 'availability']);
    text(v.id, 200); text(v.songId, 200); ref(v.ref); text(v.label, 1000, true);
    oneOf(v.kind, ['studio', 'mv', 'live', 'cover', 'remix', 'other']); optional(v.performers, strings); facts(v.facts); availability(v.availability);
    sourcePage(v.facts.url, v.ref);
  }
  for (const f of input.favorites) { object(f, ['favoriteId', 'songId', 'position', 'addedAt']); text(f.favoriteId, 200); text(f.songId, 200); integer(f.position); integer(f.addedAt); }
  let entries = 0;
  for (const p of input.playlists) {
    object(p, ['id', 'name', 'desktopCover', 'entries', 'createdAt', 'updatedAt']); text(p.id, 200); if (p.id.startsWith('system:')) fail(); text(p.name, 500); integer(p.createdAt); integer(p.updatedAt); if (p.updatedAt < p.createdAt) fail();
    optional(p.desktopCover, validatePlaylistCover);
    list(p.entries); entries += p.entries.length; if (entries > 100000) fail();
    for (const e of p.entries) { object(e, ['entryId', 'songId', 'position', 'addedAt', 'pinnedVersionId']); text(e.entryId, 200); text(e.songId, 200); integer(e.position); integer(e.addedAt); if (e.pinnedVersionId !== null) text(e.pinnedVersionId, 200); }
  }
  for (const l of input.catalogLinks) { object(l, ['id', 'key', 'songId', 'context']); text(l.id, 200); text(l.key, 10000); text(l.songId, 200); context(l.context); }
  for (const r of input.redirects) { object(r, ['from', 'to']); text(r.from, 200); text(r.to, 200); }
  validateSongLibrarySnapshot(input as unknown as SongLibrarySnapshot);
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > maxSongLibrarySnapshotBytes) fail(); } catch { fail(); }
  return (copy ? structuredClone(input) : input) as unknown as SongLibrarySnapshot;
}
export function encodeSongLibrarySnapshot(input: SongLibrarySnapshot): string { return JSON.stringify(decodeSongLibrarySnapshot(input)); }

/** Relations are checked only after the complete shape has been decoded. */
function validateSongLibrarySnapshot(snapshot: SongLibrarySnapshot): void {
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) throw new LibraryError('duplicate'); };
  unique(snapshot.songs.map(s => s.id)); unique(snapshot.versions.map(v => v.id)); unique(snapshot.playlists.map(p => p.id));
  unique(snapshot.favorites.map(f => f.favoriteId)); unique(snapshot.favorites.map(f => f.songId)); unique(snapshot.playlists.flatMap(p => p.entries.map(e => e.entryId)));
  unique(snapshot.versions.map(v => songSourceKey(v.ref))); unique(snapshot.catalogLinks.map(l => l.key)); unique(snapshot.catalogLinks.map(l => l.id));
  const songs = new Map(snapshot.songs.map(s => [s.id, s])), versions = new Map(snapshot.versions.map(v => [v.id, v]));
  const belongs = (songId: string, versionId: string) => { if (!songs.has(songId) || versions.get(versionId)?.songId !== songId) fail(); };
  for (const v of snapshot.versions) if (!songs.has(v.songId)) fail();
  for (const s of snapshot.songs) if (s.defaultVersionId !== null) belongs(s.id, s.defaultVersionId);
  for (const [i, f] of snapshot.favorites.entries()) if (!songs.has(f.songId) || f.position !== i) fail();
  for (const p of snapshot.playlists) for (const [i, e] of p.entries.entries()) { if (!songs.has(e.songId) || e.position !== i) fail(); if (e.pinnedVersionId !== null) belongs(e.songId, e.pinnedVersionId); }
  for (const l of snapshot.catalogLinks) if (!songs.has(l.songId) || l.key !== catalogSongKey(l.context)) fail();
  const redirects = new Map(snapshot.redirects.map(r => [r.from, r.to])); unique(snapshot.redirects.map(r => r.from));
  const resolved = new Map<string, string>();
  for (const r of snapshot.redirects) {
    if (songs.has(r.from)) fail();
    if (resolved.has(r.from)) continue;
    let target = r.from; const seen = new Set<string>();
    while (redirects.has(target) && !resolved.has(target)) { if (seen.has(target)) fail(); seen.add(target); target = redirects.get(target)!; }
    target = resolved.get(target) ?? target;
    if (!songs.has(target)) fail();
    for (const from of seen) resolved.set(from, target);
  }
}
