import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { closeNestedPopover } from './ui/layers';
import { Button, type ButtonProps } from './ui/Button';

export function ControlPopover({ label, icon, children, className = '', buttonVariant = 'icon', compact = false,
  side = 'top', closeOnAction = true, onOpenChange }: {
  label: string; icon: ReactNode; children: ReactNode; className?: string; buttonVariant?: ButtonProps['variant']; compact?: boolean;
  side?: 'top' | 'bottom' | 'left'; closeOnAction?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const change = useCallback((value: boolean) => {
    if (opened.current === value) return;
    opened.current = value;
    setOpen(value);
    changed.current?.(value);
  }, []);
  useEffect(() => () => { if (opened.current) changed.current?.(false); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    const cancel = () => change(false);
    element?.addEventListener('cancel', cancel);
    return () => element?.removeEventListener('cancel', cancel);
  }, [change, open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && !event.target.contains(button.current)) return;
      change(false);
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [change, open]);
  return (
    <Popover.Root open={open} onOpenChange={change}>
      <div className={'control-popover ' + className} data-open={open || undefined}>
        <Popover.Trigger asChild>
          <Button ref={button} variant={buttonVariant} compact={compact} className={open ? 'saved' : undefined} aria-label={label} title={label}>{icon}</Button>
        </Popover.Trigger>
        <Popover.Content ref={panel} className="control-popover-panel floating-control" data-layer="popover"
          role="group" aria-label={label} side={side} align={side === 'left' ? 'center' : 'end'}
          sideOffset={8} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}
          onEscapeKeyDown={event => closeNestedPopover(panel.current, event)}
          onClick={event => {
            const action = (event.target as Element).closest('button');
            if (closeOnAction && action && !action.matches('[popovertarget],[aria-haspopup]')) change(false);
          }}>
          {children}
        </Popover.Content>
      </div>
    </Popover.Root>
  );
}
