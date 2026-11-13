import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Root, Portal, Overlay, Content, Title } from '@radix-ui/react-dialog';
import { closeNestedPopover } from './layers';
import { DialogHeader } from './DialogHeader';

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
            <DialogHeader heading={<Title asChild><h2>{title}</h2></Title>} onClose={onClose} />
          ) : <Title hidden>{title}</Title>}
          {children}
        </Content>
      </Portal>
    </Root>
  );
}
