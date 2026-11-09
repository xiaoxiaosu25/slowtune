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
        <button type="button" className="btn btn-ghost" data-autofocus="true" onClick={onClose}>取消</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>确认删除</button>
      </div>
    </Dialog>
  );
}
