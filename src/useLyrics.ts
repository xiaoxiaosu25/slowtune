import { preferenceStorage } from './preference-storage';
import { useEffect, useRef, useState } from 'react';
import { request, cancelled, errorText, key, type Track } from './api';
import { lyricQuery, parseLyrics } from '../server/lyrics-format';
import { desktopLyricQuery } from '../server/desktop-lyric-match';
import type { LyricCandidate, LyricDocument, LyricResolution, LyricSearch, LyricState } from '../server/lyrics-types';
import type { SongVersion } from '../server/song-library-types';
import { desktopSurface } from './song-search';
import { desktopLyricSearch } from './desktop-lyric-search';

export const lyricsDisplayStorageKey = 'slow-listening:lyrics-display:v1';
function readDisplay() {
  try {
    const value = JSON.parse(preferenceStorage().getItem(lyricsDisplayStorageKey) ?? '{}');
    return { bottom: value?.bottom !== false, translations: value?.translations !== false, focus: value?.focus === true };
  } catch { return { bottom: true, translations: true, focus: false }; }
}

/** One current-source session, shared by both lyric surfaces and the settings dialog. */
export function useLyrics(track: Track | null, duration: number | undefined, version: SongVersion | undefined, enabled: boolean) {
  const sourceKey = track ? key(track.ref) : '';
  const seed = (desktopSurface() ? desktopLyricQuery : lyricQuery)(track ? track.songId ? track.title : track.chartContext?.title ?? track.title : '', version?.kind === 'cover' ? version.performers ?? version.facts.artists : track?.songId ? track.artists : track?.chartContext?.artists ?? track?.artists);
  const versionTitle = version?.facts.title ?? track?.title ?? '';
  if ((version?.kind === 'live' || /(?:\blive\b|现场)/iu.test(versionTitle)) && !/(?:\blive\b|现场)/iu.test(seed.title)) seed.title += ' (Live)';
  if ((version?.kind === 'remix' || /(?:\bremix\b|混音)/iu.test(versionTitle)) && !/(?:\bremix\b|混音)/iu.test(seed.title)) seed.title += ' (Remix)';
  // Playback can start before the library snapshot supplies a saved version's kind and performers.
  const canAutoMatch = (!track?.versionId || !!version) && (version?.kind !== 'cover' || !!(version.performers?.length || version.facts.artists?.length));
  const durationSeconds = duration && duration > 0 ? duration : track?.durationSeconds;
  const [display, setDisplay] = useState(readDisplay);
  const [selection, setSelection] = useState<{ key: string; value: LyricState }>();
  const state = selection?.key === sourceKey ? selection.value : undefined;
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [stale, setStale] = useState(false);
  const [settings, setSettings] = useState(false), [selector, setSelector] = useState(false), [matched, setMatched] = useState(false);
  const [title, setTitle] = useState(''), [artist, setArtist] = useState(''), [text, setText] = useState(''), [offset, setOffset] = useState('0');
  const [results, setResults] = useState<LyricSearch>(), [preview, setPreview] = useState<LyricDocument>();
  const [providerFilter, setProviderFilter] = useState<'all'|'netease'|'lrclib'>('all');
  const querySeed = useRef({ sourceKey, title: seed.title.slice(0,300), artist: seed.artist.slice(0,300) });
  const autoSearch = useRef(false);
  const work = useRef<AbortController | null>(null);
  const setState = (value: LyricState) => setSelection({ key: sourceKey, value });
  const cancel = () => { work.current?.abort(); work.current = null; setBusy(''); };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== lyricsDisplayStorageKey && event.key !== null) return;
      try { if (event.storageArea === preferenceStorage()) setDisplay(readDisplay()); } catch { /* Session preferences remain usable. */ }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const updateDisplay = (value: Partial<typeof display>) => {
    const next = { ...display, ...value }; setDisplay(next);
    try { preferenceStorage().setItem(lyricsDisplayStorageKey, JSON.stringify(next)); } catch { /* Keep the session choice. */ }
  };
  async function run(kind: string, action: (signal: AbortSignal) => Promise<void>) {
    work.current?.abort(); const controller = new AbortController(); work.current = controller; setBusy(kind); setError('');
    try { await action(controller.signal); }
    catch (issue) {
      if (!controller.signal.aborted && !cancelled(issue)) {
        if ((issue as { code?: string })?.code === 'conflict') { setStale(true); setError('这个版本的歌词已被另一页面修改。请重读当前选择，再核对后保存；搜索和导入草稿已保留。'); }
        else setError((issue as { code?: string })?.code === 'not-found' ? '这份记录暂时没有可用歌词，请选择其他候选。' : errorText(issue));
      }
    } finally { if (work.current === controller) { work.current = null; setBusy(''); } }
  }
  const load = (keepDraft = false) => run('读取', async signal => {
    if (!track) return;
    const value = await request<LyricState>('/api/lyrics/state', { ref: track.ref }, signal);
    if (signal.aborted) return;
    setState(value); setStale(false); if (!keepDraft) setOffset(String(value.offsetMs / 1000));
  });
  const resolve = () => run('匹配', async signal => {
    if (!track) return;
    const saved = await request<LyricState>('/api/lyrics/state', { ref: track.ref }, signal);
    if (signal.aborted) return;
    setState(saved); setStale(false); setOffset(String(saved.offsetMs / 1000));
    if (saved.document || !canAutoMatch) return;
    const value = await request<LyricResolution>('/api/lyrics/resolve', { ref: track.ref, title: seed.title.slice(0, 300), artist: seed.artist.slice(0, 300), ...(durationSeconds ? { durationSeconds } : {}) }, signal);
    if (!signal.aborted) { setState(value.state); setOffset(String(value.state.offsetMs / 1000)); setResults(value); setMatched(value.matched); }
  });
  useEffect(() => {
    setSelection(undefined); setError(''); setStale(false); setMatched(false); setResults(undefined); setPreview(undefined);
    setTitle(seed.title.slice(0, 300)); setArtist(seed.artist.slice(0, 300)); setText(''); setOffset('0'); setSettings(false); setSelector(false); setProviderFilter('all');
    querySeed.current={sourceKey,title:seed.title.slice(0,300),artist:seed.artist.slice(0,300)};
    return () => work.current?.abort();
  }, [sourceKey]);
  useEffect(()=>{
    const previous=querySeed.current,next={sourceKey,title:seed.title.slice(0,300),artist:seed.artist.slice(0,300)};
    if(previous.sourceKey===sourceKey){setTitle(value=>value===previous.title?next.title:value);setArtist(value=>value===previous.artist?next.artist:value);}
    querySeed.current=next;
  },[sourceKey,seed.title,seed.artist]);
  // A stable duration bucket avoids restarting work for fractional media-duration updates.
  const durationKey = Math.round(durationSeconds ?? 0);
  useEffect(() => {
    if (enabled && sourceKey) { if (!state?.document) void resolve(); }
    else cancel();
    const automatic = work.current;
    return () => automatic?.abort();
  }, [sourceKey, enabled, seed.title, seed.artist, durationKey, canAutoMatch]);
  const offsetMs = Number.isFinite(Number(offset)) ? Math.round(Number(offset) * 1000) : state?.offsetMs ?? 0;
  const search = () => run('搜索', async signal => {
    // A manual lookup must recover the revision before offering a writable choice.
    if(track&&(!state||stale)){
      const value=await request<LyricState>('/api/lyrics/state',{ref:track.ref},signal);
      if(signal.aborted)return;setState(value);setStale(false);if(!state)setOffset(String(value.offsetMs/1000));
    }
    if(desktopSurface()){
      setResults(undefined);setPreview(undefined);
      await desktopLyricSearch({title,artist,...(durationSeconds?{durationSeconds}:{})},signal,value=>{if(!signal.aborted)setResults(value);});return;
    }
    const value = await request<LyricSearch>('/api/lyrics/search', { title, artist, ...(durationSeconds ? { durationSeconds } : {}) }, signal);
    if (!signal.aborted) { setResults(value); setPreview(undefined); }
  });
  useEffect(()=>{
    if(!settings||!selector){autoSearch.current=false;return;}
    if(autoSearch.current||busy||results?.candidates.length||!title.trim()||!track)return;
    autoSearch.current=true;void search();
  },[settings,selector,busy,results,sourceKey]);
  const inspect = (candidate: LyricCandidate) => run('预览', async signal => {
    const value = await request<LyricDocument>('/api/lyrics/document', { provider: candidate.provider, id: candidate.id }, signal);
    if (!signal.aborted) setPreview(value);
  });
  const accept = (keepOpen = false) => run('保存', async signal => {
    if (!preview || !state || !track) return;
    const value = await request<LyricState>('/api/lyrics/select', { ref: track.ref, revision: state.revision, candidate: { provider: preview.provider, id: preview.id } }, signal);
    if (!signal.aborted) { setState(value); setOffset('0'); setMatched(false); setSelector(false); setSettings(open => keepOpen && open); }
  });
  const importText = (keepOpen = false) => run('保存', async signal => {
    if (!state || !track) return;
    parseLyrics(text);
    const value = await request<LyricState>('/api/lyrics/import', { ref: track.ref, revision: state.revision, title: title.trim() || seed.title.slice(0, 300), text }, signal);
    if (!signal.aborted) { setState(value); setOffset('0'); setMatched(false); setSelector(false); setSettings(open => keepOpen && open); }
  });
  const saveOffset = () => run('保存', async signal => {
    if (!state || !track) return;
    const value = await request<LyricState>('/api/lyrics/offset', { ref: track.ref, revision: state.revision, offsetMs }, signal);
    if (!signal.aborted) { setState(value); setOffset(String(value.offsetMs / 1000)); }
  });
  const clear = () => run('保存', async signal => {
    if (!state || !track) return;
    const value = await request<LyricState>('/api/lyrics/select', { ref: track.ref, revision: state.revision, candidate: null }, signal);
    if (!signal.aborted) { setState(value); setOffset('0'); setMatched(false); setPreview(undefined); setSelector(false); }
  });
  const closeSettings = () => { if (busy !== '匹配' && busy !== '保存') cancel(); setSettings(false); setSelector(false); setOffset(String((state?.offsetMs ?? 0) / 1000)); };
  const openSelector = () => {
    setSelector(true); setSettings(true);
    // A failed initial read has no revision yet. Recover it before a manual save.
    if (!state || stale) void load(!!state);
  };
  return {
    sourceKey, track, state, document: state?.document, durationSeconds, offsetMs, busy, error, stale, matched,
    settings, selector, setSelector, openSelector, openSettings: () => { setSelector(false); setSettings(true); }, closeSettings,
    title, setTitle, artist, setArtist, text, setText, offset, setOffset, results, preview, setPreview, providerFilter, setProviderFilter,
    resetQuery:()=>{setTitle(seed.title.slice(0,300));setArtist(seed.artist.slice(0,300));},
    originalTitle: version?.facts.title ?? track?.sourceTitle ?? track?.title ?? '',
    bottom: display.bottom, translations: display.translations, focus: display.focus, updateDisplay,
    run, cancel, load, resolve, search, inspect, accept, importText, saveOffset, clear,
  };
}
export type LyricsController = ReturnType<typeof useLyrics>;
