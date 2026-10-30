import type { LyricDocument, LyricSearch } from '@studio/lyrics';
export { LyricsError, lyricTextBytes, type LyricProvider, type LyricCandidate, type LyricLine, type LyricDocument, type LyricSearch } from '@studio/lyrics';
export interface LyricState { revision: string | null; offsetMs: number; document: LyricDocument | null }
export interface LyricResolution extends LyricSearch { state: LyricState; matched: boolean }
