import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, DotsThreeIcon, MusicNotesIcon, QueueIcon, ShuffleIcon, TrashIcon, UsersIcon, XIcon } from '@phosphor-icons/react';
import { creator, time, type Track } from './api';
import { ControlPopover } from './ControlPopover';
import { isTrack, type QueueTrack } from './chart-playback';
import { PlayAllButton, AddToPlaylistButton } from './ListActions';
import type { DisabledDisplay } from './source-settings';

export function PlaybackQueue({items,currentId,playing,order,renderCover,title,onClose,onPlayAll,onSelect,onMove,onRemove,onClear,onSearch,onCreator,authorBusy,onImport,youtubeEnabled=true,disabledDisplay='dim'}:{
  youtubeEnabled?:boolean;disabledDisplay?:DisabledDisplay;
  onImport?:()=>void;
  items:QueueTrack[];currentId?:string;playing:boolean;order:string;renderCover:(track:QueueTrack)=>ReactNode;title:(track:QueueTrack)=>string;
  onClose:()=>void;onPlayAll:()=>void;onSelect:(id:string)=>void;onMove:(id:string,to:number)=>void;onRemove:(id:string)=>void;onClear:()=>void;onSearch:()=>void;onCreator:(track:Track)=>void;authorBusy:boolean;
}) {
  const active=useRef<HTMLDivElement>(null);
  const blocked=(track:QueueTrack)=>!youtubeEnabled&&isTrack(track)&&track.ref.provider==='youtube';
  const visible=items.filter(track=>disabledDisplay!=='hide'||!blocked(track)),playable=items.filter(track=>!blocked(track));
  useEffect(()=>{active.current?.scrollIntoView({block:'nearest'});},[currentId,items.length]);
  return <aside className="queue-panel" aria-label="播放队列">
    <div className="queue-heading"><div><span className="eyebrow">你的聆听列表</span><h2 className="catalog-title">播放队列 <small className="catalog-count">{visible.length} 首</small></h2></div><button className="btn btn-icon" title="关闭播放队列" aria-label="关闭播放队列" onClick={onClose}><XIcon size={22}/></button></div>
    <div className="toolbar queue-toolbar"><PlayAllButton compact className="queue-play-all" count={playable.length} onClick={onPlayAll}/>{onImport&&<AddToPlaylistButton compact count={playable.filter(isTrack).length} onClick={onImport}/>}</div>
    {visible.length<items.length&&<p className="muted" role="status">已隐藏 {items.length-visible.length} 首 YouTube 歌曲，队列资料保留。</p>}
    {items.length>0&&<div className="queue-mode"><span>{order==='shuffle'?<ShuffleIcon size={16}/>:<QueueIcon size={16}/>} {order==='shuffle'?'随机播放':'按列表顺序播放'}</span><small>点击歌曲从头播放</small></div>}
    <div className="queue-content">{visible.length?<div className="queue-list">{visible.map((track,index)=>{
      const isCurrent=currentId===track.resourceId;
      return <div ref={isCurrent?active:undefined} className={'queue-track '+(blocked(track)?'source-closed ':'')+(blocked(track)&&disabledDisplay==='dim'?'source-disabled ':'')+(isCurrent?'current':'')} key={track.resourceId}>
        <button className="queue-track-main" disabled={blocked(track)} onClick={()=>onSelect(track.resourceId)} aria-label={'播放队列歌曲 '+track.title} aria-current={isCurrent?'true':undefined}>
          <span className="queue-number" aria-hidden="true">{isCurrent?<MusicNotesIcon size={18} weight={playing?'fill':'regular'}/>:String(index+1).padStart(2,'0')}</span>
          {renderCover(track)}<span className="queue-track-copy"><strong title={track.title}>{title(track)}</strong><small>{blocked(track)?'YouTube 已关闭 · ':isCurrent?<span className="queue-current-label">{playing?'正在播放':'当前歌曲'} · </span>:null}{isTrack(track)?creator(track):(track.artists?.join(' / ')||'歌手未知')+' · 播放时搜索'}</small></span><time>{time(track.durationSeconds)}</time>
        </button>
        <ControlPopover className="queue-actions" label={'队列操作 '+track.title} icon={<DotsThreeIcon size={24}/>} side="bottom">
          <button disabled={authorBusy||!isTrack(track)||blocked(track)} onClick={()=>{if(isTrack(track))onCreator(track);}}><UsersIcon size={18}/>查看 UP / 博主</button>
          <button disabled={index===0} onClick={()=>onMove(track.resourceId,items.indexOf(visible[index-1]))}><ArrowUpIcon size={18}/>上移</button>
          <button disabled={index===visible.length-1} onClick={()=>onMove(track.resourceId,items.indexOf(visible[index+1]))}><ArrowDownIcon size={18}/>下移</button>
          <button className="danger" onClick={()=>onRemove(track.resourceId)}><TrashIcon size={18}/>移除</button>
        </ControlPopover>
      </div>;
    })}</div>:<div className="queue-empty"><QueueIcon size={40}/><h3>队列还是空的</h3><p>播放一首音乐，或在歌曲菜单中加入队列。</p><button className="btn btn-secondary" onClick={onSearch}>去搜索音乐</button></div>}</div>
    {items.length>0&&<div className="queue-footer"><span>{visible.length} 首音乐</span><button className="btn btn-ghost btn-sm queue-clear" onClick={onClear}><TrashIcon size={17}/>清空队列并停止</button></div>}
  </aside>;
}
