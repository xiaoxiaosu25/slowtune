import type { LyricLine as RenderLine } from '@applemusic-like-lyrics/core';
import type { LyricDocument } from '../server/lyrics-types';
import { lyricWords } from './lyric-timing';

/** The renderer receives a fresh snapshot; saved lyric documents remain untouched. */
export function desktopLyricLines(document: LyricDocument, duration: number | undefined, translations: boolean): RenderLine[] {
  return document.lines.map((line, index) => {
    const startTime = Math.max(0, line.startMs ?? 0);
    const words = lyricWords(line);
    const next = document.lines[index + 1]?.startMs;
    const endTime = Math.max(startTime, words?.at(-1)?.endMs ?? 0,
      next !== null && next !== undefined && next > startTime ? next : duration && duration * 1000 > startTime ? duration * 1000 : startTime + 5000);
    return {
      startTime, endTime,
      words: words ? words.map(word => ({ word: word.text, startTime: Math.max(0, word.startMs), endTime: Math.max(0, word.endMs) })) : [{ word: line.text || '♪', startTime, endTime }],
      translatedLyric: translations ? line.translation ?? '' : '', romanLyric: '', isBG: false, isDuet: false,
    };
  });
}

export function desktopLyricTime(position: number, offsetMs: number): number {
  return Math.max(0, Math.round(position * 1000 - offsetMs));
}
