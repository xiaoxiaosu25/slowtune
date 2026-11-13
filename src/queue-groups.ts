import type { Track } from './api';
import type { QueueTrack } from './chart-playback';

/** Only an explicit parts action creates a group; a shared BV never merges occurrences. */
export function groupPartTracks(parts: Track[], title: string, newId: () => string): Track[] {
  const first = parts[0];
  if (parts.length < 2 || !first || first.ref.provider !== 'bilibili' || parts.some(part => part.ref.provider !== 'bilibili' || part.ref.id !== first.ref.id || !part.ref.part)) return parts;
  const partsGroupId = newId();
  return parts.map(part => ({ ...part, partsGroupId, partsGroupTitle: title }));
}

export type QueueDisplayRow =
  | { kind: 'track'; key: string; track: QueueTrack; grouped: boolean }
  | { kind: 'group'; key: string; groupId: string; title: string; tracks: QueueTrack[] };

/** Collapse consecutive members only: priority insertions and manual ordering stay visible. */
export function queueDisplayRows(items: QueueTrack[], expanded: ReadonlySet<string>): QueueDisplayRow[] {
  const rows: QueueDisplayRow[] = [];
  for (let at = 0; at < items.length;) {
    const first = items[at], groupId = first.partsGroupId;
    let end = at + 1;
    if (groupId) while (end < items.length && items[end].partsGroupId === groupId) end++;
    const tracks = items.slice(at, end), grouped = !!groupId && tracks.length > 1;
    if (grouped) rows.push({ kind: 'group', key: 'group:' + groupId + ':' + first.resourceId, groupId, title: first.partsGroupTitle || '视频分曲', tracks });
    if (!grouped || expanded.has(groupId!)) rows.push(...tracks.map(track => ({ kind: 'track' as const, key: track.resourceId, track, grouped })));
    at = end;
  }
  return rows;
}
