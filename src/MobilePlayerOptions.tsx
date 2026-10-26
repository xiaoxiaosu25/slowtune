import { useState, type ReactNode } from 'react';
import { DotsThreeIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';

export function MobilePlayerOptions({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <button className={'btn btn-icon' + (open ? ' saved' : '')} aria-label="更多播放选项" aria-expanded={open} onClick={() => setOpen(true)}><DotsThreeIcon size={25}/></button>
    {open && <Modal title="更多播放选项" className="mobile-actions-sheet mobile-player-options" onClose={close}>{children(close)}</Modal>}
  </>;
}
