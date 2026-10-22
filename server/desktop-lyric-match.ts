import { lyricQuery } from './lyrics-format.js';

/** Desktop also accepts a clearly separated singer after the quoted song name. */
export function desktopLyricQuery(title: string, artists?: string[]): { title: string; artist: string } {
  const query = lyricQuery(title, artists);
  if (query.artist) return query;
  const clean = title.normalize('NFKC').replace(/【[^】]*(?:hi[- ]?res|无损|音质|4k|1080|录音棚)[^】]*】/giu, '').trim();
  const quoted = [...clean.matchAll(/《([^《》]+)》/gu)];
  if (quoted.length !== 1 || /(?:翻唱|\bcover\b|原唱)/iu.test(clean)) return query;
  // A nonempty prefix may describe a collection or a different performer.
  if (clean.slice(0, quoted[0].index).replace(/[\s|｜:：—–-]/gu, '')) return query;
  const suffix = clean.slice(quoted[0].index! + quoted[0][0].length).replace(/^[\s|｜:：—–-]+/u, '');
  const singer = suffix.split(/[|｜:：—–]|\s+-\s+/u)[0].replace(/\s*[（(](?:live|现场|remix|混音)[）)]\s*$/iu, '').trim();
  if (/^[\p{L}\p{M}][\p{L}\p{M}.'’· -]{1,47}$/u.test(singer)
    && !/(?:精选|合集|串烧|演唱|演奏|歌曲|音乐|完整版|歌词|现场|伴奏|音质|录音棚|试听|百万|无损|版本|女声|男声|女版|男版|弹唱|官方|\b(?:live|remix|instrumental|karaoke|mv)\b)/iu.test(singer)) query.artist = singer;
  return query;
}

// Explicit aliases only: similar spelling or matching duration does not prove identity.
const artistAliases = new Map([
  ['周杰倫', '周杰伦'],
  ['周傑倫', '周杰伦'],
  ['jaychou', '周杰伦'],
]);
export function desktopLyricArtistKey(value: string): string {
  const key = value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  return artistAliases.get(key) ?? key;
}

export function desktopLyricArtistsKey(artists: string[]): string {
  return [...new Set(artists.flatMap(name => name.split(/\s*[/、&]\s*/u)).map(desktopLyricArtistKey).filter(Boolean))].sort().join('/');
}
