import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import { request, type ServerStatus } from '../api';
import { isTrack, type QueueTrack } from '../chart-playback';
import { refreshSourceCapabilities, type SourceSettingsState } from '../source-settings';

/**
 * 来源设置：YouTube 是否启用、是否可用、关闭后的展示方式。
 * 新设置先经过序号校验；首次可用时要等能力检查通过后才对外生效。
 */
export function useSourceSettings(client: MusicClient, status: ServerStatus | undefined, setStatus: Dispatch<SetStateAction<ServerStatus | undefined>>) {
  const [sources, setSources] = useState<SourceSettingsState>();
  const sourceStateRef = useRef<SourceSettingsState | undefined>(undefined);
  const capabilityReady = useRef(false);
  const youtubeEnabled = sources?.youtube.enabled ?? status?.providers.youtube.enabled ?? status?.providers.youtube.available ?? false;
  const youtubeAvailable = sources?.youtube.available ?? status?.providers.youtube.available ?? false;
  const youtubeDisplay = sources?.youtube.disabledDisplay ?? 'dim';
  const sourceBlocked = (track: QueueTrack) => !youtubeEnabled && isTrack(track) && track.ref.provider === 'youtube';
  const sourceVisible = (track: QueueTrack) => youtubeDisplay !== 'hide' || !sourceBlocked(track);

  const sourcesChanged = (value: SourceSettingsState) => {
    if (!value || typeof value.revision !== 'string' || typeof value.youtube?.enabled !== 'boolean' || typeof value.youtube.available !== 'boolean') return;
    if ((value.sequence ?? 0) < (sourceStateRef.current?.sequence ?? 0)) return;
    sourceStateRef.current = value;
    const show = (state: SourceSettingsState) => {
      setSources(state);
      setStatus(old => old ? { ...old, providers: { ...old.providers, youtube: state.youtube } } : old);
    };
    const apply = () => { if (sourceStateRef.current === value) show(value); };
    if (value.youtube.available && !capabilityReady.current) {
      show({ ...value, youtube: { ...value.youtube, available: false, checking: true } });
      void refreshSourceCapabilities(client).then(() => {
        if (!sourceStateRef.current?.youtube.available) return;
        capabilityReady.current = true;
        apply();
      }).catch(() => {
        if (sourceStateRef.current === value) show({ ...value, youtube: { ...value.youtube, available: false, checking: false, issue: '无法更新来源能力，请重新检查服务。' } });
      });
    } else {
      if (!value.youtube.available) capabilityReady.current = false;
      apply();
    }
  };

  useEffect(() => {
    const events = new EventSource('/api/settings/sources/events');
    const read = () => {
      void request<SourceSettingsState>('/api/settings/sources')
        .then(sourcesChanged)
        .catch(() => {});
    };
    events.addEventListener('sources', (event) => {
      try {
        sourcesChanged(JSON.parse((event as MessageEvent).data));
      } catch {}
    });
    events.addEventListener('open', read);
    const visible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      events.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [client]);

  return { sources, sourceStateRef, youtubeEnabled, youtubeAvailable, youtubeDisplay, sourceBlocked, sourceVisible, sourcesChanged };
}
