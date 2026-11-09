import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DotsThreeIcon, XIcon } from '@phosphor-icons/react';
import { Drawer } from 'vaul';
import { closeNestedPopover } from './ui/layers';

export function MobilePlayerOptions({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [container] = useState(() => document.querySelector<HTMLElement>('.app') ?? document.body);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    if (!open) return;
    const element = content.current;
    element?.addEventListener('cancel', close);
    return () => element?.removeEventListener('cancel', close);
  }, [open]);
  return <>
    <button ref={trigger} className={'btn btn-icon' + (open ? ' saved' : '')} aria-label="更多播放选项" aria-expanded={open} onClick={() => setOpen(true)}><DotsThreeIcon size={25}/></button>
    {open && <Drawer.Root open autoFocus handleOnly noBodyStyles repositionInputs={false} container={container} onOpenChange={setOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="modal-backdrop mobile-drawer-backdrop" />
        <Drawer.Content ref={content} className="modal mobile-actions-sheet mobile-player-options mobile-drawer"
          data-layer="dialog" aria-describedby={undefined} onEscapeKeyDown={event => closeNestedPopover(content.current, event)}
          onCloseAutoFocus={event => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}>
          <Drawer.Handle className="mobile-drawer-handle" aria-hidden="true" />
          <header className="modal-header">
            <Drawer.Title>更多播放选项</Drawer.Title>
            <Drawer.Close asChild><button type="button" className="btn btn-icon" aria-label="关闭"><XIcon size={22} /></button></Drawer.Close>
          </header>
          {children(close)}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>}
  </>;
}
