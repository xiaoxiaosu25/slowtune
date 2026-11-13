import { useEffect, useMemo, useRef, useState } from 'react';
import { cancelled, errorText, request } from '../api';
import type { SongLibraryState as LibraryData } from '../../server/song-library-types';
import { desktopCatalogLibrary } from '../../server/song-catalog-display';
import type { StartupPreload } from '../startup';

/**
 * 歌单与收藏资料：读取、轮询更新和写入锁。
 * 写入进行中（`writeWork`）时暂停读取；读取用序号丢弃过期结果。
 * 桌面端展示经过目录整理的资料，移动端使用原始资料。
 */
export function useLibraryData(preload: StartupPreload, desktop: boolean, resetKey: unknown) {
  const [rawLibrary, setLib] = useState<LibraryData | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const lib = useMemo(() => rawLibrary && desktop ? desktopCatalogLibrary(rawLibrary) : rawLibrary, [rawLibrary, desktop]);
  const libraryReadSerial = useRef(0);
  const libraryState = useRef<LibraryData | null>(null);
  const libraryReading = useRef(false);
  const writeWork = useRef<AbortController | null>(null);

  const updateLibrary = (data: LibraryData) => {
    ++libraryReadSerial.current;
    libraryState.current = data;
    setLib(old => old?.revision === data.revision ? old : data);
    setLibraryError('');
  };

  const readLibrary = async (signal?: AbortSignal, checkRevision = false) => {
    if (writeWork.current || libraryReading.current) return;
    libraryReading.current = true;
    const sequence = ++libraryReadSerial.current, readSignal = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    const current = () => !readSignal.aborted && !writeWork.current && sequence === libraryReadSerial.current;
    try {
      if (checkRevision && libraryState.current) {
        const state = await request<{ revision: string | null }>('/api/song-library/events', undefined, readSignal);
        if (!current()) return;
        if (state.revision === libraryState.current.revision) { setLibraryError(''); return; }
      }
      const data = await preload.take<LibraryData>('/api/song-library', readSignal);
      if (current()) updateLibrary(data);
    } catch (issue) {
      if (!signal?.aborted && sequence === libraryReadSerial.current && !cancelled(issue)) setLibraryError(errorText(issue));
    } finally {
      libraryReading.current = false;
    }
  };

  // 页面可见时每 5 秒检查一次版本，有变化才重新读取整份资料。
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { if (document.visibilityState === 'visible') void readLibrary(controller.signal, true); };
    const timer = setInterval(() => void refresh(), 5000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [resetKey]);

  return { rawLibrary, lib, libraryError, libraryReadSerial, writeWork, updateLibrary, readLibrary };
}
