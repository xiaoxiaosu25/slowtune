import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';

export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = () => { window.clearTimeout(timer.current); setOpen(true); };
  const dismiss = () => { window.clearTimeout(timer.current); pinned.current = false; setOpen(false); };
  const hide = (delay = 120) => {
    window.clearTimeout(timer.current);
    if (!pinned.current) timer.current = window.setTimeout(dismiss, delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Popover.Root open={open} onOpenChange={value => { if (!value) dismiss(); }}>
      <div className="info" onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }}
        onPointerLeave={() => hide()} onFocus={show}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { pinned.current = false; hide(0); } }}>
        <Popover.Anchor asChild>
          <button ref={button} type="button" className="btn btn-icon btn-icon-xs" aria-label={label}
            aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => { if (pinned.current) dismiss(); else { pinned.current = true; show(); } }}>
            <InfoIcon size={16} />
          </button>
        </Popover.Anchor>
        <Popover.Content id={id} className="info-popover" aria-label={label} side="bottom" align="start"
          sideOffset={8} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => { if (button.current?.contains(event.target as Node)) event.preventDefault(); }}>
          {children}
        </Popover.Content>
      </div>
    </Popover.Root>
  );
}
