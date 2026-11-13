import { Button } from './ui/Button';
import { useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';

export function PlayingTitle({ title, fullTitle = title, details }: { title?: string; fullTitle?: string; details?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <h2 title={fullTitle}>{title ? <Button variant="plain" type="button" className="playing-title-trigger" title="查看完整标题" aria-label={'查看完整标题：' + fullTitle} aria-haspopup="dialog" onClick={() => setExpanded(true)}>{title}</Button> : '选择一首音乐开始听'}</h2>
    {expanded && <Dialog title="完整标题" className="playing-title-modal" onClose={() => setExpanded(false)}>
      <p className="playing-full-title" dir="auto">{fullTitle}</p>
      {details}
    </Dialog>}
  </>;
}
