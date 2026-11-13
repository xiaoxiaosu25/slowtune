import { Button } from './ui/Button';
import { preferenceStorage } from './preference-storage';
import { useEffect, useState } from 'react';
import { ListBulletsIcon, SquaresFourIcon } from '@phosphor-icons/react';

export type CatalogView = 'covers' | 'list';
export const discoverySize = 12;
export function useCatalogView(id: string, fallback: CatalogView) {
  const storageKey = 'slow-listening:discovery:v1:' + encodeURIComponent(id);
  const read = () => {
    try { const value = JSON.parse(preferenceStorage().getItem(storageKey) ?? 'null'); return value?.view === 'covers' || value?.view === 'list' ? value.view as CatalogView : fallback; }
    catch { return fallback; }
  };
  const [view, setView] = useState<CatalogView>(read), [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    try { preferenceStorage().setItem(storageKey, JSON.stringify({view})); setSaveFailed(false); }
    catch { setSaveFailed(true); }
  }, [storageKey, view]);
  return {view, setView, saveFailed};
}
export function CatalogViewToggle({title, view, onChange}: {title: string; view: CatalogView; onChange: (view: CatalogView) => void}) {
  return <div className="segmented catalog-view" role="group" aria-label={title + '视图'}>
    <Button variant="plain" className={view === 'covers' ? 'selected' : ''} aria-label={title + '封面视图'} title="封面" aria-pressed={view === 'covers'} onClick={() => onChange('covers')}><SquaresFourIcon size={16}/></Button>
    <Button variant="plain" className={view === 'list' ? 'selected' : ''} aria-label={title + '列表视图'} title="列表" aria-pressed={view === 'list'} onClick={() => onChange('list')}><ListBulletsIcon size={16}/></Button>
  </div>;
}
