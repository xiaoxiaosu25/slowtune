import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DotsThreeIcon } from '@phosphor-icons/react';
import './action-menu.css';

export type MenuAction = { id: string; label: string; ariaLabel?: string; icon?: ReactNode; disabled?: boolean; hint?: string; danger?: boolean; onSelect?: () => void; href?: string } | { separator: true };

/** One action list for the visible More button, right click and keyboard menu key. */
export function ActionMenu({ label, title, subtitle, target, actions, className = '', buttonClassName = 'btn-icon', trigger = <DotsThreeIcon size={24}/> }: {
  label: string; title?: string; subtitle?: string; target: string; actions: MenuAction[]; className?: string; buttonClassName?: string; trigger?: ReactNode;
}) {
  const id = useId(), host = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null), returnTo = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const menu = panel.current, scope = host.current?.closest<HTMLElement>(target);
    if (!menu || !scope) return;
    const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const place = () => {
      const bounds = button.current?.getBoundingClientRect() ?? scope.getBoundingClientRect();
      menu.style.maxHeight = Math.max(0, innerHeight - 24) + 'px';
      const { width, height } = menu.getBoundingClientRect(), point = anchor.current;
      const x = point?.x ?? bounds.right - width, y = point?.y ?? bounds.bottom + 6;
      menu.style.left = Math.max(12, Math.min(x, innerWidth - width - 12)) + 'px';
      menu.style.top = Math.max(12, Math.min(y, innerHeight - height - 12)) + 'px';
    };
    const close = (restore = false) => {
      if (!menu.matches(':popover-open')) return;
      menu.hidePopover();
      if (restore && returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true });
    };
    const show = (event: MouseEvent | KeyboardEvent) => {
      if (!matchMedia('(min-width:761px)').matches || event.defaultPrevented || menu.contains(event.target as Node)) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('dialog') !== scope.closest('dialog') || element?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault(); event.stopPropagation();
      const focused = element?.closest<HTMLElement>('button,a[href],[tabindex]');
      returnTo.current = focused ?? button.current ?? scope.querySelector<HTMLElement>('button,a[href]');
      const rect = returnTo.current?.getBoundingClientRect() ?? scope.getBoundingClientRect();
      anchor.current = event instanceof MouseEvent && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom };
      flushSync(() => setOpen(true));
      menu.showPopover(); place(); menu.scrollTop = 0; items()[0]?.focus({ preventScroll: true });
    };
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      if (!anchor.current) returnTo.current = button.current;
    };
    const toggle = () => {
      const shown = menu.matches(':popover-open'); setOpen(shown);
      if (shown) { scope.dataset.contextOpen = 'true'; place(); }
      else { delete scope.dataset.contextOpen; anchor.current = null; }
    };
    const keys = (event: KeyboardEvent) => {
      if (!menu.matches(':popover-open')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') { close(true); event.stopPropagation(); return; }
      const choices = items(), index = choices.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % choices.length : event.key === 'ArrowUp' ? (index - 1 + choices.length) % choices.length : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); choices[next]?.focus(); }
      if (event.key === ' ' && document.activeElement instanceof HTMLAnchorElement) { event.preventDefault(); document.activeElement.click(); }
    };
    const dismiss = (event: Event) => { if (event.type === 'scroll' && menu.contains(event.target as Node)) return; close(); };
    const trigger = button.current;
    const activate = (event: MouseEvent) => {
      event.preventDefault();
      if (menu.matches(':popover-open')) { close(true); return; }
      anchor.current = null; returnTo.current = trigger;
      flushSync(() => setOpen(true));
      menu.showPopover(); place(); menu.scrollTop = 0; items()[0]?.focus({ preventScroll: true });
    };
    trigger?.addEventListener('click', activate);
    scope.addEventListener('contextmenu', show); scope.addEventListener('keydown', show);
    menu.addEventListener('beforetoggle', before); menu.addEventListener('toggle', toggle); menu.addEventListener('keydown', keys);
    window.addEventListener('scroll', dismiss, true); window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss);
    return () => {
      delete scope.dataset.contextOpen;
      trigger?.removeEventListener('click', activate);
      scope.removeEventListener('contextmenu', show); scope.removeEventListener('keydown', show);
      menu.removeEventListener('beforetoggle', before); menu.removeEventListener('toggle', toggle); menu.removeEventListener('keydown', keys);
      window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss);
    };
  }, [target]);
  const select = (action: Exclude<MenuAction, { separator: true }>, event: React.MouseEvent) => {
    if (action.disabled) { event.preventDefault(); return; }
    // Restore before opening another dialog so its own focus return has the right origin.
    panel.current?.hidePopover();
    if (returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true });
    action.onSelect?.();
  };
  const content = (action: Exclude<MenuAction, { separator: true }>) => <><span className="context-menu-icon" aria-hidden="true">{action.icon}</span><span>{action.label}{action.disabled && action.hint && <small>{action.hint}</small>}</span></>;
  return <div ref={host} className={'control-popover action-menu ' + className} data-open={open || undefined}>
    {trigger !== null && <button ref={button} type="button" className={'btn ' + buttonClassName + (open ? ' saved' : '')} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} onClick={() => { anchor.current = null; returnTo.current = button.current; }}>{trigger}</button>}
    <div ref={panel} id={id} popover="auto" role="menu" aria-label={label} className="control-popover-panel context-menu">
      {open && <>{title && <div className="context-menu-heading" role="presentation"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>}
      {actions.map((action, index) => 'separator' in action ? <hr key={'separator-' + index} role="separator"/> : action.href && !action.disabled ? <a key={action.id} role="menuitem" aria-label={action.ariaLabel} tabIndex={-1} href={action.href} target="_blank" rel="noreferrer" onClick={event => select(action, event)}>{content(action)}</a> : <button key={action.id} type="button" role="menuitem" aria-label={action.ariaLabel} tabIndex={-1} aria-disabled={action.disabled || undefined} title={action.hint} className={action.danger ? 'danger-text' : undefined} onClick={event => select(action, event)}>{content(action)}</button>)}</>}
    </div>
  </div>;
}
