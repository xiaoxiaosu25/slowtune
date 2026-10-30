import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Native popovers keep light dismissal, Escape and focus return consistent. */
export function ControlPopover({label,icon,children,className='',buttonClassName='btn-icon',side='top',closeOnAction=true,onOpenChange}:{label:string;icon:ReactNode;children:ReactNode;className?:string;buttonClassName?:string;side?:'top'|'bottom'|'left';closeOnAction?:boolean;onOpenChange?:(open:boolean)=>void}) {
  const id=useId(),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  const changed=useRef(onOpenChange);changed.current=onOpenChange;
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const element=panel.current;
    if(!element)return;
    const place=()=>{
      const anchor=button.current?.getBoundingClientRect();
      if(!anchor)return;
      // Measure at the viewport limit before choosing a side, including on reopen.
      element.style.maxHeight=Math.max(0,window.innerHeight-24)+'px';
      // Closed native popovers have no layout box. Measure before opening so the
      // first painted frame uses the real size, including in a shorter window.
      const measuring=!element.matches(':popover-open'),display=element.style.display,visibility=element.style.visibility;
      if(measuring){element.style.visibility='hidden';element.style.display='block';}
      const bounds=element.getBoundingClientRect(),width=bounds.width||264,height=bounds.height||element.scrollHeight;
      if(measuring){element.style.display=display;element.style.visibility=visibility;}
      if(side==='left'){
        element.style.left=Math.max(12,Math.min(anchor.left-width-10,window.innerWidth-width-12))+'px';
        element.style.top=Math.max(12,Math.min(anchor.top+anchor.height/2-height/2,window.innerHeight-height-12))+'px';element.style.bottom='auto';return;
      }
      const above=Math.max(0,anchor.top-20),below=Math.max(0,window.innerHeight-anchor.bottom-20);
      const openAbove=side==='top'?height<=above||above>=below:height>below&&above>below;
      element.style.maxHeight=(openAbove?above:below)+'px';
      element.style.left=Math.max(12,Math.min(anchor.right-width,window.innerWidth-width-12))+'px';
      if(openAbove) {element.style.top='auto';element.style.bottom=Math.max(12,window.innerHeight-anchor.top+8)+'px';}
      else {element.style.bottom='auto';element.style.top=Math.max(12,anchor.bottom+8)+'px';}
    };
    const before=(event:Event)=>{if((event as ToggleEvent).newState==='open')place();};
    const toggle=(event:Event)=>{const isOpen=(event as ToggleEvent).newState==='open';setOpen(isOpen);if(isOpen)place();changed.current?.(isOpen);};
    // Independent list scrolling does not move this popover's trigger.
    const dismiss=(event:Event)=>{if(event.type==='scroll'&&event.target instanceof Node&&!event.target.contains(button.current))return;if(element.matches(':popover-open'))element.hidePopover();};
    element.addEventListener('beforetoggle',before);element.addEventListener('toggle',toggle);
    const size=new ResizeObserver(()=>{if(element.matches(':popover-open'))place();});size.observe(element);
    window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss,true);
    return()=>{size.disconnect();if(element.matches(':popover-open'))changed.current?.(false);element.removeEventListener('beforetoggle',before);element.removeEventListener('toggle',toggle);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true);};
  },[side]);
  return <div className={'control-popover '+className} data-open={open||undefined}>
    <button ref={button} type="button" className={'btn '+buttonClassName+(open?' saved':'')} aria-label={label} title={label} aria-expanded={open} aria-controls={id} popoverTarget={id}>{icon}</button>
    <div ref={panel} id={id} popover="auto" className="control-popover-panel" aria-label={label} onClick={event=>{const button=(event.target as HTMLElement).closest('button');if(closeOnAction&&button&&!button.hasAttribute('popovertarget'))panel.current?.hidePopover();}}>{children}</div>
  </div>;
}
