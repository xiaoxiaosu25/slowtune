import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { MobileSearchPage } from './MobileSearchPage';

export function SearchSurface({ desktop, title, query, onQuery, onSearch, onClose, autoFocus, children }: {
  desktop: boolean; title: string; query: string; onQuery: (query: string) => void; onSearch: () => void; onClose: () => void; autoFocus: boolean; children: ReactNode;
}) {
  return desktop ? <Modal title={title} className="search-modal" onClose={onClose}>{children}</Modal> : <MobileSearchPage query={query} onQuery={onQuery} onSearch={onSearch} onBack={onClose} autoFocus={autoFocus}>{children}</MobileSearchPage>;
}
