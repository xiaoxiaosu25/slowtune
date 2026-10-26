import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftIcon, XIcon } from '@phosphor-icons/react';
import { useMobilePageSuspension } from './mobile-pages';
let locks=0,originalOverflow='';
export function Modal({title,onClose,children,className='',showHeader=true,suspended=false,mobilePage=false}:{title:string;onClose:()=>void;children:ReactNode;className?:string;showHeader?:boolean;suspended?:boolean;mobilePage?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null),id=useId(),close=useRef(onClose);close.current=onClose;
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:760px)').matches);
  const [portal]=useState(()=>document.querySelector('.app')??document.body);
  const pageSuspended=useMobilePageSuspension(),page=mobilePage&&mobile;
  useEffect(()=>{if(!mobilePage)return;const query=window.matchMedia('(max-width:760px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[mobilePage]);
  useEffect(()=>{
    if(suspended)return;
    const previous=document.activeElement as HTMLElement;
    if(locks++===0)originalOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';if(page)ref.current?.show();else ref.current?.showModal();
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-autofocus]:not(:disabled)')??[]).find(element=>element.getClientRects().length>0)?.focus({preventScroll:true});
    const trapFocus=(event:KeyboardEvent)=>{
      const dialog=ref.current,top=Array.from(document.querySelectorAll('dialog:modal')).at(-1)??Array.from(document.querySelectorAll('dialog[open]:not([hidden])')).at(-1);if(!dialog||dialog.hidden||top!==dialog)return;
      if(page){if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close.current();}return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(element=>element.getClientRects().length>0),first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',trapFocus);
    return()=>{document.removeEventListener('keydown',trapFocus);ref.current?.close();if(--locks===0)document.body.style.overflow=originalOverflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[suspended,page]);
  const dialog=<dialog ref={ref} hidden={suspended||page&&pageSuspended(ref.current)} className={'modal '+className+(page?' mobile-page':'')} data-mobile-page={page?title:undefined} aria-labelledby={showHeader?id:undefined} aria-label={showHeader?undefined:title} onCancel={event=>{event.preventDefault();close.current();}} onClick={event=>{if(!page&&event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close.current();}}}>
    {showHeader&&<header className="modal-header">{page&&<button type="button" className="btn btn-icon" aria-label="返回上一级" onClick={onClose}><ArrowLeftIcon size={24}/></button>}<h2 id={id}>{title}</h2>{!page&&<button type="button" className="btn btn-icon" aria-label="关闭" title="关闭 · Esc" onClick={onClose}><XIcon size={22}/></button>}</header>}{children}
  </dialog>;
  return mobilePage?createPortal(dialog,portal):dialog;
}
