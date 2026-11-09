import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';

export function VirtualRows<T>({ items, scrollRef, itemKey, estimate, activeKey, gap = 0, children }: {
  items: T[];
  scrollRef: RefObject<HTMLDivElement | null>;
  itemKey: (item: T) => string;
  estimate: number;
  activeKey?: string;
  gap?: number;
  children: (item: T, index: number) => ReactNode;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  const [focusKey, setFocusKey] = useState<string>();
  const enabled = items.length > 50;
  const active = activeKey === undefined ? -1 : items.findIndex(item => itemKey(item) === activeKey);
  const focused = focusKey === undefined ? -1 : items.findIndex(item => itemKey(item) === focusKey);
  const virtualizer = useVirtualizer({
    count: items.length,
    enabled,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => itemKey(items[index]),
    estimateSize: () => estimate,
    overscan: 6,
    gap,
    scrollMargin: margin,
    rangeExtractor: range => {
      const indices = defaultRangeExtractor(range);
      if (focused >= 0 && !indices.includes(focused)) return [...indices, focused].sort((a, b) => a - b);
      return indices;
    },
  });
  useLayoutEffect(() => {
    const scroll = scrollRef.current, element = host;
    if (!enabled || !scroll || !element) return;
    const measure = () => setMargin(element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(scroll);
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) observer.observe(sibling);
    return () => observer.disconnect();
  }, [enabled, host, scrollRef]);
  useLayoutEffect(() => {
    if (enabled && active >= 0) virtualizer.scrollToIndex(active, { align: 'auto' });
  }, [active, enabled, items.length, margin, virtualizer]);

  if (!enabled) return <>{items.map(children)}</>;
  return (
    <div ref={setHost} className="virtual-rows" style={{ height: virtualizer.getTotalSize() }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusKey(undefined);
      }}>
      {virtualizer.getVirtualItems().map(row => (
        <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
          className="virtual-row" style={{ top: row.start - margin }}
          onFocusCapture={() => setFocusKey(itemKey(items[row.index]))}>
          {children(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}
