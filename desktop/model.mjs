export const defaultPreferences = Object.freeze({ visible: true, locked: false, fontSize: 32, color: '#ffffff', highlight: '#f4cd87', lines: 2, translations: true });

export function restoreLyricsPreferences(saved = {}) {
  const value = preferences(saved.lyrics);
  // Enable once for existing installations, then respect an explicit close.
  if (saved.lyricsDefaultsVersion !== 1) value.visible = true;
  return value;
}

export function windowAppearance(input) {
  if (!input || !['light', 'dark'].includes(input.theme) || !['standard', 'welcome', 'welcome-artwork', 'immersive'].includes(input.mode)) return null;
  return { theme: input.theme, mode: input.mode };
}

// Only these values cross the native boundary. No file paths, URLs or channel names
// supplied by a renderer are used as native operations.
export function preferences(input = {}, previous = defaultPreferences) {
  if (!input || typeof input !== 'object') input = {};
  const value = { ...previous };
  for (const key of ['visible', 'locked', 'translations']) if (typeof input[key] === 'boolean') value[key] = input[key];
  if (Number.isInteger(input.fontSize)) value.fontSize = Math.max(18, Math.min(64, input.fontSize));
  if (input.lines === 1 || input.lines === 2) value.lines = input.lines;
  for (const key of ['color', 'highlight']) if (typeof input[key] === 'string' && /^#[\da-f]{6}$/i.test(input[key])) value[key] = input[key];
  return value;
}

export function fitBounds(saved, workArea, minimum, fallback) {
  const size = (key, min) => Math.min(workArea[key], Math.max(min, Number.isFinite(saved?.[key]) ? Math.round(saved[key]) : fallback[key]));
  const width = size('width', minimum.width), height = size('height', minimum.height);
  const x = Number.isFinite(saved?.x) ? saved.x : workArea.x + (workArea.width - width) / 2;
  const y = Number.isFinite(saved?.y) ? saved.y : workArea.y + workArea.height - height - 60;
  return { width, height, x: Math.round(Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, x))), y: Math.round(Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, y))) };
}

const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function lyricDocument(input) {
  if (!input || typeof input.sourceKey !== 'string' || input.sourceKey.length > 500 || !Array.isArray(input.lines) || input.lines.length > 5000) return null;
  let characters = 0;
  const lines = [];
  for (const line of input.lines) {
    if (!line || typeof line.text !== 'string' || line.text.length > 16000 || line.startMs !== null && (!finite(line.startMs) || line.startMs < 0)) return null;
    characters += line.text.length + (typeof line.translation === 'string' ? line.translation.length : 0);
    if (characters > 262144) return null;
    const words = Array.isArray(line.words) && line.words.length <= 2000 && line.words.every((word, index) => word && typeof word.text === 'string' && word.text.length <= 16000 && finite(word.startMs) && finite(word.endMs) && word.startMs >= 0 && word.endMs > word.startMs && (index === 0 || word.startMs >= line.words[index - 1].startMs)) && line.words.map(word => word.text).join('') === line.text ? line.words.map(word => ({ text: word.text, startMs: word.startMs, endMs: word.endMs })) : undefined;
    lines.push({ text: line.text, startMs: line.startMs, ...(line.translation ? { translation: text(line.translation, 16000) } : {}), ...(words ? { words } : {}) });
  }
  if (!finite(input.offsetMs) || Math.abs(input.offsetMs) > 86400000) return null;
  return { sourceKey: input.sourceKey, title: text(input.title, 500), status: text(input.status, 200), synced: input.synced === true, instrumental: input.instrumental === true, offsetMs: input.offsetMs,...(finite(input.durationMs)&&input.durationMs>0&&input.durationMs<=1e12?{durationMs:input.durationMs}:{}), lines };
}

export function lyricClock(input) {
  if (!input || typeof input.sourceKey !== 'string' || input.sourceKey.length > 500 || !finite(input.position) || input.position < 0 || input.position > 1e9 || typeof input.playing !== 'boolean') return null;
  return { sourceKey: input.sourceKey, position: input.position, playing: input.playing };
}

export function hasDisplayableLyrics(document) {
  return !!document && !document.instrumental && document.lines.some(line => line.text.trim().length > 0);
}

export function currentLines(document, clock) {
  if (!document || document.sourceKey !== clock?.sourceKey) return { index: -1, time: 0 };
  const time = clock.position * 1000 - document.offsetMs;
  if (!document.synced) return { index: -1, time };
  // Upper-bound search also handles seeks backwards and multiple lines at a time.
  let low = 0, high = document.lines.length;
  while (low < high) { const middle = (low + high) >>> 1; if ((document.lines[middle].startMs ?? Infinity) <= time) low = middle + 1; else high = middle; }
  return { index: low - 1, time };
}

export const playbackCommands = new Set(['toggle', 'previous', 'next']);
