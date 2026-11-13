import type { ReactNode } from 'react';
import { DismissButton } from './Button';

/** Native dialogs, Radix dialogs and mobile drawers share the same dismiss target. */
export function DialogHeader({ heading, onClose, back = false }: { heading: ReactNode; onClose: () => void; back?: boolean }) {
  return <header className="modal-header">
    {back && <DismissButton action="back" onClick={onClose} />}
    {heading}
    {!back && <DismissButton title="关闭 · Esc" onClick={onClose} />}
  </header>;
}
