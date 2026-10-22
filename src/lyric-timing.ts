import type { LyricLine } from '../server/lyrics-types';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function lyricWords(line: LyricLine) {
  const words = line.words;
  return words?.length && words.map(word => word.text).join('') === line.text && words.every((word, index) => Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs && (index === 0 || word.startMs >= words[index - 1].startMs)) ? words : undefined;
}

/** All times are media milliseconds with the saved display offset already subtracted. */
export function lyricFill(lines: LyricLine[], index: number, positionMs: number, durationMs?: number, wordIndex?: number): number {
  const line = lines[index];
  if (!line || line.startMs === null || !Number.isFinite(positionMs)) return 0;
  const word = wordIndex === undefined ? undefined : lyricWords(line)?.[wordIndex];
  if (word) return clamp((positionMs - word.startMs) / (word.endMs - word.startMs));
  const next = lines[index + 1]?.startMs;
  const end = next !== null && next !== undefined && next > line.startMs ? next : durationMs && durationMs > line.startMs ? durationMs : line.startMs + 5000;
  return clamp((positionMs - line.startMs) / (end - line.startMs));
}
