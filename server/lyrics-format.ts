import { lyricTextBytes, LyricsError, type LyricCandidate, type LyricLine } from './lyrics-types.js';

const stamp = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
/** LRC file offset is applied once; the user's positive offset delays displayed lyrics. */
export function parseLyrics(text: string, translation?: string): LyricLine[] {
  const parse = (raw: string): LyricLine[] => {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > lyricTextBytes) throw new LyricsError('invalid-input');
    const rows = raw.replace(/^\uFEFF/u, '').split(/\r?\n/u);
    if (rows.length > 4000) throw new LyricsError('invalid-input');
    const offset = raw.match(/^\s*\[offset:([+-]?\d{1,6})\]\s*$/imu);
    const shift = offset ? Number(offset[1]) : 0;
    const timed: LyricLine[] = [], plain: LyricLine[] = [];
    let expandedBytes = 0;
    for (const row of rows) {
      if (row.length > 2000) throw new LyricsError('invalid-input');
      const times = [...row.matchAll(stamp)];
      const value = row.replace(stamp, '').trim();
      if (!times.length && /^\[[a-z][a-z0-9_-]*:.*\]$/iu.test(value)) continue;
      expandedBytes += new TextEncoder().encode(value).length * Math.max(1, times.length);
      if (expandedBytes > lyricTextBytes * 2) throw new LyricsError('invalid-input');
      if (times.length) {
        for (const match of times) {
          const ms = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0')) - shift;
          timed.push({ startMs: Math.max(0, ms), text: value });
        }
      } else if (value) plain.push({ startMs: null, text: value });
      if (timed.length + plain.length > 4000) throw new LyricsError('invalid-input');
    }
    if (!timed.length) return plain;
    const lines: LyricLine[] = [];
    for (const line of timed.sort((a, b) => a.startMs! - b.startMs!)) {
      const previous = lines.at(-1);
      if (previous?.startMs === line.startMs) {
        if (line.text && !previous.text.split('\n').includes(line.text)) previous.text = previous.text ? previous.text + '\n' + line.text : line.text;
      } else lines.push(line);
    }
    return lines;
  };
  const lines = parse(text);
  if (translation?.trim()) {
    const translated = parse(translation), byTime = new Map(translated.filter(line => line.startMs !== null).map(line => [line.startMs!, line.text]));
    for (const [index, line] of lines.entries()) {
      const value = line.startMs === null ? translated.every(row => row.startMs === null) ? translated[index]?.text : undefined : byTime.get(line.startMs);
      if (value && value !== line.text) line.translation = value;
    }
  }
  return lines;
}

export function activeLyricLine(lines: LyricLine[], positionSeconds: number, offsetMs: number): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(offsetMs) || !lines.length || lines[0].startMs === null) return -1;
  const time = positionSeconds * 1000 - offsetMs;
  let lo = 0, hi = lines.length;
  while (lo < hi) { const middle = (lo + hi) >>> 1; if (lines[middle].startMs! <= time) lo = middle + 1; else hi = middle; }
  return lo - 1;
}

/** Extract song metadata from titles; an uploader is never a singer fallback. */
export function lyricQuery(title: string, artists?: string[]): { title: string; artist: string } {
  const clean = title.normalize('NFKC').replace(/【[^】]*(?:hi[- ]?res|无损|音质|4k|1080|录音棚)[^】]*】/giu, '').trim();
  const quoted = [...clean.matchAll(/《([^《》]+)》/gu)];
  const artist = artists?.filter(Boolean).join(' / ') ?? '';
  if (quoted.length === 1) {
    const prefix = clean.slice(0, quoted[0].index).replace(/^[\s|｜·:：-]+|[\s|｜·:：-]+$/gu, '').replace(/^【([^】]+)】$/u, '$1');
    const inferred = /^[\p{L}\p{M}.· ]{2,24}$/u.test(prefix) && !/(翻唱|精选|合集|演唱|歌曲|音乐|完整版|歌词|现场)/u.test(prefix) ? prefix : '';
    const suffix = clean.slice(quoted[0].index! + quoted[0][0].length);
    const version = /(?:\blive\b|现场)/iu.test(suffix) && !/(?:\blive\b|现场)/iu.test(quoted[0][1]) ? ' (Live)' : '';
    return { title: quoted[0][1].trim() + version, artist: artist || inferred };
  }
  return { title: clean, artist };
}

const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const version = (value: string) => /(?:\blive\b|现场)/iu.test(value) ? 'live' : /(?:remix|混音)/iu.test(value) ? 'remix' : /(?:伴奏|instrumental|karaoke)/iu.test(value) ? 'instrumental' : 'studio';

/** Only exact song names with corroborating artist or duration can be adopted. */
export function automaticLyricCandidates(candidates: LyricCandidate[], query: { title: string; artist: string; durationSeconds?: number }, artistKey: (value: string) => string = normalized): LyricCandidate[] {
  const artists = query.artist.split(/\s*[/、&]\s*/u).map(artistKey).filter(Boolean);
  return candidates.filter(row => {
    if (normalized(row.title) !== normalized(query.title) || version(row.title) !== version(query.title)) return false;
    const delta = row.durationSeconds && query.durationSeconds ? Math.abs(row.durationSeconds - query.durationSeconds) : undefined;
    // Different edits and long intros need a deliberate choice, even for the same artist.
    if (delta !== undefined && delta > 12) return false;
    const artistMatch = artists.length > 0 && artists.every(name => row.artists.some(value => value.split(/\s*[/、&]\s*/u).some(part => artistKey(part) === name)));
    return artists.length ? artistMatch : delta !== undefined && delta <= 5;
  }).sort((a, b) => Number(b.synced === true) - Number(a.synced === true) || (Math.abs((a.durationSeconds ?? query.durationSeconds ?? 0) - (query.durationSeconds ?? a.durationSeconds ?? 0)) - Math.abs((b.durationSeconds ?? query.durationSeconds ?? 0) - (query.durationSeconds ?? b.durationSeconds ?? 0))));
}
