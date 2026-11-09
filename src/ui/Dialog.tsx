import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Root, Portal, Overlay, Content, Title, Close } from '@radix-ui/react-dialog';
import { XIcon } from '@phosphor-icons/react';
import { closeNestedPopover } from './layers';

export function Dialog({ title, onClose, children, className = '', showHeader = true }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  showHeader?: boolean;
}) {
  const [container] = useState(() => document.querySelector<HTMLElement>('.app') ?? document.body);
  const [previous] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = content.current;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Portal container={container}>
        <Overlay className="modal-backdrop" />
        <Content
          ref={content}
          className={'modal ' + className}
          data-layer="dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={event => closeNestedPopover(content.current, event)}
          onOpenAutoFocus={event => {
            event.preventDefault();
            const element = content.current;
            const input = Array.from(element?.querySelectorAll<HTMLElement>('[data-autofocus]:not(:disabled)') ?? [])
              .find(candidate => candidate.getClientRects().length > 0);
            (input ?? element)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => {
            // The menu opens this controlled dialog without a Radix Trigger.
            if (!previous?.isConnected) return;
            event.preventDefault();
            previous.focus({ preventScroll: true });
          }}
        >
          {showHeader ? (
            <header className="modal-header">
              <Title asChild><h2>{title}</h2></Title>
              <Close asChild>
                <button type="button" className="btn btn-icon" aria-label="关闭" title="关闭 · Esc"><XIcon size={22}/></button>
              </Close>
            </header>
          ) : <Title hidden>{title}</Title>}
          {children}
        </Content>
      </Portal>
    </Root>
  );
}
