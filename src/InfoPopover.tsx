import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';

/**
 * 行内说明入口：悬停显示、键盘聚焦显示、点按锁定，供栏目把解释与来源链接收进弹层。
 * 触屏没有悬停，所以按钮本身必须可点按；弹层内链接可点击、文字可选中。
 */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const wrap = useRef<HTMLSpanElement>(null);
  const show = () => { window.clearTimeout(timer.current); setOpen(true); };
  const hide = (delay = 120) => { window.clearTimeout(timer.current); if (pinned.current) return; timer.current = window.setTimeout(() => setOpen(false), delay); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) { pinned.current = false; setOpen(false); } };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { pinned.current = false; setOpen(false); } };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);
  return <span className="info" ref={wrap} onPointerEnter={show} onPointerLeave={() => hide()} onFocus={show} onBlur={event => { if (!wrap.current?.contains(event.relatedTarget as Node)) { pinned.current = false; hide(0); } }}>
    <button type="button" className="btn btn-icon btn-icon-xs" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}><InfoIcon size={16}/></button>
    <span className="info-popover" id={id} role="dialog" aria-label={label} hidden={!open}>{children}</span>
  </span>;
}
