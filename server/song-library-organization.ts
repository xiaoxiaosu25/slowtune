import { SongLibraryError } from './song-library-errors.js';
import type { Song, SongLibrarySnapshot } from './song-library-types.js';

export type SongOrganizationField = 'title' | 'artists';
export interface SongOrganizationCandidate {
  id: string;
  patch: { title?: string; artists?: string[] };
  evidence: { kind: 'catalog' | 'metadata' | 'title'; title: string; versionId?: string }[];
}
export interface SongOrganizationPreview {
  token: string;
  revision: string | null;
  expiresAt: number;
  songId: string;
  current: Pick<Song, 'title' | 'artists' | 'fields'>;
  candidates: SongOrganizationCandidate[];
  warnings: string[];
  limited: boolean;
}

const collection = /合集|串烧|精选|歌单|盘点|\b(?:medley|playlist|compilation|mashup)\b/iu;
const technical = /^(?:hi[- ]?res|4k|8k|1080p|2160p|无损(?:音质)?|高音质|超清|高清|官方(?:mv)?|mv|live|现场|录音室)(?:[\s·|/,-]*(?:修复|版|音质|中字|字幕))*$/iu;
const descriptive = /歌词|字幕|完整版|纯享版|伴奏|混剪|剪辑|\b(?:official\s+(?:music\s+)?(?:video|mv|audio)|music\s+video|lyrics?|subtitles?|audio\s+only)\b|[。！？!?；;]/iu;
const clean = (value: string) => value.trim().replace(/^[\s|｜·:：—–-]+|[\s|｜·:：—–-]+$/gu, '').trim();
const artistList = (value: string) => {
  const artists = value.split(/\s+[&/]\s+|、|，/u).map(clean).filter(Boolean);
  return artists.length > 0 && artists.length <= 8 && artists.every(name => name.length <= 80 && !technical.test(name) && !descriptive.test(name) && !/[《》「」【】“”"'‘’]|\d{3,}|https?:/u.test(name)) ? [...new Set(artists)] : undefined;
};

/** Only explicit title forms are interpreted; undecidable separator order remains two choices. */
export function parseTitle(input: string, knownArtists?: string[]): { patches: { title?: string; artists?: string[] }[]; ambiguous: boolean } {
  let value = input.trim();
  for (let i = 0; i < 4; i++) {
    const prefix = value.match(/^(?:【([^【】]+)】|\[([^\[\]]+)\])\s*/u);
    if (!prefix || !technical.test(prefix[1] ?? prefix[2])) break;
    value = value.slice(prefix[0].length);
  }
  const quoted = [...value.matchAll(/《([^《》]{1,200})》/gu)];
  if (quoted.length > 1) return { patches: [], ambiguous: true };
  if (quoted.length === 1) {
    const match = quoted[0], title = match[1].trim();
    const suffix = value.slice(match.index! + match[0].length);
    const left = clean(value.slice(0, match.index)), right = clean(suffix);
    // Bare suffixes are usually descriptions; only an explicitly separated name is considered.
    const artists = knownArtists?.length ? knownArtists : !right && left ? artistList(left) : !left && right && /^\s*[|｜·:：—–-]/u.test(suffix) ? artistList(right) : undefined;
    return { patches: title ? [{ title, ...(artists ? { artists } : {}) }] : [], ambiguous: !!(left || right) && !artists?.length };
  }
  const pair = value.split(/\s+[-–—]\s+/u).map(clean);
  if (pair.length !== 2 || pair.some(part => !part || part.length > 200)) return { patches: knownArtists?.length ? [{ artists: knownArtists }] : [], ambiguous: false };
  if (knownArtists?.length) {
    const matches = (part: string) => knownArtists.some(artist => artist === part) || knownArtists.join(' / ') === part;
    if (matches(pair[0]) !== matches(pair[1])) return { patches: [{ title: matches(pair[0]) ? pair[1] : pair[0], artists: knownArtists }], ambiguous: false };
    return { patches: [{ artists: knownArtists }], ambiguous: true };
  }
  return { patches: pair.flatMap((part, index) => { const artists = artistList(part); return artists ? [{ title: pair[1 - index], artists }] : []; }), ambiguous: true };
}

/** Local, bounded, read-only suggestions. No source access, grouping, or persistent suggestion state. */
export function planSongOrganization(snapshot: SongLibrarySnapshot, songId: string): Omit<SongOrganizationPreview, 'token' | 'revision' | 'expiresAt'> {
  const song = snapshot.songs.find(song => song.id === songId);
  if (!song) throw new SongLibraryError('not-found');
  const candidates: SongOrganizationCandidate[] = [], warnings = new Set<string>();
  let limited = false;
  const add = (patch: SongOrganizationCandidate['patch'], evidence: SongOrganizationCandidate['evidence'][number], source: 'catalog' | 'parsed') => {
    const allowed: SongOrganizationCandidate['patch'] = {};
    if (patch.title && patch.title.length > 200 || patch.artists && (patch.artists.length > 8 || patch.artists.some(artist => artist.length > 200))) { limited = true; return; }
    if (patch.title && patch.title !== song.title && !song.fields.title.protected && !(source === 'parsed' && song.fields.title.source === 'catalog')) allowed.title = patch.title;
    if (patch.artists?.length && JSON.stringify(patch.artists) !== JSON.stringify(song.artists ?? []) && !song.fields.artists.protected && !(source === 'parsed' && song.fields.artists.source === 'catalog')) allowed.artists = [...patch.artists];
    if (!Object.keys(allowed).length) return;
    const key = JSON.stringify(allowed), previous = candidates.find(candidate => JSON.stringify(candidate.patch) === key);
    if (previous) { if (previous.evidence.length < 3) previous.evidence.push(evidence); return; }
    if (candidates.length === 6) { limited = true; return; }
    candidates.push({ id: String(candidates.length + 1), patch: allowed, evidence: [evidence] });
  };
  if (song.contentKind === 'collection' || song.contentKind === 'medley') {
    warnings.add('这首资料已标为合集或串烧，请保留独立身份并手动核对。');
  } else {
    let catalogs = 0;
    for (const link of snapshot.catalogLinks) if (link.songId === songId) {
      if (catalogs++ === 10) { limited = true; break; }
      add({ title: link.context.title, ...(link.context.artists?.length ? { artists: link.context.artists } : {}) }, { kind: 'catalog', title: link.context.title }, 'catalog');
    }
    let versions = 0;
    for (const version of snapshot.versions) if (version.songId === songId) {
      if (versions++ === 20) { limited = true; break; }
      if (collection.test(version.facts.title)) { warnings.add('部分来源标题包含合集或串烧信息，已跳过提取；不会拆分或合并歌曲。'); continue; }
      const evidence = { title: version.facts.title, versionId: version.id };
      const parsed = parseTitle(version.facts.title, version.facts.artists);
      if (parsed.ambiguous) warnings.add('来源标题存在多种解释，请结合原标题核对歌名和歌手；不会自动采用。');
      for (const patch of parsed.patches) add(patch, { ...evidence, kind: patch.title ? 'title' : 'metadata' }, 'parsed');
    }
  }
  if (candidates.length > 1) warnings.add('有多个候选，请选择符合这首歌曲的建议；同名不会触发归组或合并。');
  if (song.fields.title.protected || song.fields.artists.protected) warnings.add('人工修改过的字段已保护，整理建议不会覆盖；如需调整，请使用编辑资料。');
  if (!candidates.length) warnings.add('没有可采用的明确建议，可以保留现有资料或手动编辑。');
  if (limited) warnings.add('已达到本次处理范围：前 20 个版本、前 10 条目录资料、最多 6 个候选；过长字段保留原样，不截断采用。');
  return { songId, current: structuredClone({ title: song.title, artists: song.artists, fields: song.fields }), candidates, warnings: [...warnings], limited };
}
