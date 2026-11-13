import { Button } from './ui/Button';
import type { ReactNode } from 'react';
import { Dialog } from './ui/Dialog';

export function PlaylistDeleteDialog({ children, feedback, busy, onClose, onConfirm, className }: {
  children: ReactNode;
  feedback?: ReactNode;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  className?: string;
}) {
  return (
    <Dialog title="删除歌单" className={className} onClose={onClose}>
      <p>{children}</p>
      {feedback}
      <div className="modal-actions">
        <Button variant="ghost" type="button"  data-autofocus="true" onClick={onClose}>取消</Button>
        <Button variant="danger" type="button"  disabled={busy} onClick={onConfirm}>确认删除</Button>
      </div>
    </Dialog>
  );
}
