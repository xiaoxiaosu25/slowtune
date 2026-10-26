import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CaretDownIcon, CheckIcon, GaugeIcon } from '@phosphor-icons/react';

export function RateControl({ value, onChange, labeled = false }: { value: number; onChange: (rate: number) => void; labeled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const rates = [...new Set([.5, .75, 1, 1.25, 1.5, 1.75, 2, value])].sort((a, b) => a - b);
  useEffect(() => {
    const menu = panel.current;
    if (!menu) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const bounds = menu.getBoundingClientRect(), width = bounds.width || 196;
      const height = bounds.height || menu.querySelectorAll('[role="menuitemradio"]').length * (window.innerWidth <= 760 ? 48 : 40) + 48;
      const above = Math.max(0, anchor.top - 20), below = Math.max(0, window.innerHeight - anchor.bottom - 20);
      const useAbove = above >= height || (below < height && above >= below);
      menu.style.left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)) + 'px';
      menu.style.maxHeight = (useAbove ? above : below) + 'px';
      menu.style.top = useAbove ? 'auto' : anchor.bottom + 8 + 'px';
      menu.style.bottom = useAbove ? window.innerHeight - anchor.top + 8 + 'px' : 'auto';
    };
    const focusChoice = () => {
      if (!menu.matches(':popover-open') || menu.contains(document.activeElement)) return;
      const option = menu.querySelector<HTMLButtonElement>('[aria-checked="true"]');
      option?.focus({ preventScroll: true });
      if (menu.scrollHeight > menu.clientHeight) option?.scrollIntoView({ block: 'nearest' });
    };
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      place();
      // Native toggle events run in a later task; focus before the next keyboard event.
      queueMicrotask(focusChoice);
    };
    const toggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) { place(); focusChoice(); }
    };
    const dismiss = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && !event.target.contains(trigger.current)) return;
      if (menu.matches(':popover-open')) menu.hidePopover();
    };
    menu.addEventListener('beforetoggle', before); menu.addEventListener('toggle', toggle);
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => {
      menu.removeEventListener('beforetoggle', before); menu.removeEventListener('toggle', toggle);
      window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true);
    };
  }, []);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = panel.current;
    if (!menu) return;
    if (event.key === 'Tab') { menu.hidePopover(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const current = options.findIndex(option => option === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  };
  return <div className={'rate-control ' + (labeled ? 'labeled' : '')}>
    <button ref={trigger} type="button" className={'player-setting rate-trigger ' + (value !== 1 ? 'saved' : '')} aria-label="播放速度" aria-description={'当前 ' + value + ' 倍速'} title={'播放速度 · ' + value + '×'} aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} onKeyDown={event => {
      if (event.key === 'Tab' && panel.current?.matches(':popover-open')) { panel.current.hidePopover(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); panel.current?.showPopover();
        panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
      }
    }}>
      <span className="setting-icon"><GaugeIcon size={19} /></span>{labeled && <span className="setting-label">倍速</span>}
      <span className="rate-value"><span className="setting-value">{value}×</span><CaretDownIcon size={12} aria-hidden="true" /></span>
    </button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label="播放速度" className="rate-menu" onKeyDown={navigate} onClick={event => event.stopPropagation()}>
      <p className="rate-menu-heading" aria-hidden="true">播放速度</p>
      {rates.map(rate => <button key={rate} type="button" role="menuitemradio" aria-label={rate + '×'} aria-checked={rate === value} tabIndex={-1} className="rate-option" onClick={() => {
        onChange(rate); panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true });
      }}><span>{rate}×</span>{rate === 1 && <small>正常速度</small>}{rate === value && <CheckIcon size={16} weight="bold" aria-hidden="true" />}</button>)}
    </div>
  </div>;
}
