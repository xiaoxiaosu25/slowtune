import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshButton } from './ListActions';
import { DiscoveryShelf } from './DiscoveryShelf';
import { request, cancelled, errorText, type FollowFeed, type FollowState, type Track } from './api';
import { discoverySize } from './CatalogView';

export function FollowUpdatesShelf({state,source,renderCovers,renderList,onPlayAll,onFollow,onImport,youtubeEnabled=true}:{state:FollowState|null;source:'all'|'bilibili'|'youtube';renderCovers:(items:Track[])=>ReactNode;renderList:(items:Track[])=>ReactNode;onPlayAll:(items:Track[])=>void;onFollow:()=>void;onImport?:(items:Track[],title?:string)=>void;youtubeEnabled?:boolean}) {
  const [data,setData]=useState<FollowFeed>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef<AbortController|null>(null);
  const creators=state?.creators.filter(c=>(youtubeEnabled||c.provider!=='youtube')&&(source==='all'||c.provider===source))??[];
  const items=(data?.items??[]).filter(t=>(source==='all'||t.ref.provider===source)&&creators.some(c=>c.provider===t.ref.provider&&c.id===t.uploader?.id)).slice(0,discoverySize);
  async function load(refresh=false) {
    active.current?.abort();if(!state||!creators.length){setData(undefined);setBusy(false);return;}
    const c=new AbortController();active.current=c;setBusy(true);setError('');
    try {const params=new URLSearchParams();if(source!=='all')params.set('provider',source);if(refresh)params.set('refresh','1');const result=await request<FollowFeed>('/api/follows/feed?'+params,undefined,c.signal);if(!c.signal.aborted)setData(result);}
    catch(e){if(!cancelled(e)&&!c.signal.aborted)setError(errorText(e));}
    finally{if(active.current===c)setBusy(false);}
  }
  useEffect(()=>{void load();return()=>active.current?.abort();},[state?.revision,source,youtubeEnabled]);
  return <>
    <DiscoveryShelf shelf={{id:'follow-updates',title:'关注的最近更新',kind:'new',page:{items}}} loading={busy} renderCovers={renderCovers} renderList={renderList} renderError={()=>null} onPlayAll={onPlayAll} onImport={onImport} onRefresh={creators.length?()=>void load(true):undefined} info={<p>已关注作者的最新投稿，按发布时间倒序。</p>} status={busy?'正在读取最近更新…':data?`获取于 ${new Date(data.fetchedAt).toLocaleTimeString('zh-CN')}`:undefined} empty={!state?<p className="muted">正在读取关注名单…</p>:!creators.length?<div className="empty"><h3>先关注喜欢的作者</h3><button className="btn btn-secondary" onClick={onFollow}>添加关注</button></div>:<p className="muted">暂时没有可展示的更新。</p>}/>
    {(error||!!data?.warnings.length)&&<div className="feedback" role="status"><p>{error||data?.warnings.map(w=>`${w.name}：${errorText({code:w.code})}`).join('；')} 已保留可用内容。</p><RefreshButton label="重试更新" busy={busy} onClick={()=>void load(true)}/></div>}
  </>;
}
