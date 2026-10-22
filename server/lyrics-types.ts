export type LyricProvider = 'netease' | 'lrclib';
export interface LyricCandidate {
  provider: LyricProvider | 'local';
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationSeconds?: number;
  synced?: boolean;
  instrumental?: boolean;
}
export interface LyricLine {
  startMs: number | null;
  text: string;
  translation?: string;
  words?: { startMs: number; endMs: number; text: string }[];
}
export interface LyricDocument extends LyricCandidate {
  lines: LyricLine[];
}
export interface LyricState {
  revision: string | null;
  offsetMs: number;
  document: LyricDocument | null;
}
export interface LyricSearch {
  candidates: LyricCandidate[];
  issues: { provider: LyricProvider; code: string }[];
}
export interface LyricResolution extends LyricSearch {
  state: LyricState;
  matched: boolean;
}
export const lyricTextBytes = 128 * 1024;
export class LyricsError extends Error {
  constructor(readonly code: string, readonly currentRevision?: string | null) { super(code); }
}
