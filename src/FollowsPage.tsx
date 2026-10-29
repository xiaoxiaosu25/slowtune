import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MusicClient } from '@studio/music-sources/client';
import { ArrowLeftIcon, PlusIcon, UsersIcon, ListBulletsIcon, CheckIcon, LinkIcon, CaretRightIcon, DotsThreeIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { request, errorText, cancelled, type Track, type FollowState, type CreatorProfile, type CreatorRef, type CreatorCollection, type CreatorCollections, type CreatorVideos, type FollowFeed } from './api';
import { artworkUrl } from '../server/artwork-url';
import { Avatar } from './Avatar';
import { CatalogViewToggle, useCatalogView } from './CatalogView';
import { PlayAllButton, RefreshButton, AddToPlaylistButton } from './ListActions';
import type { ListImportRequest } from './SongListImportPanel';
import { PagedList, Pagination, usePagination } from './Pagination';
import { initialFollowView, type FollowView } from './mobile-follow';
import { Modal } from './Modal';

const identity=(creator:CreatorRef)=>`${creator.provider}:${creator.id}`;
const sourceName=(provider:string)=>provider==='bilibili'?'B站':'YouTube';
export function updateTime(timestamp?:number) {return timestamp&&Number.isFinite(timestamp)?new Date(timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'发布时间未知';}
function CreatorArt({url,name,collection=false}:{url?:string;name:string;collection?:boolean}) {
  const [failed,setFailed]=useState('');const src=artworkUrl(url);
  if(!collection)return <Avatar artwork={url} name={name}/>;
  return src&&src!==failed?<img className="follow-collection-art" src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={()=>setFailed(src)}/>:<span className="follow-collection-art unknown-cover" aria-label={name}><ListBulletsIcon size={30}/></span>;
}
export function FollowTrackButton({client,track,state,onChange,author,onResolved}:{client:MusicClient;track:Track;state:FollowState|null;onChange:(state:FollowState)=>void;author?:CreatorRef;onResolved:(author:CreatorRef)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const work=useRef<AbortController|null>(null);
  const id=author?.id ?? track.uploader?.id,existing=state?.creators.find(c=>c.provider===track.ref.provider&&c.id===id);
  useEffect(()=>{if(id)return;const controller=new AbortController();void client.metadata(track.ref,{signal:controller.signal}).then(entry=>{if(!controller.signal.aborted&&entry.uploader?.id)onResolved({provider:entry.ref.provider,id:entry.uploader.id});}).catch(()=>{});return()=>controller.abort();},[client,track.ref.provider,track.ref.id,track.ref.part,id]);
  useEffect(()=>()=>work.current?.abort(),[]);
  const toggle=async()=>{if(busy)return;const controller=new AbortController();work.current=controller;setBusy(true);setError('');
    try {
      const current=await request<FollowState>('/api/follows',undefined,controller.signal),followed=current.creators.find(c=>c.provider===track.ref.provider&&c.id===id);
      const value=await request<FollowState&{creator:CreatorRef}>('/api/follows',{revision:current.revision,action:followed?'unfollow':'follow',...(followed?{creator:{provider:followed.provider,id:followed.id}}:{ref:track.ref})},controller.signal);
      if(!controller.signal.aborted){onChange(value);onResolved(value.creator);}
    } catch(e){if(!cancelled(e)&&!controller.signal.aborted){setError(errorText(e));void request<FollowState>('/api/follows').then(onChange).catch(()=>{});}}
    finally{if(work.current===controller)setBusy(false);}
  };
  const label=busy?'保存中…':existing?'取消关注 '+existing.name:'关注 '+(track.uploader?.name ?? 'UP / 博主');
  return <><button className="btn btn-secondary" title={label} aria-pressed={!!existing} disabled={busy} onClick={()=>void toggle()}>{existing?<CheckIcon size={19}/>:<UsersIcon size={19}/>}<span>{label}</span></button>{error&&<p className="error-text follow-track-error" role="alert">{error}</p>}</>;
}
const feedCache=new Map<string,FollowFeed>();
const videoCache=new Map<string,CreatorVideos>();
let lastFollowView:FollowView=initialFollowView;
const collectionCache=new Map<string,CreatorCollections>();
function FeedPages({revision,source,refresh,render,onData}:{revision:string;source:string;refresh:number;render:(items:Track[],offset:number)=>ReactNode;onData:(feed:FollowFeed)=>void}) {
  const id='follow-feed:'+source+':'+revision;
  const [feed,setFeed]=useState<FollowFeed|undefined>(()=>feedCache.get(id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const paging=usePagination(id,feed?.total,'follow-updates');
  const work=useRef<AbortController|null>(null),body=useRef<HTMLDivElement>(null),lastRefresh=useRef(refresh);
  const read=async(page=paging.page,size=paging.size,force=false,scroll=false)=>{
    work.current?.abort();const controller=new AbortController();work.current=controller;setBusy(true);setError('');
    try {
      const cached=feedCache.get(id);
      const query=new URLSearchParams({page:String(cached?.snapshot&&!force?page:1),pageSize:String(size)});
      if(source!=='all')query.set('provider',source);
      if(force)query.set('refresh','1');else if(cached?.snapshot)query.set('snapshot',cached.snapshot);
      let value=await request<FollowFeed>('/api/follows/feed?'+query,undefined,controller.signal);
      if(!cached?.snapshot&&!force&&page>1&&value.snapshot){query.set('snapshot',value.snapshot);query.set('page',String(page));value=await request<FollowFeed>('/api/follows/feed?'+query,undefined,controller.signal);}
      if(controller.signal.aborted)return;
      if(feedCache.size>=12&&!feedCache.has(id))feedCache.delete(feedCache.keys().next().value!);
      feedCache.set(id,value);setFeed(value);onData(value);
      if(size!==paging.size)paging.onSize(size);
      paging.onPage(value.page??1);
      if(scroll&&body.current&&body.current.getBoundingClientRect().top<0)body.current.scrollIntoView({block:'start'});
    }catch(issue){if(!controller.signal.aborted&&!cancelled(issue)){
      const stale=(issue as {code?:string}).code==='stale-cursor';
      if(stale)feedCache.delete(id);
      setError(stale?'这批更新的分页已过期，请重新获取更新。当前内容保留。':errorText(issue));
    }}finally{if(work.current===controller)setBusy(false);}
  };
  useEffect(()=>{const force=lastRefresh.current!==refresh;lastRefresh.current=refresh;setFeed(feedCache.get(id));void read(force?1:paging.page,paging.size,force);return()=>work.current?.abort();},[id,refresh]);
  return <div className="paged-list follow-feed-pages" ref={body}>
    {error&&<div className="feedback" data-tone="error" role="alert"><p>{error}</p><RefreshButton label="重新获取更新" busy={busy} onClick={()=>void read(1,paging.size,true)}/></div>}
    {busy&&<p className="loading" role="status">正在读取更新… <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{work.current?.abort();setBusy(false);setError('读取已取消，当前内容保留。可以重新获取更新。');}}>取消读取</button></p>}
    {!!feed?.warnings.length&&<div className="feedback" role="status"><p>{feed.warnings.map(w=>`${w.name}：${errorText({code:w.code==='authentication'&&w.creator.provider==='bilibili'?'bilibili-authentication':w.code})}`).join('；')} 已保留可用内容。</p><RefreshButton label="重试更新" busy={busy} onClick={()=>void read(1,paging.size,true)}/></div>}
    {feed&&<><p className="muted follow-status">已关注作者的近期投稿 · 按发布时间倒序 · 本批共 {feed.total} 条</p>{feed.items.length?render(feed.items,(Math.max(1,feed.page??1)-1)*(feed.pageSize??paging.size)):<div className="empty"><UsersIcon size={36}/><h3>暂时没有可展示的更新</h3><p>刷新重试，或进入作者主页查看。</p></div>}
      {feed.total>0&&<Pagination {...paging} page={feed.page??paging.page} size={feed.pageSize??paging.size} label="最近更新" busy={busy} onPage={page=>void read(page,paging.size,false,true)} onSize={size=>void read(1,size,false,true)}/>}</>}
  </div>;
}
function CreatorVideoPages({creator,collection,refresh,render,onData}:{creator:CreatorProfile;collection?:CreatorCollection;refresh:number;render:(items:Track[],offset:number)=>ReactNode;onData:(data:CreatorVideos)=>void}) {
  const id='author-videos:'+identity(creator)+':'+(collection?.id??'uploads');
  const [data,setData]=useState(()=>videoCache.get(id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const paging=usePagination(id,data?.total??(data&&!data.cursor?data.items.length:undefined),'creator-videos');
  const work=useRef<AbortController|null>(null),body=useRef<HTMLDivElement>(null),lastRefresh=useRef(refresh);
  const read=async(page=paging.page,size=paging.size,scroll=false)=>{
    work.current?.abort();const controller=new AbortController();work.current=controller;setBusy(true);setError('');
    try{
      const query=new URLSearchParams({provider:creator.provider,id:creator.id,page:String(page),pageSize:String(size)});
      if(collection)query.set('collection',collection.id);
      const value=await request<CreatorVideos>((collection?'/api/follows/collection?':'/api/follows/videos?')+query,undefined,controller.signal);
      if(controller.signal.aborted)return;
      if(videoCache.size>=20&&!videoCache.has(id))videoCache.delete(videoCache.keys().next().value!);
      videoCache.set(id,value);setData(value);onData(value);
      if(size!==paging.size)paging.onSize(size);
      paging.onPage(value.page??1);
      if(scroll&&body.current&&body.current.getBoundingClientRect().top<0)body.current.scrollIntoView({block:'start'});
    }catch(issue){if(!controller.signal.aborted&&!cancelled(issue))setError(errorText(issue));}
    finally{if(work.current===controller)setBusy(false);}
  };
  useEffect(()=>{const reset=lastRefresh.current!==refresh;lastRefresh.current=refresh;void read(reset?1:paging.page);return()=>work.current?.abort();},[id,refresh]);
  return <div className="paged-list" ref={body}>
    {busy&&<p className="loading" role="status">正在读取作者内容… <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{work.current?.abort();setBusy(false);setError('读取已取消，当前内容保留。');}}>取消读取</button></p>}
    {error&&<div className="feedback" data-tone="error" role="alert"><p>{error}</p><RefreshButton label="重试内容" busy={busy} onClick={()=>void read()}/></div>}
    {data&&<>{render(data.items,((data.page??1)-1)*(data.pageSize??paging.size))}<Pagination {...paging} label="作者内容" page={data.page??paging.page} size={data.pageSize??paging.size} busy={busy} onPage={page=>void read(page,paging.size,true)} onSize={size=>void read(1,size,true)}/></>}
  </div>;
}
interface Props { client:MusicClient;state:FollowState|null;onChange:(value:FollowState)=>void;source:'all'|'bilibili'|'youtube';renderList:(items:Track[],timestamps?:boolean,offset?:number,all?:Track[])=>ReactNode;renderCovers:(items:Track[],timestamps?:boolean,offset?:number,all?:Track[])=>ReactNode;onPlayAll:(items:Track[])=>void;onImport?:(items:Track[],title?:string)=>void;onImportSource?:(input:ListImportRequest)=>void;onSearch:()=>void;initialCreator?:CreatorProfile;onClearCreator:()=>void }
export function FollowsPage({client,state,onChange,source,renderList,renderCovers,onPlayAll,onImport,onImportSource,onSearch,initialCreator,onClearCreator,youtubeEnabled=true,navigationView,onNavigationViewChange,onMobileBack,mobile=false}:Props&{youtubeEnabled?:boolean;navigationView?:FollowView;onNavigationViewChange?:(update:(old:FollowView)=>FollowView)=>void;onMobileBack?:(target:FollowView,fallback:()=>void)=>void;mobile?:boolean}) {
  const desktopUpdatesView=useCatalogView('follow-updates','list'),mobileUpdatesView=useCatalogView('mobile:follow-updates','list');
  const updatesView=mobile?mobileUpdatesView:desktopUpdatesView;
  const [localView,setLocalView]=useState<FollowView>(()=>initialCreator?{...lastFollowView,selected:initialCreator,collection:undefined,view:'collections'}:lastFollowView);
  const {tab,selected,collection,view}=navigationView??localView;
  useEffect(()=>{if(navigationView)setLocalView(navigationView);},[navigationView]);
  const changeView=(update:(old:FollowView)=>FollowView)=>(onNavigationViewChange??setLocalView)(update);
  const setTab=(tab:FollowView['tab'])=>changeView(old=>({...old,tab}));
  const setSelected=(next:CreatorProfile|undefined|((old:CreatorProfile|undefined)=>CreatorProfile|undefined))=>changeView(old=>({...old,selected:typeof next==='function'?next(old.selected):next}));
  const setCollection=(collection:CreatorCollection|undefined)=>changeView(old=>({...old,collection}));
  const setView=(view:FollowView['view'])=>changeView(old=>({...old,view}));
  const [collections,setCollections]=useState<CreatorCollections|undefined>(()=>selected?collectionCache.get(identity(selected)):undefined),[videos,setVideos]=useState<CreatorVideos>(),[feed,setFeed]=useState<FollowFeed>(),[feedRefresh,setFeedRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[writing,setWriting]=useState(false),[addOpen,setAddOpen]=useState(false),[input,setInput]=useState(''),[writeError,setWriteError]=useState('');
  const work=useRef<AbortController|null>(null),writeWork=useRef<AbortController|null>(null);
  const [videoRefresh,setVideoRefresh]=useState(0);
  const [mobileMenu,setMobileMenu]=useState(false);
  const visibleCreators=state?.creators.filter(c=>(youtubeEnabled||c.provider!=='youtube')&&(source==='all'||c.provider===source)) ?? [];
  const selectedKey=selected?identity(selected):'',collectionId=collection?.id ?? '';
  const updatesRevision=!selected&&tab==='updates'?state?.revision:undefined;
  const load=async(more=false,refresh=false)=>{
    work.current?.abort();const controller=new AbortController();work.current=controller;setBusy(true);setError('');
    try {
      const profiles=tab==='creators'&&!selected;
      const current=await request<FollowState>(profiles?'/api/follows?profiles=1'+(refresh?'&refresh=1':''):'/api/follows',undefined,controller.signal);if(controller.signal.aborted)return;onChange(current);
      if(selected){const updated=current.creators.find(c=>identity(c)===identity(selected));if(updated?.artwork)setSelected(previous=>previous&&identity(previous)===identity(updated)?{...previous,artwork:updated.artwork}:previous);}
      if(selected) {
        const query=new URLSearchParams({provider:selected.provider,id:selected.id});
        if(!selected.artwork||refresh){
          void request<CreatorProfile>('/api/creators/profile?'+query+(refresh?'&refresh=1':''),undefined,controller.signal).then(profile=>{if(!controller.signal.aborted)setSelected(previous=>previous&&identity(previous)===identity(profile)?{...previous,artwork:profile.artwork??previous.artwork}:previous);}).catch(()=>{});
        }
        if(view==='collections'&&!collection) {
          const cached=collectionCache.get(selectedKey);if(!more&&!refresh&&cached){setCollections(cached);return;}
          if(more&&collections?.cursor)query.set('cursor',collections.cursor);
          const value=await request<CreatorCollections>('/api/follows/collections?'+query,undefined,controller.signal);
          if(!controller.signal.aborted)setCollections(previous=>{const next={...value,items:more?[...new Map([...(previous?.items??[]),...value.items].map(c=>[c.id,c])).values()]:value.items};if(collectionCache.size>=20&&!collectionCache.has(selectedKey))collectionCache.delete(collectionCache.keys().next().value!);collectionCache.set(selectedKey,next);return next;});
        } else if(selected.provider==='bilibili'){
          if(refresh)setVideoRefresh(value=>value+1);
        } else {
          const cacheKey='author-videos:'+selectedKey+':'+(collection?.id??'uploads'),cached=videoCache.get(cacheKey);
          if(!more&&!refresh&&cached){setVideos(cached);return;}
          if(more&&videos?.cursor)query.set('cursor',videos.cursor);
          let value:CreatorVideos;
          if(collection?.kind==='playlist'&&collection.ref) {
            const page=await client.list({ref:collection.ref,limit:30,...(more?{cursor:videos?.cursor}:{})},{signal:controller.signal});value={items:page.items,cursor:page.nextCursor};
          } else {
            if(collection)query.set('collection',collection.id);
            value=await request<CreatorVideos>((collection?'/api/follows/collection?':'/api/follows/videos?')+query,undefined,controller.signal);
          }
          if(!controller.signal.aborted)setVideos(previous=>{const next={...value,items:more?[...new Map([...(previous?.items??[]),...value.items].map(t=>[t.resourceId,t])).values()]:value.items};if(videoCache.size>=20&&!videoCache.has(cacheKey))videoCache.delete(videoCache.keys().next().value!);videoCache.set(cacheKey,next);return next;});
        }
      } else if(tab==='updates'&&refresh)setFeedRefresh(value=>value+1);
    } catch(e){if(!cancelled(e)&&!controller.signal.aborted)setError(errorText(e));}
    finally{if(work.current===controller)setBusy(false);}
  };
  useEffect(()=>{if(!navigationView)changeView(old=>({...old,selected:initialCreator,collection:undefined,view:'collections'}));},[initialCreator]);
  useEffect(()=>{lastFollowView={tab,selected,collection,view};},[tab,selected,collection,view]);
  useEffect(()=>{if(selected&&(!youtubeEnabled&&selected.provider==='youtube'||source!=='all'&&source!==selected.provider)){setSelected(undefined);setCollection(undefined);onClearCreator();return;}setError('');setCollections(selected?collectionCache.get(selectedKey):undefined);setVideos(undefined);setFeed(undefined);void load();return()=>work.current?.abort();},[selectedKey,collectionId,view,tab,source,updatesRevision,youtubeEnabled]);
  useEffect(()=>()=>{writeWork.current?.abort();},[]);
  const change=async(creator?:CreatorProfile)=>{
    if(writing)return;const controller=new AbortController();writeWork.current=controller;setWriting(true);setWriteError('');
    try {
      const current=await request<FollowState>('/api/follows',undefined,controller.signal);
      const followed=creator&&current.creators.some(c=>identity(c)===identity(creator));
      const value=await request<FollowState>('/api/follows',{revision:current.revision,action:followed?'unfollow':'follow',...(creator?{creator:{provider:creator.provider,id:creator.id}}:{input:input.trim()})},controller.signal);
      if(controller.signal.aborted)return;onChange(value);
      if(!creator){setInput('');setAddOpen(false);}
    } catch(e){if(!cancelled(e)&&!controller.signal.aborted){setWriteError(errorText(e));void request<FollowState>('/api/follows').then(onChange).catch(()=>{});}}
    finally{if(writeWork.current===controller)setWriting(false);}
  };
  const choose=(creator:CreatorProfile)=>{setSelected(creator);setCollection(undefined);setView('collections');setError('');};
  const selectedFollowed=selected&&state?.creators.some(c=>identity(c)===identity(selected));
  const filteredVideos=(videos?.items ?? []).filter(t=>source==='all'||t.ref.provider===source);
  const filteredFeed=(feed?.items ?? []).filter(t=>(youtubeEnabled||t.ref.provider!=='youtube')&&(source==='all'||t.ref.provider===source)&&state?.creators.some(c=>c.provider===t.ref.provider&&c.id===t.uploader?.id));
  const retry=()=>void load(false,tab==='updates');
  const returnToParent=()=>{const fallback=()=>{if(collection){setCollection(undefined);setView('collections');}else {setSelected(undefined);onClearCreator();}};if(onMobileBack)onMobileBack({tab,selected:collection?selected:undefined,view:'collections'},fallback);else fallback();};
  const followButton=selected&&<button className="btn btn-secondary" aria-pressed={!!selectedFollowed} disabled={writing} onClick={()=>void change(selected)}>{selectedFollowed?<CheckIcon size={18}/>:<PlusIcon size={18}/>}<span>{writing?'保存中…':selectedFollowed?'取消关注':'关注作者'}</span></button>;
  return <section className="follows-page">
    {mobile&&!selected?<><div className="toolbar follow-toolbar mobile-follow-toolbar">
      <div className="segmented" aria-label="关注视图"><button aria-label="关注的 UP" className={tab==='creators'?'selected':''} aria-pressed={tab==='creators'} onClick={()=>setTab('creators')}>作者</button><button aria-label="最近更新" className={tab==='updates'?'selected':''} aria-pressed={tab==='updates'} onClick={()=>setTab('updates')}>更新</button></div>
      <RefreshButton iconOnly busy={busy} onClick={()=>void load(false,true)}/>
      <button className="btn btn-icon" aria-label="关注页面操作" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(true)}><DotsThreeIcon size={25}/></button>
    </div>{mobileMenu&&<Modal title="关注页面操作" className="mobile-actions-sheet" onClose={()=>setMobileMenu(false)}><div className="mobile-action-list">
      <button onClick={()=>{setMobileMenu(false);setAddOpen(true);setWriteError('');}}><PlusIcon size={23}/><span>添加关注</span></button>
      {tab==='updates'&&<>
        {onImport&&<button disabled={!filteredFeed.length} onClick={()=>{setMobileMenu(false);onImport(filteredFeed,'关注的最近更新 · 本页');}}><ListBulletsIcon size={23}/><span>加入本页更新到歌单</span></button>}
        <button aria-pressed={updatesView.view==='covers'} onClick={()=>{updatesView.setView('covers');setMobileMenu(false);}}><SquaresFourIcon size={23}/><span>封面浏览</span></button>
        <button aria-pressed={updatesView.view==='list'} onClick={()=>{updatesView.setView('list');setMobileMenu(false);}}><ListBulletsIcon size={23}/><span>歌曲列表</span></button>
      </>}
    </div></Modal>}</>:!mobile&&<div className="toolbar follow-toolbar">
      {selected?<button className="btn btn-ghost" onClick={returnToParent}><ArrowLeftIcon size={18}/>{collection?'返回作者合集':'返回关注'}</button>:<div className="segmented" aria-label="关注视图"><button className={tab==='creators'?'selected':''} aria-pressed={tab==='creators'} onClick={()=>setTab('creators')}>关注的 UP</button><button className={tab==='updates'?'selected':''} aria-pressed={tab==='updates'} onClick={()=>setTab('updates')}>最近更新</button></div>}
      {!selected&&tab==='updates'&&<CatalogViewToggle title="关注的最近更新" view={updatesView.view} onChange={updatesView.setView}/>}
      {!selected&&tab==='updates'&&<><PlayAllButton label="播放本页" count={filteredFeed.length} onClick={()=>onPlayAll(filteredFeed)}/>{onImport&&<AddToPlaylistButton count={filteredFeed.length} title="加入本页更新到歌单" onClick={()=>onImport(filteredFeed,'关注的最近更新 · 本页')}/>}</>}
      <RefreshButton busy={busy} onClick={()=>void load(false,true)}/>
      {!selected&&<button className="btn btn-secondary follow-add-button" aria-label="添加关注" title="添加关注" aria-expanded={addOpen} onClick={()=>{setAddOpen(value=>!value);setWriteError('');}}><PlusIcon size={18}/>添加关注</button>}
    </div>}
    {addOpen&&!selected&&<form className="panel follow-add" onSubmit={e=>{e.preventDefault();void change();}}><label className="field"><span className="field-label">作者主页链接 / B站 UID</span><input className="input" value={input} onChange={e=>setInput(e.target.value)} placeholder="B站空间、YouTube @主页或频道链接" maxLength={500} required/></label><p className="muted">也可以在歌曲的更多操作中关注作者。关注名单在慢听中保存，{window.slowTuneDesktop?'与服务版各自保存。':'电脑和手机共用。'}</p><div className="toolbar"><button className="btn btn-primary" disabled={writing||!input.trim()}>{writing?'正在添加…':'关注作者'}</button><button type="button" className="btn btn-ghost" disabled={writing} onClick={()=>setAddOpen(false)}>取消</button></div></form>}
    {writeError&&<p className="feedback error-text" role="alert">{writeError}</p>}
    {!selected&&tab==='updates'&&updatesView.saveFailed&&<p className="muted" role="status">当前浏览器无法保存显示设置。</p>}
    {error&&<div className="feedback" data-tone="error" role="alert"><p>{error}</p><RefreshButton label="重新读取" busy={busy} onClick={retry}/></div>}
    {busy&&<div className="loading" role="status">正在读取{selected?collection?'合集内容':'作者内容':tab==='updates'?'关注作者的最新投稿':'关注名单'}… <button className="btn btn-ghost" onClick={()=>{work.current?.abort();void request('/api/follows/cancel',{}).catch(()=>{});setBusy(false);}}>取消</button></div>}
    {!selected&&tab==='creators'&&<><p className="muted follow-status">{visibleCreators.length} 位已关注作者 · 点击作者查看合集</p>{visibleCreators.length?<PagedList id={'follow-creators:'+source} group="follow-creators" label="关注作者" items={visibleCreators}>{items=><div className="follow-creator-grid">{items.map(creator=><article className="panel follow-creator-card" key={identity(creator)}><button className="follow-creator-open" onClick={()=>choose(creator)} aria-label={'查看 '+creator.name+' 的合集'}><CreatorArt url={creator.artwork} name={creator.name}/><span><strong>{creator.name}</strong><small>{sourceName(creator.provider)} · 查看合集</small></span></button><button className="btn btn-secondary btn-sm" aria-pressed="true" disabled={writing} onClick={()=>void change(creator)} aria-label={'取消关注 '+creator.name}><CheckIcon size={16}/>已关注</button></article>)}</div>}</PagedList>:state&&!busy&&!error&&<div className="empty"><UsersIcon size={40}/><h3>{state.creators.length?'这个来源还没有关注':'关注喜欢的 UP 和博主'}</h3><p>在歌曲菜单关注作者，或粘贴作者主页链接。</p><button className="btn btn-secondary" onClick={onSearch}>去搜索</button></div>}</>}
    {selected&&<>{mobile&&collection?<div className="mobile-collection-author"><button onClick={returnToParent} aria-label={'查看作者 '+selected.name}><CreatorArt url={selected.artwork} name={selected.name}/><span>{selected.name}</span><CaretRightIcon size={18}/></button><RefreshButton busy={busy} onClick={()=>void load(false,true)}/></div>:<div className="follow-author-heading"><CreatorArt url={selected.artwork} name={selected.name}/><div><h2>{selected.name}</h2><p className="muted">{sourceName(selected.provider)} · <a href={selected.url} target="_blank" rel="noreferrer">查看作者主页</a></p></div>{mobile?<div className="follow-author-actions">{followButton}<RefreshButton busy={busy} onClick={()=>void load(false,true)}/></div>:followButton}</div>}
      {!collection&&<div className="segmented follow-author-tabs" aria-label="作者内容"><button className={view==='collections'?'selected':''} aria-pressed={view==='collections'} onClick={()=>setView('collections')}>合集</button><button className={view==='videos'?'selected':''} aria-pressed={view==='videos'} onClick={()=>setView('videos')}>{selected.provider==='youtube'?'最近投稿':'全部投稿'}</button></div>}
      {(collection||view==='videos')&&<div className="section-heading follow-content-heading"><h3 title={collection?.title}>{collection?.title??(selected.provider==='youtube'?'最近投稿':'全部投稿')}</h3><div className="toolbar"><span className="catalog-count">{filteredVideos.length} 首</span><PlayAllButton compact label={selected.provider==='bilibili'?'播放本页':'播放已读'} count={filteredVideos.length} onClick={()=>onPlayAll(filteredVideos)}/><AddToPlaylistButton compact count={collection?1:filteredVideos.length} onClick={()=>{if(collection&&onImportSource)onImportSource({title:collection.title,source:collection.kind==='playlist'&&collection.ref?{kind:'playlist',ref:collection.ref}:{kind:'creator-collection',creator:{provider:selected.provider,id:selected.id},collectionId:collection.id}});else onImport?.(filteredVideos,selected.name+'的投稿');}}/>{collection&&<a className={'btn btn-ghost btn-sm'+(mobile?' mobile-collection-source':'')} aria-label="查看原合集" href={collection.url} target="_blank" rel="noreferrer">{mobile?<LinkIcon size={21}/>: '查看原合集'}</a>}</div></div>}
      {view==='collections'&&!collection?<>{collections&&<PagedList id={'collections:'+selectedKey} group="collections" label="作者合集" items={collections.items} cursor={collections.cursor} busy={busy} error={!!error} onLoadMore={()=>load(true)}>{items=>items.length?<div className="follow-collection-grid">{items.map(item=><button className="panel follow-collection-card" key={item.id} onClick={()=>setCollection(item)} aria-label={'打开合集 '+item.title}><CreatorArt url={item.artwork} name={item.title} collection/><strong>{item.title}</strong><small>{item.count===undefined?'公开合集':`${item.count} 个视频`}</small></button>)}</div>:!busy&&!error&&<div className="empty"><ListBulletsIcon size={36}/><h3>作者还没有公开合集</h3><p>可以切换到投稿查看内容。</p></div>}</PagedList>}</>:<>{selected.provider==='youtube'&&!collection&&<p className="muted follow-status">YouTube 公开更新提供最近 15 条投稿。</p>}{selected.provider==='bilibili'?<CreatorVideoPages key={selectedKey+':'+collectionId} creator={selected} collection={collection} refresh={videoRefresh} onData={setVideos} render={(items,offset)=>renderList(items,!collection,offset,items)}/>:videos&&<PagedList id={'creator-videos:'+selectedKey+':'+collectionId} group="creator-videos" label="作者内容" items={filteredVideos} cursor={videos.cursor} busy={busy} error={!!error} onLoadMore={()=>load(true)}>{(items,offset)=>renderList(items,!collection,offset,filteredVideos)}</PagedList>}</>}
    </>}
    {!selected&&tab==='updates'&&state&&<>{mobile&&<div className="mobile-follow-feed-heading"><div className="catalog-title"><h2>最近更新</h2>{feed&&<span className="catalog-count">{feed.total} 条</span>}</div><PlayAllButton compact className="mobile-follow-play" label="播放本页" count={filteredFeed.length} onClick={()=>onPlayAll(filteredFeed)}/></div>}<FeedPages key={(youtubeEnabled?source:'bilibili')+':'+state.revision} revision={state.revision} source={youtubeEnabled?source:'bilibili'} refresh={feedRefresh} onData={setFeed} render={(items,offset)=>{const visible=items.filter(t=>(youtubeEnabled||t.ref.provider!=='youtube')&&state.creators.some(c=>c.provider===t.ref.provider&&c.id===t.uploader?.id));return updatesView.view==='covers'?<div className={mobile?'mobile-shelf-covers mobile-shelf-gallery':undefined}>{renderCovers(visible,true,offset,visible)}</div>:renderList(visible,true,offset,visible);}}/></>}
  </section>;
}
