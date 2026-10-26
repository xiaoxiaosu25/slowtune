import { useState, type ReactNode } from 'react';
import { ArrowClockwiseIcon, DotsThreeIcon, ListBulletsIcon, PlayIcon, PlusIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';
import { discoverySize, type CatalogView } from './CatalogView';
import type { DiscoveryShelfProps } from './DiscoveryShelf';
import type { Track } from './api';

export function MobileDiscoveryShelf({ shelf, loading, renderCovers, renderList, renderError, onPlayAll, onRefresh, onImport, info, status, controls, empty, feedback, headingId, view, onView, shown, expanded, onExpanded }: DiscoveryShelfProps & { headingId: string; view: CatalogView; onView: (view: CatalogView) => void; shown: Track[]; expanded: boolean; onExpanded: (expanded: boolean) => void; feedback?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const items = (shelf.page?.items ?? []).slice(0, discoverySize);
  const title = shelf.id === 'account-recommendation' ? '为你推荐' : shelf.id === 'youtube-music-selection' ? 'YouTube 精选' : shelf.id === 'follow-updates' ? '关注更新' : shelf.title;
  const run = (action: () => void) => { setMenu(false); action(); };
  return <section className="catalog discovery-shelf mobile-discovery-shelf" aria-labelledby={headingId} data-shelf-id={shelf.id} data-shelf-kind={shelf.kind}>
    <div className="mobile-shelf-heading"><h2 id={headingId}>{title}</h2><button className="btn btn-icon mobile-shelf-play" aria-label={'播放全部 ' + shelf.title} title={'播放全部 ' + items.length + ' 首'} disabled={!items.length} onClick={() => onPlayAll(items)}><PlayIcon size={21} weight="fill"/></button>{onRefresh && <button className="btn btn-icon" aria-label={shelf.id === 'follow-updates' ? '刷新更新' : '换一批音乐'} title={shelf.id === 'follow-updates' ? '刷新更新' : '换一批音乐'} disabled={loading} onClick={onRefresh}><ArrowClockwiseIcon size={22}/></button>}<button className="btn btn-icon" aria-label={shelf.title + '栏目操作'} aria-expanded={menu} onClick={() => setMenu(true)}><DotsThreeIcon size={25}/></button></div>
    {loading && <p className="mobile-shelf-loading" role="status">{items.length ? '正在更新推荐…' : '正在寻找音乐…'}</p>}
    {feedback}
    {shelf.error ? renderError(shelf.error) : items.length ? <>{view === 'covers' ? <div className="mobile-shelf-covers" role="group" aria-label={shelf.title}>{renderCovers(shown,shelf.id==='follow-updates')}</div> : renderList(shown)}{items.length > 4 && <button className="btn btn-ghost mobile-shelf-expand" aria-expanded={expanded} onClick={() => onExpanded(!expanded)}>{expanded ? '收起' : `查看全部 ${items.length} 首`}</button>}</> : !loading && (empty ?? <p className="muted">暂时没有可展示的音乐。</p>)}
    {menu && <Modal title={shelf.title + '栏目操作'} className="mobile-actions-sheet" onClose={() => setMenu(false)}><div className="mobile-action-list">
      {onImport && <button disabled={!items.length} onClick={() => run(() => onImport(items, shelf.title))}><PlusIcon size={23}/><span>加入歌单</span></button>}
      <button aria-pressed={view === 'covers'} onClick={() => run(() => onView('covers'))}><SquaresFourIcon size={23}/><span>封面浏览</span></button>
      <button aria-pressed={view === 'list'} onClick={() => run(() => onView('list'))}><ListBulletsIcon size={23}/><span>歌曲列表</span></button>
    </div>{controls && <div className="mobile-shelf-options">{controls}</div>}<div className="mobile-shelf-info">{info}{status}</div></Modal>}
  </section>;
}
