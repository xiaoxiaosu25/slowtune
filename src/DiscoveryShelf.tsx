import { useEffect, useId, useState, type ReactNode } from 'react';
import { PlayAllButton, RefreshButton, AddToPlaylistButton } from './ListActions';
import type { Shelf } from '@studio/music-sources';
import type { Track } from './api';
import { request } from './api';
import { InfoPopover } from './InfoPopover';
import type { RecommendedShelf } from '../server/recommendation';
import { CatalogViewToggle, discoverySize, useCatalogView } from './CatalogView';
import { MobileDiscoveryShelf } from './MobileDiscoveryShelf';
export interface DiscoveryShelfProps {
  shelf: Shelf; loading: boolean;
  renderCovers: (items: Track[], timestamps?: boolean, slots?: number) => ReactNode; renderList: (items: Track[]) => ReactNode;
  renderError: (error: unknown) => ReactNode; onPlayAll: (items:Track[]) => void; onRefresh?: () => void;
  displayActive?: boolean; info?: ReactNode; status?: ReactNode; controls?: ReactNode; empty?: ReactNode;
  onImport?:(items:Track[],title?:string)=>void;
  mobile?: boolean; feedback?: ReactNode;
}
export function DiscoveryShelf(props:DiscoveryShelfProps) {
  return <DiscoveryShelfContent key={String(!!props.mobile)+props.shelf.id} {...props}/>;
}
function DiscoveryShelfContent(props:DiscoveryShelfProps) {
  const {shelf,loading,renderCovers,renderList,renderError,onPlayAll,onRefresh,onImport,displayActive=true,info,status,controls,empty,mobile=false}=props;
  const headingId=useId(),{view,setView,saveFailed}=useCatalogView((mobile?'mobile:':'')+shelf.id,shelf.kind==='recommendation'?'covers':'list');
  const [expanded,setExpanded]=useState(false);
  const items=shelf.page?.items??[],visibleItems=items.slice(0,mobile&&!expanded?4:discoverySize),recommendation=(shelf as RecommendedShelf).recommendation;
  const fixed=shelf.kind==='recommendation';
  const visibleIds=JSON.stringify(visibleItems.map(t=>JSON.stringify([t.ref.provider,t.ref.id,null])));
  useEffect(()=>{
    if(!recommendation?.token||loading||shelf.error||!displayActive||!visibleItems.length)return;
    const c=new AbortController(),confirm=()=>{if(document.visibilityState==='visible')void request('/api/recommendation/confirm',{column:shelf.id,token:recommendation.token,ids:JSON.parse(visibleIds)},c.signal).catch(()=>{});};
    confirm();document.addEventListener('visibilitychange',confirm);
    return()=>{document.removeEventListener('visibilitychange',confirm);c.abort();};
  },[shelf.id,recommendation?.token,loading,shelf.error,visibleIds,displayActive]);
  const order=recommendation?`${recommendation.entry===0?'旧版入口':recommendation.processed?'筛选／去重／排序后的结果':'来源原顺序'}`:'';
  const refreshTitle=shelf.id==='follow-updates'?'刷新':'换一批';
  if(mobile)return <MobileDiscoveryShelf {...props} shown={visibleItems} expanded={expanded} onExpanded={setExpanded} headingId={headingId} view={view} onView={setView} feedback={<>{props.feedback}{saveFailed&&<p className="muted" role="status">当前浏览器无法保存显示设置。</p>}</>}/>;
  return <section className="catalog discovery-shelf" aria-labelledby={headingId} data-shelf-id={shelf.id} data-shelf-kind={shelf.kind}>
    <div className="section-heading">
      <div className="catalog-title"><h2 id={headingId}>{shelf.title}</h2>{shelf.page&&<span className="catalog-count" aria-live="polite">{visibleItems.length} 首</span>}{(info||recommendation)&&<InfoPopover label={shelf.title+'栏目说明'}>{info}{recommendation&&<p>本批候选 {recommendation.pool} 首，按当前规则最多展示 {discoverySize} 首。</p>}</InfoPopover>}</div>
      <div className="catalog-display-controls">
        <CatalogViewToggle title={shelf.title} view={view} onChange={setView}/>
        <div className="toolbar catalog-actions"><PlayAllButton compact className="catalog-play" count={visibleItems.length} onClick={()=>onPlayAll(visibleItems)}/>{onImport&&<AddToPlaylistButton compact count={visibleItems.length} onClick={()=>onImport(visibleItems,shelf.title)}/>} {onRefresh&&<RefreshButton compact iconOnly className="shelf-refresh" busy={loading} label={refreshTitle} aria-label={shelf.title+refreshTitle} busyLabel="获取中…" onClick={onRefresh}/>}</div>
      </div>
    </div>
    {controls&&<div className="catalog-tools"><div className="toolbar catalog-filters"><div className="catalog-source-controls">{controls}</div></div></div>}
    {(order||status)&&<div className="catalog-meta"><div className={'muted catalog-status'+(order?' recommendation-order':'')} role="status">{order&&<span>{order}</span>}{status}</div></div>}
    {saveFailed&&<p className="muted catalog-status" role="status">当前浏览器无法保存显示设置。</p>}
    {fixed&&shelf.page&&visibleItems.length<discoverySize&&!loading&&<p className="muted catalog-status" role="status">符合当前规则的可用歌曲只有 {visibleItems.length} 首，已保留 {discoverySize} 个位置。可换一批或调整个人设置。</p>}
    {shelf.error?renderError(shelf.error):items.length||fixed&&shelf.page?view==='covers'?renderCovers(visibleItems,shelf.id==='follow-updates',fixed?discoverySize:undefined):<>{visibleItems.length?renderList(visibleItems):null}{fixed&&Array.from({length:discoverySize-visibleItems.length},(_,i)=><div className="catalog-empty-row" key={i} aria-hidden="true">暂无符合规则的歌曲</div>)}</>:!loading&&(empty??<p className="muted">栏目暂没有内容。</p>)}
  </section>;
}
