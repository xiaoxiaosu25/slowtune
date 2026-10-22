import type { ChartItem } from '../server/chart-types';
import type { Track } from './api';
import type { SongPlaybackSelection, SongSavedPlayback } from '../server/song-library-types';
import { catalogSongKey, validateSongSourceSelection } from '../server/song-library-policy';

export interface PendingChartTrack {
  kind: 'chart';
  chartItem: ChartItem;
  resourceId: string;
  title: string;
  artists?: string[];
  artwork?: string;
  durationSeconds?: undefined;
  uploader?: undefined;
  selection?: SongPlaybackSelection;
  partsGroupId?: string;
}
export interface PendingSongTrack { kind: 'song'; selection: SongPlaybackSelection; resourceId: string; title: string; artists?: string[]; artwork?: string; durationSeconds?: undefined; uploader?: undefined; chartItem?: undefined; partsGroupId?: string }
export type QueueTrack = (Track & {chartItem?: ChartItem}) | PendingChartTrack | PendingSongTrack;
export const isTrack = (entry: QueueTrack): entry is Track & {chartItem?: ChartItem} => 'ref' in entry;
export const pendingChartTrack = (item: ChartItem, id: string): PendingChartTrack => ({kind:'chart',chartItem:{...item},resourceId:id,title:item.title,artists:item.artists,artwork:item.artwork});

export const playbackStorageKey = 'slow-listening:playback:v3';
export interface SavedPlayback {tracks:QueueTrack[];current?:string;order:'sequential'|'shuffle';repeat:'off'|'one'|'all';volume:number;rate:number;muted:boolean}
function validSelection(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'source') { validateSongSourceSelection(value.ref); if(value.context)catalogSongKey(value.context); return true; }
  if (value.kind === 'song') return typeof value.songId === 'string' && !!value.songId && [value.pinnedVersionId, value.explicitVersionId].every(id => id === undefined || typeof id === 'string' && !!id);
  if (value.kind === 'chart') { catalogSongKey(value.context); return true; }
  return value.kind === 'query' && typeof value.query?.title === 'string' && !!value.query.title.trim() && (value.query.artists === undefined || Array.isArray(value.query.artists) && value.query.artists.every((artist: unknown) => typeof artist === 'string'));
}
export function readSavedPlayback(storage: Pick<Storage,'getItem'>): SavedPlayback {
  try {
    const s = JSON.parse(storage.getItem(playbackStorageKey) ?? 'null');
    if (s?.version === 3 && Array.isArray(s.items) && s.items.length <= 500 && s.items.every((item: any) => typeof item.instanceId === 'string' && !!item.instanceId && typeof item.title === 'string' && validSelection(item.selection) && (item.artists === undefined || Array.isArray(item.artists) && item.artists.every((artist: unknown) => typeof artist === 'string'))) && new Set(s.items.map((item: any) => item.instanceId)).size === s.items.length && ['sequential','shuffle'].includes(s.order) && ['off','one','all'].includes(s.repeat)) {
      const tracks: QueueTrack[] = s.items.map((item: SongSavedPlayback['items'][number]) => {
        if(item.selection.kind==='chart')return {...pendingChartTrack({rank:item.selection.context.rank??1,title:item.title,artists:item.artists},item.instanceId),selection:item.selection};
        if(item.selection.kind==='source')return {ref:item.selection.ref,resourceId:item.instanceId,title:item.title,artists:item.artists,selection:item.selection,url:item.selection.ref.provider==='bilibili'?`https://www.bilibili.com/video/${item.selection.ref.id}`:`https://www.youtube.com/watch?v=${item.selection.ref.id}`,partsGroupId:item.partsGroupId};
        return {kind:'song',selection:item.selection,resourceId:item.instanceId,title:item.title,artists:item.artists,partsGroupId:item.partsGroupId};
      });
      return { tracks, current: tracks.some(track => track.resourceId === s.current) ? s.current : undefined, order: s.order, repeat: s.order === 'shuffle' ? 'off' : s.repeat, volume: Number.isFinite(s.volume) && s.volume >= 0 && s.volume <= 1 ? s.volume : .5, rate: Number.isFinite(s.rate) && s.rate >= .25 && s.rate <= 4 ? s.rate : 1, muted: s.muted === true };
    }
  } catch { /* Invalid new records are ignored; earlier queue formats are never read. */ }
  return {tracks:[],order:'sequential',repeat:'off',volume:.5,rate:1,muted:false};
}
export function savedQueueEntry(entry: QueueTrack): SongSavedPlayback['items'][number] {
  let selection: SongPlaybackSelection = entry.selection ?? (isTrack(entry) ? { kind: 'source', ref: entry.ref as any, ...(entry.songId ? { songId: entry.songId } : {}), ...(entry.chartContext?{context:entry.chartContext}:{}) } : { kind: 'query', query: { title: entry.title, artists: entry.artists } });
  if(selection.kind==='source'&&isTrack(entry))selection={...selection,ref:entry.ref as any,...(!selection.songId&&entry.songId?{songId:entry.songId}:{})};
  return { instanceId: entry.resourceId, selection, title: entry.title, ...(entry.artists ? { artists: entry.artists } : {}), ...(typeof entry.partsGroupId === 'string' ? { partsGroupId: entry.partsGroupId } : {}) };
}
export function fatalChartError(error: unknown): boolean {
  const e = error as {code?:string;name?:string;upstreamCode?:string;cause?:unknown};
  return ['authentication','rate-limited','network','busy','stopping','version-mismatch'].includes(e?.code??'') || e?.code==='upstream' && (!e.upstreamCode || /^5\d{2}$/.test(e.upstreamCode)) || e?.name==='NotAllowedError' || !!(e?.cause && e.cause!==error && fatalChartError(e.cause));
}
