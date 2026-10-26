import { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlassIcon, MusicNotesIcon, PlayIcon, RecordIcon, WaveformIcon, TelevisionSimpleIcon, MusicNoteIcon, HeartIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import type { ChartSongContext } from '../server/song-library-types';
import { catalogSongKey } from '../server/song-library-policy';
import { request, cancelled, errorText } from './api';
import type { ChartItem, ChartKind, ChartSource, MusicChart } from '../server/chart-types';
import { artworkUrl } from '../server/artwork-url';
import { cachedChart, cacheChart } from './chart-cache';
import { PlayAllButton } from './ListActions';
import { PagedList } from './Pagination';

const sources: Record<ChartSource,string> = {netease:'网易云',qq:'QQ',bilibili:'B站',apple:'Apple Music'};
const sourceIcons = { netease: RecordIcon, qq: WaveformIcon, bilibili: TelevisionSimpleIcon, apple: MusicNoteIcon };
const date = (value:number) => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Hong_Kong',hour12:false});
let lastChartView: {source:ChartSource;kind:string;period:string} = {source:'netease',kind:'hot',period:'latest'};
function ChartCover({item}:{item:ChartItem}) {
  const url=artworkUrl(item.artwork),[failed,setFailed]=useState('');
  return url&&failed!==url?<img className="chart-cover" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:<span className="chart-cover unknown-cover" aria-label="封面未知"><MusicNotesIcon size={22}/></span>;
}
type ChartFavoriteState = { saved: ReadonlySet<string>; busy?: string; disabled: boolean };
function ChartFavoriteButton({context,state,onFavorite}:{context:ChartSongContext;state:ChartFavoriteState;onFavorite:(context:ChartSongContext)=>void}) {
  const key=catalogSongKey(context),saved=state.saved.has(key),busy=state.busy===key;
  return <button className={'btn btn-icon '+(saved?'saved':'')} title={saved?'取消收藏':'收藏'} aria-label={(saved?'取消收藏榜单歌曲 ':'收藏榜单歌曲 ')+context.title} aria-pressed={saved} aria-busy={busy||undefined} disabled={state.disabled||busy} onClick={()=>onFavorite(context)}>{busy?<SpinnerGapIcon size={18} className="favorite-spinner"/>:<HeartIcon size={18} weight={saved?'fill':'regular'}/>}</button>;
}
export function ChartsPage({onSearch,onPlay,onPlayAll,onFavorite,favoriteState}:{onSearch:(item:ChartItem,context?:ChartSongContext)=>void;onPlay:(item:ChartItem,context?:ChartSongContext)=>void;onPlayAll:(items:ChartItem[],contexts?:ChartSongContext[])=>void;onFavorite?:(context:ChartSongContext)=>void;favoriteState?:ChartFavoriteState}) {
  const tabsId=useId();
  const [source,setSource]=useState<ChartSource>(lastChartView.source),[kind,setKind]=useState(lastChartView.kind),[period,setPeriod]=useState(lastChartView.period);
  const [data,setData]=useState<Record<string,MusicChart>>(():Record<string,MusicChart>=>{const {source,kind,period}=lastChartView,chart=source==='netease'?kind as ChartKind:source==='apple'?'most-played':'hot',saved=cachedChart(source,chart,period);return saved?{[source+':'+chart]:saved}:{};}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{lastChartView={source,kind,period};},[source,kind,period]);
  const active=useRef<AbortController|null>(null);
  const chart:ChartKind=source==='netease'?kind as ChartKind:source==='apple'?'most-played':'hot', key=`${source}:${chart}`, current=data[key];
  const context=(item:ChartItem):ChartSongContext=>({source:current!.source,title:item.title,...(item.artists?{artists:item.artists}:{}),chart:current!.chart,...(current!.period?{periodId:current!.period.id}:{}),rank:item.rank,sourceUrl:current!.sourceUrl,...(item.artwork?{artwork:item.artwork}:{})});
  async function load(selected=period) {
    active.current?.abort();active.current=null;setError('');setPeriod(selected);
    const saved=cachedChart(source,chart,selected);
    if(saved)setData(old=>({...old,[key]:saved}));
    if(saved?.refreshAfter&&saved.refreshAfter>Date.now()){setBusy(false);return;}
    const c=new AbortController();active.current=c;setBusy(true);
    try {
      const params=new URLSearchParams({source,chart});if(source==='bilibili')params.set('period',selected);
      const result=await request<MusicChart>('/api/charts?'+params,undefined,c.signal);
      if(!c.signal.aborted&&active.current===c){cacheChart(result,selected);setData(old=>({...old,[key]:result}));}
    } catch(e) {if(!cancelled(e)&&!c.signal.aborted&&active.current===c){setError(errorText(e));if(source==='bilibili')setPeriod((saved??current)?.period?String((saved??current)!.period!.id):'latest');}}
    finally {if(active.current===c)setBusy(false);}
  }
  useEffect(()=>{void load();return()=>active.current?.abort();},[source,chart]);
  return <section className="charts-page" data-chart-source={source}>
    <div className="segmented chart-source-tabs" role="tablist" aria-label="榜单平台" onKeyDown={event=>{
      const keys=Object.keys(sources) as ChartSource[],index=keys.indexOf(source);
      const next=event.key==='ArrowRight'?(index+1)%keys.length:event.key==='ArrowLeft'?(index+keys.length-1)%keys.length:event.key==='Home'?0:event.key==='End'?keys.length-1:-1;
      if(next<0)return;event.preventDefault();setSource(keys[next]);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{Object.entries(sources).map(([id,name])=>{const Icon=sourceIcons[id as ChartSource];return <button key={id} id={`${tabsId}-${id}`} role="tab" tabIndex={source===id?0:-1} aria-controls={`${tabsId}-panel`} aria-selected={source===id} className={source===id?'selected':''} onClick={()=>setSource(id as ChartSource)}><Icon size={16} aria-hidden="true"/>{name}</button>;})}</div>
    <div className="toolbar chart-page-controls">
      {source==='netease'&&<label className="field field-inline"><span className="field-label">榜单</span><select className="select" aria-label="网易云榜单" value={kind} onChange={e=>setKind(e.target.value)}><option value="hot">热歌榜</option><option value="new">新歌榜</option><option value="rising">飙升榜</option></select></label>}
      {source==='bilibili'&&<label className="field field-inline"><span className="field-label">榜单期次</span><select className="select" aria-label="B站热歌榜期次" value={period} disabled={!current?.periods} aria-busy={busy} onChange={e=>void load(e.target.value)}><option value="latest">最新一期</option>{current?.periods?.map(p=><option key={p.id} value={p.id}>第 {p.number} 期 · {new Date(p.publishedAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Hong_Kong'})}</option>)}</select></label>}
    </div>
    {busy&&<p className="loading" role="status">正在读取榜单… <span className="chart-busy" aria-hidden="true"/></p>}
    {error&&<div className="feedback" data-tone="error" role="alert"><p>{error}{current?' · 已保留上次读取的榜单。':''}</p><button className="btn btn-secondary" onClick={()=>void load()}>重试榜单</button></div>}
    {!error&&current?.issue&&<div className="feedback" data-tone="error" role="alert"><p>{errorText({code:current.issue})} 已保留上次读取的榜单。</p><button className="btn btn-secondary" onClick={()=>void load()}>重试榜单</button></div>}
    <div id={`${tabsId}-panel`} role="tabpanel" aria-label={current?.title??sources[source]} aria-busy={busy} tabIndex={0}>{current&&<div className="catalog chart-catalog">
      <div className="section-heading"><div className="catalog-title"><h2>{current.title}</h2><span className="catalog-count">{current.items.length} 首</span></div><PlayAllButton compact className="chart-play-all" count={current.items.length} onClick={()=>onPlayAll(current.items,current.items.map(context))}/></div>
      <p className="muted chart-summary">{current.period?`第 ${current.period.number} 期 · `:''}{current.updatedAt?`来源更新 ${date(current.updatedAt)} · `:''}获取于 {date(current.fetchedAt)} · <a href={current.sourceUrl} target="_blank" rel="noreferrer">查看原榜</a></p>
      <PagedList id={'charts:'+key+':'+(current.period?.id??'latest')} group="charts" label="榜单歌曲" items={current.items}>{items=><div className="chart-song-list">{items.map((item,index)=><div key={`${item.rank}:${index}`} className="chart-song" data-rank={item.rank}>
        <button className="chart-song-main" title={'播放 '+item.title} aria-label={'播放 '+item.title} onClick={()=>onPlay(item,context(item))}><span className="row-number">{String(item.rank).padStart(2,'0')}</span><ChartCover item={item}/><span className="chart-song-copy"><span className="chart-song-title">{item.title}</span><small className="chart-song-artists">{item.artists?.join(' / ')||'歌手未知'}</small></span></button>
        {onFavorite&&(favoriteState?<ChartFavoriteButton context={context(item)} state={favoriteState} onFavorite={onFavorite}/>:<button className="btn btn-icon" aria-label={'收藏榜单歌曲 '+item.title} onClick={()=>onFavorite(context(item))}><HeartIcon size={18}/></button>)}
        <button className="btn btn-icon chart-song-search" title={'搜索其他版本 · '+item.title} aria-label={'搜索 '+item.title} onClick={()=>onSearch(item,context(item))}><MagnifyingGlassIcon size={18}/></button>
        <button className="btn btn-icon chart-song-play" title={'直接播放 '+item.title} aria-label={'直接播放 '+item.title} onClick={()=>onPlay(item,context(item))}><PlayIcon size={16} weight="fill"/></button>
      </div>)}</div>}</PagedList>
    </div>}</div>
  </section>;
}
