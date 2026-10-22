import { preferenceStorage } from './preference-storage';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDoubleLeftIcon, CaretDoubleRightIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';

export const pageSizes = [20, 30, 50, 100] as const;
const positions = new Map<string, number>();
const storageKey = (group: string) => 'slow-listening:pagination:v1:' + group;
function readSize(group: string) {
  try { const size = Number(preferenceStorage().getItem(storageKey(group))); return pageSizes.includes(size as typeof pageSizes[number]) ? size : 30; }
  catch { return 30; }
}

/** Positions are session-only; display preferences belong to this browser. */
export function usePagination(id: string, total: number | undefined, group = id) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  const size = sizes[group] ?? readSize(group);
  const lastPage = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
  const requested = pages[id] ?? positions.get(id) ?? 1;
  const page = Math.min(requested, lastPage ?? requested);
  useEffect(() => {
    // Do not resurrect a deleted last page when more entries are later added.
    if (lastPage !== undefined && requested > lastPage) {
      positions.set(id, page); setPages(old => ({ ...old, [id]: page }));
    }
  }, [id, page, requested, lastPage]);
  const onPage = (next: number) => {
    if (!Number.isSafeInteger(next) || next < 1) return;
    const value = Math.min(next, lastPage ?? next);
    if (positions.size >= 200 && !positions.has(id)) positions.delete(positions.keys().next().value!);
    positions.set(id, value); setPages(old => ({ ...old, [id]: value }));
  };
  const onSize = (next: number) => {
    if (!pageSizes.includes(next as typeof pageSizes[number])) return;
    try { preferenceStorage().setItem(storageKey(group), String(next)); } catch { /* This session still works without storage. */ }
    setSizes(old => ({ ...old, [group]: next })); onPage(1);
  };
  return { page, size, total, onPage, onSize, offset: (page - 1) * size };
}

interface PaginationProps {
  label: string; page: number; size: number; total?: number; busy?: boolean;
  knownPages?: number; hasNext?: boolean;
  onPage: (page: number) => void; onSize: (size: number) => void;
}
export function Pagination({ label, page, size, total, busy = false, knownPages = page, hasNext = false, onPage, onSize }: PaginationProps) {
  const last = total === undefined ? undefined : Math.max(1, Math.ceil(total / size));
  const [draft, setDraft] = useState(String(page));
  const submitted = useRef<string | undefined>(undefined);
  useEffect(() => { setDraft(String(page)); submitted.current = undefined; }, [page, size, label]);
  useEffect(() => { if (!busy) submitted.current = undefined; }, [busy]);
  const jump = () => {
    const value = draft.trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || !Number(value)) { setDraft(String(page)); return; }
    const target = Math.max(1, Math.min(Number(value), last ?? Math.max(1, knownPages)));
    const token = page + ':' + size + ':' + target;
    setDraft(String(target));
    if (target !== page && submitted.current !== token) { submitted.current = token; onPage(target); }
  };
  return <nav className="pagination" aria-label={label + '分页'} aria-busy={busy}>
    <label className="pagination-size"><span>每页</span><select className="select select-sm" aria-label={label + '每页条数'} value={size} disabled={busy} onChange={event => onSize(Number(event.target.value))}>
      {pageSizes.map(value => <option key={value} value={value}>{value} 条</option>)}
    </select></label>
    <div className="pagination-navigation">
      <div className="pagination-pair">
        <button type="button" className="btn btn-ghost btn-sm pagination-edge" title="首页" aria-label={label + '首页'} disabled={busy || page <= 1} onClick={() => onPage(1)}><CaretDoubleLeftIcon size={16}/></button>
        <button type="button" className="btn btn-secondary btn-sm pagination-step" aria-label={label + '上一页'} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><CaretLeftIcon size={16}/><span>上一页</span></button>
      </div>
      <div className="pagination-position">
        <label><span>第</span><input className="input input-sm pagination-input" aria-label={label + '页码'} title={last === undefined ? '可跳转已读取的页码；更多内容请用下一页读取' : '输入页码后按回车跳转'} type="text" inputMode="numeric" enterKeyHint="go" autoComplete="off" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} onBlur={jump} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jump(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(String(page)); } }}/></label>
        <span className="pagination-total" aria-live="polite">/ {last ?? '…'} 页</span>
      </div>
      <div className="pagination-pair">
        <button type="button" className="btn btn-secondary btn-sm pagination-step" aria-label={label + '下一页'} disabled={busy || (last === undefined ? !hasNext : page >= last)} onClick={() => onPage(page + 1)}><span>下一页</span><CaretRightIcon size={16}/></button>
        <button type="button" className="btn btn-ghost btn-sm pagination-edge" title={last === undefined ? '来源尚未提供总页数' : '尾页'} aria-label={label + '尾页'} disabled={busy || last === undefined || page >= last} onClick={() => last !== undefined && onPage(last)}><CaretDoubleRightIcon size={16}/></button>
      </div>
    </div>
  </nav>;
}

interface PagedListProps<T> {
  id: string; label: string; items: T[]; group?: string; busy?: boolean;
  cursor?: string; onLoadMore?: () => Promise<unknown>; error?: boolean;
  children: (items: T[], offset: number) => ReactNode;
}
/** Cursor sources retain loaded metadata for back navigation, but mount only one page. */
export function PagedList<T>({ id, label, items, group = id, busy = false, cursor, onLoadMore, error = false, children }: PagedListProps<T>) {
  const paging = usePagination(id, cursor ? undefined : items.length, group);
  const body = useRef<HTMLDivElement>(null), scrollPending = useRef(false), lastCursor = useRef<string | undefined>(undefined);
  const readBudget = useRef(0);
  const [target, setTarget] = useState<number>(), [fetching, setFetching] = useState(false);
  const desired = target ?? paging.page;
  const knownPages = Math.max(1, Math.ceil(items.length / paging.size));
  useEffect(() => { setTarget(undefined); lastCursor.current = undefined; readBudget.current = 0; }, [id]);
  useEffect(() => {
    // Keep an unfinished cursor page for the next read so later arrivals are not skipped.
    const available = cursor ? Math.max(1, Math.floor(items.length / paging.size)) : knownPages;
    if (error) {
      setTarget(undefined);
      if (paging.page > knownPages) paging.onPage(available);
      return;
    }
    if (busy || fetching) return;
    if (cursor && items.length < desired * paging.size && onLoadMore && lastCursor.current !== cursor && readBudget.current < Math.ceil(paging.size / 20) + 1) {
      lastCursor.current = cursor; readBudget.current++; setFetching(true);
      void onLoadMore().catch(() => setTarget(undefined)).finally(() => setFetching(false));
    } else if (target !== undefined || paging.page > knownPages) {
      // A restored position can exceed a fresh cursor buffer after bounded reads.
      paging.onPage(Math.min(desired, available)); setTarget(undefined);
    }
  }, [id, cursor, items.length, desired, paging.page, paging.size, knownPages, busy, fetching, error, target, onLoadMore]);
  useEffect(() => {
    if (!scrollPending.current || target !== undefined || busy || fetching) return;
    scrollPending.current = false;
    const element = body.current;
    if (element && element.getBoundingClientRect().top < 0) element.scrollIntoView({ block: 'start' });
  }, [paging.page, paging.size, target, busy, fetching]);
  return <div className="paged-list" ref={body}>
    {children(items.slice(paging.offset, paging.offset + paging.size), paging.offset)}
    {(items.length > 0 || cursor) && <Pagination {...paging} label={label} busy={busy || fetching || target !== undefined} knownPages={knownPages} hasNext={paging.page < knownPages || !!cursor} onPage={next => {
      scrollPending.current = true; readBudget.current = 0;
      if (cursor && next * paging.size > items.length) setTarget(next); else paging.onPage(next);
    }} onSize={size => { scrollPending.current = true; readBudget.current = 0; paging.onSize(size); }}/>}
  </div>;
}
