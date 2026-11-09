import type { ReactNode } from 'react';
import { Dialog } from './ui/Dialog';

export function PlaylistNameDialog({ mode, name, busy, onNameChange, onSave, onClose, feedback }: {
  mode: 'new' | 'rename';
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onSave: (name: string) => void;
  onClose: () => void;
  feedback?: ReactNode;
}) {
  const trimmedName = name.trim();
  return (
    <Dialog className="form-modal" title={mode === 'new' ? '新建歌单' : '歌单改名'} onClose={onClose}>
      <form onSubmit={event => {
        event.preventDefault();
        if (trimmedName && !busy) onSave(trimmedName);
      }}>
        <label className="field">
          <span className="field-label">歌单名称</span>
          <input className="input" data-autofocus="true" value={name} maxLength={200} required onChange={event => onNameChange(event.target.value)} />
        </label>
        {feedback}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !trimmedName}>
            {busy ? '保存中…' : '保存歌单'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
