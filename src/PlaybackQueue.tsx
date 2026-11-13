import { Button, DismissButton } from './ui/Button';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CaretDownIcon, CaretRightIcon, DotsThreeIcon, ListBulletsIcon, MusicNotesIcon, PlayIcon, QueueIcon, ShuffleIcon, SkipForwardIcon, TrashIcon, UsersIcon } from '@phosphor-icons/react';
import { creator, time, type Track } from './api';
import { ControlPopover } from './ControlPopover';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { isTrack, type QueueTrack } from './chart-playback';
import { PlayAllButton, AddToPlaylistButton } from './ListActions';
import type { DisabledDisplay } from './source-settings';
import { VirtualRows } from './VirtualRows';
import { queueDisplayRows } from './queue-groups';

export function PlaybackQueue({items,currentId,playing,order,shuffleGroups=true,onShuffleGroups,onRemoveGroup,renderCover,title,onClose,onPlayAll,onSelect,onMove,onRemove,onClear,onSearch,onCreator,authorBusy,onImport,youtubeEnabled=true,disabledDisplay='dim',desktop=false,onMoveNext,onMoveLast,trackActions}:{
  desktop?:boolean;onMoveNext?:(id:string)=>void;onMoveLast?:(id:string)=>void;trackActions?:(track:Track)=>MenuAction[];
  shuffleGroups?:boolean;onShuffleGroups?:(enabled:boolean)=>void;onRemoveGroup?:(id:string)=>void;
  youtubeEnabled?:boolean;disabledDisplay?:DisabledDisplay;
  onImport?:()=>void;
  items:QueueTrack[];currentId?:string;playing:boolean;order:string;renderCover:(track:QueueTrack)=>ReactNode;title:(track:QueueTrack)=>string;
  onClose:()=>void;onPlayAll:()=>void;onSelect:(id:string)=>void;onMove:(id:string,to:number)=>void;onRemove:(id:string)=>void;onClear:()=>void;onSearch:()=>void;onCreator:(track:Track)=>void;authorBusy:boolean;
}) {
  const active=useRef<HTMLDivElement>(null);
  const scroll=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const blocked=(track:QueueTrack)=>!youtubeEnabled&&isTrack(track)&&track.ref.provider==='youtube';
  const visible=items.filter(track=>disabledDisplay!=='hide'||!blocked(track)),playable=items.filter(track=>!blocked(track));
  const rows=queueDisplayRows(visible,expanded);
  const activeKey=rows.find(row=>row.kind==='track'?row.track.resourceId===currentId:!expanded.has(row.groupId)&&row.tracks.some(track=>track.resourceId===currentId))?.key;
  const hasGroups=items.some(track=>track.partsGroupId);
  const groupShuffle=order==='shuffle'&&hasGroups&&!!onShuffleGroups;
  useEffect(()=>{const groups=new Set(items.map(track=>track.partsGroupId));setExpanded(previous=>[...previous].some(id=>!groups.has(id))?new Set([...previous].filter(id=>groups.has(id))):previous);},[items]);
  useEffect(()=>{if(rows.length<=50)active.current?.scrollIntoView({block:'nearest'});},[currentId,rows.length]);
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
  return <aside className="queue-panel" aria-label="播放队列">
    <div className="queue-heading"><h2 className="catalog-title">播放队列 <small className="catalog-count">{visible.length} 首</small></h2><DismissButton title="关闭播放队列" aria-label="关闭播放队列" onClick={onClose}/></div>
    <div className="toolbar queue-toolbar"><PlayAllButton compact className="queue-play-all" count={playable.length} onClick={onPlayAll}/>{onImport&&<AddToPlaylistButton compact count={playable.filter(isTrack).length} onClick={onImport}/>}</div>
    {visible.length<items.length&&<p className="muted" role="status">已隐藏 {items.length-visible.length} 首 YouTube 歌曲，队列资料保留。</p>}
    {items.length>0&&<div className="queue-mode">{groupShuffle?<label className="queue-shuffle-choice"><span><ShuffleIcon size={16}/>随机</span><select className="select" aria-label="随机播放方式" value={shuffleGroups?'groups':'tracks'} onChange={event=>onShuffleGroups?.(event.target.value==='groups')}><option value="groups">按组随机 · 组内顺序</option><option value="tracks">逐曲随机</option></select></label>:<><span>{order==='shuffle'?<ShuffleIcon size={16}/>:<QueueIcon size={16}/>} {order==='shuffle'?'随机播放':'按列表顺序播放'}</span><small>点击歌曲从头播放</small></>}</div>}
    <div className="queue-content" ref={scroll}>{visible.length?<div className="queue-list"><VirtualRows items={rows} scrollRef={scroll} itemKey={row=>row.key} estimate={68} gap={4} activeKey={activeKey}>{row=>{
      if(row.kind==='group'){
        const selected=row.tracks.findIndex(track=>track.resourceId===currentId),isCurrent=selected>=0,open=expanded.has(row.groupId),groupSize=items.filter(track=>track.partsGroupId===row.groupId).length;
        return <div ref={isCurrent&&!open?active:undefined} key={row.key} className={'queue-group '+(isCurrent?'current':'')} data-group-id={row.groupId}>
          <Button variant="plain" className="queue-group-toggle" aria-expanded={open} aria-label={(open?'收起分曲 ':'展开分曲 ')+row.title} onClick={()=>toggle(row.groupId)}>
            {open?<CaretDownIcon size={18}/>:<CaretRightIcon size={18}/>}<ListBulletsIcon size={22}/><span className="queue-track-copy"><strong title={row.title}>{row.title}</strong><small>{isCurrent?`${playing?'正在播放':'当前'}第 ${selected+1}/${row.tracks.length} 首 · ${title(row.tracks[selected])}`:`${row.tracks.length} 首分曲 · 展开选曲`}</small></span>
          </Button>
          {onRemoveGroup&&(desktop?<ActionMenu className="queue-actions" label={'整组操作 '+row.title} title={row.title} subtitle={`${groupSize} 首分曲`} target=".queue-group" actions={[{id:'remove-group',label:`移除整组（${groupSize} 首）`,icon:<TrashIcon size={18}/>,danger:true,onSelect:()=>onRemoveGroup(row.groupId)}]}/>:<ControlPopover className="queue-actions" label={'整组操作 '+row.title} icon={<DotsThreeIcon size={24}/>} side="bottom"><Button variant="plain" className="danger" onClick={()=>onRemoveGroup(row.groupId)}><TrashIcon size={18}/>移除整组（{groupSize} 首）</Button></ControlPopover>)}
        </div>;
      }
      const track=row.track,index=visible.indexOf(track),isCurrent=currentId===track.resourceId;
      return <div ref={isCurrent?active:undefined} className={'queue-track '+(row.grouped?'queue-group-member ':'')+(blocked(track)?'source-closed ':'')+(blocked(track)&&disabledDisplay==='dim'?'source-disabled ':'')+(isCurrent?'current':'')} key={track.resourceId}>
        <Button variant="plain" className="queue-track-main" disabled={blocked(track)} onClick={()=>onSelect(track.resourceId)} aria-label={'播放队列歌曲 '+track.title} aria-current={isCurrent?'true':undefined}>
          <span className="queue-number" aria-hidden="true">{isCurrent?<MusicNotesIcon size={18} weight={playing?'fill':'regular'}/>:String(index+1).padStart(2,'0')}</span>
          {renderCover(track)}<span className="queue-track-copy"><strong title={track.title}>{title(track)}</strong><small>{blocked(track)?'YouTube 已关闭 · ':isCurrent?<span className="queue-current-label">{playing?'正在播放':'当前歌曲'} · </span>:null}{isTrack(track)?creator(track):(track.artists?.join(' / ')||'歌手未知')+' · 播放时搜索'}</small></span><time>{time(track.durationSeconds)}</time>
        </Button>
        {desktop?<ActionMenu className="queue-actions" label={'队列操作 '+track.title} title={title(track)} subtitle={isCurrent?'当前歌曲':isTrack(track)?creator(track):'播放时自动匹配来源'} target=".queue-track" actions={[
          {id:'play',label:'播放此项',icon:<PlayIcon size={18}/>,disabled:blocked(track),hint:blocked(track)?'YouTube 已关闭':undefined,onSelect:()=>onSelect(track.resourceId)},
          {id:'next',label:'移到下一首',icon:<SkipForwardIcon size={18}/>,disabled:isCurrent||blocked(track),onSelect:()=>onMoveNext?.(track.resourceId)},
          {id:'last',label:'移到队尾',icon:<QueueIcon size={18}/>,disabled:isCurrent||items.indexOf(track)===items.length-1,onSelect:()=>onMoveLast?.(track.resourceId)},
          ...(isTrack(track)&&trackActions?trackActions(track).filter(action=>'separator' in action||!['play','next','last'].includes(action.id)):[]),
          {separator:true},
          {id:'up',label:'上移',icon:<ArrowUpIcon size={18}/>,disabled:index===0,onSelect:()=>onMove(track.resourceId,items.indexOf(visible[index-1]))},
          {id:'down',label:'下移',icon:<ArrowDownIcon size={18}/>,disabled:index===visible.length-1,onSelect:()=>onMove(track.resourceId,items.indexOf(visible[index+1]))},
          {id:'remove',label:'从播放队列移除',icon:<TrashIcon size={18}/>,danger:true,onSelect:()=>onRemove(track.resourceId)},
        ]}/>:<ControlPopover className="queue-actions" label={'队列操作 '+track.title} icon={<DotsThreeIcon size={24}/>} side="bottom">
          <Button variant="plain" disabled={authorBusy||!isTrack(track)||blocked(track)} onClick={()=>{if(isTrack(track))onCreator(track);}}><UsersIcon size={18}/>查看 UP / 博主</Button>
          <Button variant="plain" disabled={index===0} onClick={()=>onMove(track.resourceId,items.indexOf(visible[index-1]))}><ArrowUpIcon size={18}/>上移</Button>
          <Button variant="plain" disabled={index===visible.length-1} onClick={()=>onMove(track.resourceId,items.indexOf(visible[index+1]))}><ArrowDownIcon size={18}/>下移</Button>
          <Button variant="plain" className="danger" onClick={()=>onRemove(track.resourceId)}><TrashIcon size={18}/>移除</Button>
        </ControlPopover>}
      </div>;
    }}</VirtualRows></div>:<div className="queue-empty"><QueueIcon size={40}/><h3>队列还是空的</h3><p>播放一首音乐，或在歌曲菜单中加入队列。</p><Button variant="secondary"  onClick={onSearch}>去搜索音乐</Button></div>}</div>
    {items.length>0&&<div className="queue-footer"><span>{visible.length} 首音乐</span><Button variant="ghost" compact className="queue-clear" onClick={onClear}><TrashIcon size={17}/>清空队列并停止</Button></div>}
  </aside>;
}
