import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-menu';
import { DotsThreeIcon } from '@phosphor-icons/react';
import { OPEN_DIALOG } from './ui/layers';
import './action-menu.css';

export type MenuAction = { id: string; label: string; ariaLabel?: string; icon?: ReactNode; disabled?: boolean; hint?: string; danger?: boolean; onSelect?: () => void; href?: string } | { separator: true };

export function ActionMenu({ label, title, subtitle, target, actions, className = '', buttonClassName = 'btn-icon', trigger = <DotsThreeIcon size={24}/> }: {
  label: string; title?: string; subtitle?: string; target: string; actions: MenuAction[]; className?: string; buttonClassName?: string; trigger?: ReactNode;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const anchor = useMemo(() => ({
    current: {
      getBoundingClientRect: () => point
        ? new DOMRect(point.x, point.y, 0, 0)
        : button.current?.getBoundingClientRect() ?? new DOMRect(),
    },
  }), [point]);
  const restore = () => returnTo.current?.isConnected && returnTo.current.focus({ preventScroll: true });
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) restore();
  };

  useEffect(() => {
    const scope = host.current?.closest<HTMLElement>(target);
    if (!scope) return;
    const show = (event: MouseEvent | KeyboardEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!matchMedia('(min-width:761px)').matches || event.defaultPrevented || panel.current?.contains(element) ||
          element?.closest(OPEN_DIALOG) !== scope.closest(OPEN_DIALOG) ||
          element?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      returnTo.current = element?.closest<HTMLElement>('button,a[href],[tabindex]') ?? button.current ?? scope.querySelector('button,a[href]');
      const box = returnTo.current?.getBoundingClientRect() ?? scope.getBoundingClientRect();
      setPoint(event instanceof MouseEvent && (event.clientX || event.clientY)
        ? { x: event.clientX, y: event.clientY }
        : { x: box.left, y: box.bottom });
      setOpen(true);
    };
    scope.addEventListener('contextmenu', show);
    scope.addEventListener('keydown', show);
    return () => {
      scope.removeEventListener('contextmenu', show);
      scope.removeEventListener('keydown', show);
    };
  }, [target]);

  useEffect(() => {
    if (!open) return;
    const scope = host.current?.closest<HTMLElement>(target);
    if (scope) scope.dataset.contextOpen = 'true';
    const initialScroll = [scrollX, scrollY];
    const dismiss = (event: Event) => {
      if (event.type === 'scroll' && panel.current?.contains(event.target as Node)) return;
      if (event.type === 'scroll' && event.target === document &&
          scrollX === initialScroll[0] && scrollY === initialScroll[1]) return;
      setOpen(false);
    };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      if (scope) delete scope.dataset.contextOpen;
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open, target]);

  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <div ref={host} className={'control-popover action-menu ' + className} data-open={open || undefined}>
        <Menu.Anchor virtualRef={anchor} />
        {trigger !== null && (
          <button ref={button} type="button" className={'btn ' + buttonClassName + (open ? ' saved' : '')}
            aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => { if (open) close(true); else { returnTo.current = button.current; setPoint(null); setOpen(true); } }}>
            {trigger}
          </button>
        )}
        <Menu.Content ref={panel} id={id} className="control-popover-panel context-menu floating-menu"
          data-layer="menu" aria-label={label} side="bottom" align={point ? 'start' : 'end'} sideOffset={point ? 0 : 6}
          collisionPadding={12} loop onEntryFocus={event => {
            event.preventDefault();
            panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
          }} onCloseAutoFocus={event => event.preventDefault()}
          onEscapeKeyDown={event => { event.preventDefault(); close(true); }}
          onFocusOutside={event => event.preventDefault()}
          onInteractOutside={event => { if (button.current?.contains(event.target as Node)) event.preventDefault(); }}
          onKeyDownCapture={event => { if (event.key === 'Tab') { event.stopPropagation(); close(true); } }}>
          {title && <div className="context-menu-heading" role="presentation"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>}
          {actions.map((action, index) => {
            if ('separator' in action) return <Menu.Separator asChild key={'separator-' + index}><hr /></Menu.Separator>;
            const content = <><span className="context-menu-icon" aria-hidden="true">{action.icon}</span><span>{action.label}{action.disabled && action.hint && <small>{action.hint}</small>}</span></>;
            // Scrolling an item into view can move the previous item out from under a stationary pointer.
            return <Menu.Item asChild key={action.id} textValue={action.label} aria-label={action.ariaLabel}
              onPointerLeave={event => event.preventDefault()}
              aria-disabled={action.disabled || undefined} title={action.hint} onSelect={event => {
                event.preventDefault();
                if (action.disabled) return;
                close(true);
                action.onSelect?.();
              }}>
              {action.href && !action.disabled
                ? <a href={action.href} target="_blank" rel="noreferrer">{content}</a>
                : <button type="button" className={action.danger ? 'danger-text' : undefined}>{content}</button>}
            </Menu.Item>;
          })}
        </Menu.Content>
      </div>
    </Menu.Root>
  );
}
