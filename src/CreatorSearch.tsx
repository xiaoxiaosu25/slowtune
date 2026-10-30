import { useEffect, useRef, useState } from 'react';
import type { CreatorSearchItem, CreatorSearchPage, CreatorSearchRequest } from '@studio/music-sources/creators';
import { request, cancelled, errorText, type FollowState, type CreatorProfile } from './api';
import { Avatar } from './Avatar';
import { Pagination } from './Pagination';
import './search-discovery.css';

export function useCreatorSearch() {
  const [result,setResult]=useState<CreatorSearchPage>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const work=useRef<AbortController|null>(null),last=useRef<CreatorSearchRequest|undefined>(undefined);
  const cancel=()=>{work.current?.abort();work.current=null;setBusy(false);};
  useEffect(()=>()=>work.current?.abort(),[]);
  const search=async(query:string,page=1,order:CreatorSearchRequest['order']='relevance',pageSize=30)=>{
    cancel();const controller=new AbortController();work.current=controller;
    const input:CreatorSearchRequest={provider:'bilibili',query,page,pageSize,order};
    if(last.current?.query!==query||last.current?.order!==order||last.current?.pageSize!==pageSize)setResult(undefined);
    last.current=input;setBusy(true);setError('');
    try{const value=await request<CreatorSearchPage>('/api/creators/search',input,controller.signal);if(!controller.signal.aborted)setResult(value);}
    catch(issue){if(!controller.signal.aborted&&!cancelled(issue))setError(errorText(issue));}
    finally{if(work.current===controller){work.current=null;setBusy(false);}}
  };
  return {result,busy,error,search,cancel,retry:()=>last.current&&search(last.current.query,last.current.page,last.current.order,last.current.pageSize),clear:()=>{cancel();last.current=undefined;setResult(undefined);setError('');}};
}

function CreatorSearchCard({creator,state,onChange,onOpen}:{creator:CreatorSearchItem;state:FollowState|null;onChange:(state:FollowState)=>void;onOpen:(creator:CreatorProfile)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const work=useRef<AbortController|null>(null);
  useEffect(()=>()=>work.current?.abort(),[]);
  const followed=!!state?.creators.some(item=>item.provider===creator.provider&&item.id===creator.id);
  const toggle=async()=>{
    if(busy)return;const controller=new AbortController();work.current=controller;setBusy(true);setError('');
    try{
      const current=await request<FollowState>('/api/follows',undefined,controller.signal);
      const exists=current.creators.some(item=>item.provider===creator.provider&&item.id===creator.id);
      const value=await request<FollowState>('/api/follows',{revision:current.revision,action:exists?'unfollow':'follow',creator:{provider:creator.provider,id:creator.id}},controller.signal);
      if(!controller.signal.aborted)onChange(value);
    }catch(issue){if(!controller.signal.aborted&&!cancelled(issue)){setError(errorText(issue));try{const value=await request<FollowState>('/api/follows',undefined,controller.signal);if(!controller.signal.aborted)onChange(value);}catch{/* Keep the last confirmed state. */}}}
    finally{if(work.current===controller){work.current=null;setBusy(false);}}
  };
  return <article className="creator-search-card" aria-label={creator.name}>
    <button type="button" className="creator-search-profile" onClick={()=>onOpen(creator)} aria-label={'查看用户 '+creator.name}><Avatar artwork={creator.artwork} name={creator.name}/><span><strong>{creator.name}</strong>{creator.verification&&<small className="creator-search-verification">{creator.verification}</small>}{creator.followers!==undefined&&<small>{new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(creator.followers)} 粉丝</small>}</span></button>
    <p className="creator-search-description">{creator.description||'这位用户还没有填写简介。'}</p>
    <div className="creator-search-actions"><button type="button" className="btn btn-ghost" onClick={()=>onOpen(creator)}>查看投稿</button><button type="button" className={'btn '+(followed?'btn-secondary':'btn-primary')} aria-label={(followed?'取消关注 ':'关注到慢听 ')+creator.name} aria-pressed={followed} disabled={busy||!state} onClick={()=>void toggle()}>{busy?'保存中…':followed?'已关注':'关注到慢听'}</button></div>
    {error&&<p className="feedback" role="alert">{error}</p>}
  </article>;
}

export function CreatorSearchResults({search,query,order,state,onChange,onOpen}:{search:ReturnType<typeof useCreatorSearch>;query:string;order:CreatorSearchRequest['order'];state:FollowState|null;onChange:(state:FollowState)=>void;onOpen:(creator:CreatorProfile)=>void}) {
  const {result,busy,error}=search;
  const [followError,setFollowError]=useState(''),[followReady,setFollowReady]=useState(false);
  const change=useRef(onChange);change.current=onChange;
  const loadFollows=async(signal?:AbortSignal)=>{setFollowReady(false);try{const value=await request<FollowState>('/api/follows',undefined,signal);if(!signal?.aborted){change.current(value);setFollowError('');setFollowReady(true);}}catch(issue){if(!signal?.aborted)setFollowError(errorText(issue));}};
  useEffect(()=>{const controller=new AbortController();void loadFollows(controller.signal);return()=>controller.abort();},[]);
  const body=useRef<HTMLDivElement>(null);
  const read=(page:number,size=result?.pageSize??30)=>{void search.search(query,page,order,size);if(body.current&&body.current.getBoundingClientRect().top<0)body.current.scrollIntoView({block:'start'});};
  return <div className="creator-search-results paged-list" aria-busy={busy} ref={body}>
    <p className="muted">搜索 B站用户，关注只保存在慢听，不修改 B站关注。</p>
    {followError&&<div className="feedback" role="alert"><p>{followError}</p><button className="btn btn-secondary" onClick={()=>void loadFollows()}>重读关注状态</button></div>}
    {busy&&<div className="loading" role="status">正在搜索用户… <button className="btn btn-ghost" onClick={search.cancel}>取消搜索</button></div>}
    {error&&<div className="feedback" role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={()=>void search.retry()}>重试用户搜索</button></div>}
    {result&&<><div className="creator-search-grid">{result.items.map(creator=><CreatorSearchCard key={creator.provider+':'+creator.id} creator={creator} state={followReady?state:null} onChange={onChange} onOpen={onOpen}/>)}</div>{!result.items.length&&!busy&&<div className="empty"><h3>没有找到用户</h3><p>换一个昵称或关键词试试。</p></div>}{(result.items.length>0||result.hasMore)&&<Pagination label="用户搜索" page={result.page} size={result.pageSize} total={result.total} hasNext={result.hasMore} busy={busy} onPage={page=>read(page)} onSize={size=>read(1,size)}/>}</>}
    {!result&&!busy&&!error&&<div className="empty"><h3>找一位喜欢的作者</h3><p>输入昵称，查看投稿并关注到慢听。</p></div>}
  </div>;
}
