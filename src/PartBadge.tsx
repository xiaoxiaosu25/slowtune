import { Button } from './ui/Button';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Track } from './api';
import { PartMetadataStore } from './multipart';
import { OPEN_DIALOG, topDialog } from './ui/layers';

export function PartBadge({ track, store, active, onOpen, current = false, viewKey = '' }: { track: Track; store: PartMetadataStore; active: boolean; onOpen: () => void; current?: boolean; viewKey?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const entry = useSyncExternalStore(store.subscribe, () => store.peek(track.ref.id));
  useEffect(() => {
    if (!active || track.ref.provider !== 'bilibili') return;
    const top = topDialog();
    if (top && element.current?.closest(OPEN_DIALOG) !== top) return;
    const controller = new AbortController();
    if (track.parts?.length) store.seed(track);
    const observer = new IntersectionObserver(records => {
      if (records.some(record => record.isIntersecting)) { observer.disconnect(); void store.read(track.ref, controller.signal, false).catch(() => {}); }
    });
    if (element.current) observer.observe(element.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [active, track.ref.provider, track.ref.id, track.ref.part, store, viewKey]);
  if (track.ref.provider !== 'bilibili') return null;
  const count = entry?.parts?.length ?? track.parts?.length ?? 0;
  const index = entry?.parts?.findIndex(part => part.ref.part === track.ref.part) ?? -1;
  return <span ref={element} className="part-badge-slot">{count > 1 && <Button variant="plain" type="button" className="part-badge" aria-label={'查看分 P · ' + track.title} onClick={onOpen}>{current && index >= 0 ? `P${index + 1} / ${count}` : `${count} 个分 P`}</Button>}</span>;
}
