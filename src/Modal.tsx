import { useEffect, useId, useRef, type ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';
let locks=0,originalOverflow='';
export function Modal({title,onClose,children,className='',showHeader=true,suspended=false}:{title:string;onClose:()=>void;children:ReactNode;className?:string;showHeader?:boolean;suspended?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null),id=useId(),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    if(suspended)return;
    const previous=document.activeElement as HTMLElement;
    if(locks++===0)originalOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';ref.current?.showModal();
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-autofocus]:not(:disabled)')??[]).find(element=>element.getClientRects().length>0)?.focus({preventScroll:true});
    const trapFocus=(event:KeyboardEvent)=>{
      const dialog=ref.current;if(event.key!=='Tab'||!dialog||Array.from(document.querySelectorAll('dialog[open]')).at(-1)!==dialog)return;
      const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(element=>element.getClientRects().length>0),first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',trapFocus);
    return()=>{document.removeEventListener('keydown',trapFocus);ref.current?.close();if(--locks===0)document.body.style.overflow=originalOverflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[suspended]);
  return <dialog ref={ref} className={'modal '+className} aria-labelledby={showHeader?id:undefined} aria-label={showHeader?undefined:title} onCancel={event=>{event.preventDefault();close.current();}} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close.current();}}}>
    {showHeader&&<header className="modal-header"><h2 id={id}>{title}</h2><button type="button" className="btn btn-icon" aria-label="关闭" title="关闭 · Esc" onClick={onClose}><XIcon size={22}/></button></header>}{children}
  </dialog>;
}
