import { SpinnerGapIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { errorText } from './api';
import { ControlPopover } from './ControlPopover';
import './discovery-feedback.css';

function issueText(issue: unknown) {
  const code = (issue as { code?: string })?.code;
  if (code === 'network') return '暂时无法更新推荐，请稍后重试。';
  if (code === 'youtube-unavailable') return 'YouTube 视频来源暂不可用，请在设置中检查取源工具。';
  if (code === 'bilibili-authentication') return 'B站登录已过期，可在设置中重新扫码登录。';
  return errorText(issue);
}

export function DiscoveryStatus({ title, issue, loading, onRetry, onCancel }: {
  title: string; issue: unknown; loading: boolean; onRetry?: () => void; onCancel?: () => void;
}) {
  if (!loading && !issue) return null;
  const label = loading ? '正在更新' : '暂未更新';
  return <div className="discovery-status" data-loading={loading || undefined}>
    <span className="sr-only" role="status">{title}：{label}</span>
    <ControlPopover className="discovery-status-popover" side="bottom" buttonClassName="btn-ghost btn-sm" label={title + '：' + label + '，查看详情'} icon={<>{loading ? <SpinnerGapIcon size={16}/> : <WarningCircleIcon size={16}/>}<span>{label}</span></>}>
      <p className="popover-heading">{title} · {loading ? '正在获取新推荐' : '推荐暂未更新'}</p>
      <p className="discovery-status-copy">{loading ? '已有内容可继续浏览，更新完成后会自动替换。' : issueText(issue)}</p>
      {!loading && <p className="discovery-status-copy muted">已保留当前可用的音乐。</p>}
      {loading ? onCancel && <button onClick={onCancel}>取消更新</button> : onRetry && <button onClick={onRetry}>重试更新</button>}
    </ControlPopover>
  </div>;
}

export function DiscoveryUnavailable({ issue, onRetry }: { issue: unknown; onRetry?: () => void }) {
  return <div className="empty discovery-unavailable">
    <WarningCircleIcon size={32}/><h3>暂时无法获取推荐</h3>
    <p role="status">{issueText(issue)}</p>
    {onRetry && <button className="btn btn-secondary" onClick={onRetry}>重新获取推荐</button>}
  </div>;
}
