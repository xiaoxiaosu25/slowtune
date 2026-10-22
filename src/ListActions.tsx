import type { ButtonHTMLAttributes } from 'react';
import { ArrowClockwiseIcon, PlayIcon, PlaylistIcon } from '@phosphor-icons/react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
export function AddToPlaylistButton({count,compact=false,...props}:ButtonProps&{count:number;compact?:boolean}) {
  return <button type="button" {...props} className={'btn btn-secondary add-to-playlist '+(compact?'btn-sm ':'')+(props.className??'')} disabled={props.disabled||!count} title={props.title??'批量加入歌单'} aria-label={props['aria-label']??'加入歌单'}><PlaylistIcon size={18}/><span>加入歌单</span></button>;
}

export function PlayAllButton({count, compact=false, label='播放全部', className='', disabled, ...props}: ButtonProps & {count:number; compact?:boolean; label?:string}) {
  return <button type="button" {...props} className={'btn btn-primary play-all '+(compact?'btn-sm ':'')+className} disabled={disabled||!count} title={props.title??`播放当前列表的 ${count} 项内容`}><PlayIcon size={compact?16:18} weight="fill"/>{label}</button>;
}

export function RefreshButton({busy=false, compact=false, iconOnly=false, label='刷新', busyLabel='读取中…', className='', disabled, ...props}: ButtonProps & {busy?:boolean; compact?:boolean; iconOnly?:boolean; label?:string; busyLabel?:string}) {
  return <button type="button" {...props} className={'btn btn-secondary action-refresh '+(compact?'btn-sm ':'')+(iconOnly?'action-icon ':'')+className} disabled={disabled||busy} aria-busy={busy} aria-label={props['aria-label']??label} title={props.title??(busy?busyLabel:label)}><ArrowClockwiseIcon className="refresh-icon" size={18}/>{!iconOnly&&(busy?busyLabel:label)}</button>;
}
