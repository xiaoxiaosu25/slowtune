import { SpinnerGapIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ControlPopover } from './ControlPopover';
import './desktop-feedback.css';

type Failure = { id: string; title: string; reason: string };
type PlaybackFeedbackProps = {
  error: string; failures: Failure[]; onRetry: () => void; retryLabel: string;
  onStop: () => void; onDismiss: () => void; onDismissFailures: () => void; preparing: boolean;
};

/** Route one status entry into the active player's or modal's slot, including library dialogs. */
export function PlaybackFeedback(props: PlaybackFeedbackProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const locate = () => {
      const dialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
      const next = dialog ? dialog.querySelector<HTMLElement>('[data-desktop-playback-slot]') : document.querySelector<HTMLElement>('.desktop-lyrics-controls [data-desktop-playback-slot]') ?? document.querySelector<HTMLElement>('.playbar [data-desktop-playback-slot],.listening-transport [data-desktop-playback-slot]');
      setTarget(old => old === next ? old : next);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  if (!target) return null;
  const dialog = target.closest('dialog');
  return createPortal(<>
    {props.preparing && dialog && !dialog.querySelector('.play-toggle') && <button className="btn btn-ghost btn-sm playback-pending" aria-busy="true" onClick={props.onStop}><SpinnerGapIcon size={18}/>取消播放准备</button>}
    <PlaybackIssue {...props}/>
  </>, target);
}

function PlaybackIssue({ error, failures, onRetry, retryLabel, onStop, onDismiss, onDismissFailures }: PlaybackFeedbackProps) {
  if (!error && !failures.length) return null;
  const label = error ? '播放失败' : `${failures.length} 首未能播放`;
  return <div className="desktop-playback-feedback">
    <span className="sr-only" role="status">{label}</span>
    <ControlPopover className="playback-feedback-popover" label={label + '，查看详情'} icon={<><WarningCircleIcon size={19}/><span>{label}</span></>}>
      <p className="popover-heading">播放状态</p>
      {error && <><p className="playback-issue" role="alert">{error}</p><button onClick={onRetry}>{retryLabel}</button><button onClick={onStop}>取消并停止</button><button onClick={onDismiss}>关闭提示</button></>}
      {!!failures.length && <><p className="popover-heading">{failures.length} 首榜单歌曲未能播放</p><ul className="playback-failure-list">{failures.map((item, index) => <li key={item.id + ':' + index}><strong>{item.title}</strong><span>{item.reason}</span></li>)}</ul><button onClick={onDismissFailures}>清除失败记录</button></>}
    </ControlPopover>
  </div>;
}

export function DesktopOperationFeedback({ error, offline, children, onDismiss }: { error: string; offline: boolean; children: ReactNode; onDismiss: () => void }) {
  if (!error && !offline) return null;
  return <aside className="desktop-operation-feedback" aria-label="操作提示">
    <div className="desktop-feedback-heading"><WarningCircleIcon size={20}/><strong>{error ? '操作未完成' : '网络已断开'}</strong>{error && <button className="btn btn-icon" aria-label="关闭操作提示" onClick={onDismiss}><XIcon size={18}/></button>}</div>
    <p role={error ? 'alert' : 'status'}>{error || '资料保留，联网后可重试。'}</p>
    {error && <div className="toolbar">{children}</div>}
  </aside>;
}
