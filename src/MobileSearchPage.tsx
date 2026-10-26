import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeftIcon, LinkIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';

export function MobileSearchPage({ query, onQuery, onSearch, onBack, onLink, autoFocus, children }: {
  query: string; onQuery: (query: string) => void; onSearch: () => void; onBack: () => void; onLink: () => void; autoFocus: boolean; children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open],:popover-open')) { event.preventDefault(); onBack(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [onBack]);
  return <main className="mobile-search-page" aria-label="搜索音乐">
    <header className="mobile-search-header"><button className="btn btn-icon" aria-label="关闭搜索" onClick={onBack}><ArrowLeftIcon size={24}/></button><form role="search" onSubmit={event => { event.preventDefault(); input.current?.blur(); onSearch(); }}><MagnifyingGlassIcon size={21}/><input ref={input} aria-label="搜索关键词" type="search" enterKeyHint="search" autoComplete="off" placeholder="歌曲、歌手或视频" value={query} onChange={event => onQuery(event.target.value)}/>{query && <button type="button" aria-label="清空搜索关键词" onClick={() => { onQuery(''); input.current?.focus(); }}><XIcon size={18}/></button>}<button type="submit" aria-label="搜索">搜索</button></form></header>
    <div className="mobile-search-tools"><button className="btn btn-ghost" onClick={onLink}><LinkIcon size={20}/>粘贴链接</button></div>
    <div className="mobile-search-content">{children}</div>
  </main>;
}
