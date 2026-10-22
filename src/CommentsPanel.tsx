import { useEffect, useRef, useState } from 'react';
import { ChatCircleTextIcon, ThumbsUpIcon, XIcon } from '@phosphor-icons/react';
import { Avatar } from './Avatar';
import { RefreshButton } from './ListActions';
import { cancelled, errorText, request, type Track } from './api';
import type { CommentOrder, CommentPage, VideoComment } from '../server/comment-types';

const merge = (old: VideoComment[], next: VideoComment[]) => [...new Map([...old, ...next].map(item => [item.id, item])).values()];
function path(track: Track, order: CommentOrder, cursor?: string, parent?: string) {
  const params = new URLSearchParams({ provider: track.ref.provider, id: track.ref.id, order });
  if (cursor) params.set('cursor', cursor);
  if (parent) params.set('parent', parent);
  return '/api/comments?' + params;
}
function CommentRow({ comment }: { comment: VideoComment }) {
  return <div className="comment-row"><Avatar artwork={comment.avatar} name={comment.author} className="comment-avatar"/><div className="comment-copy"><div className="comment-author"><strong>{comment.author}</strong>{comment.pinned && <small>置顶</small>}</div><p className="comment-text">{comment.text}</p><div className="comment-meta"><time>{comment.time}</time>{comment.likes !== undefined && <span aria-label={'点赞数 ' + comment.likes}><ThumbsUpIcon size={14}/>{comment.likes}</span>}</div></div></div>;
}
function Replies({ track, order, comment }: { track: Track; order: CommentOrder; comment: VideoComment }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState<CommentPage>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => work.current?.abort(), []);
  const load = async (more = false) => {
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setBusy(true); setError('');
    try {
      const result = await request<CommentPage>(path(track, order, more ? page?.nextCursor : comment.replyCursor, comment.id), undefined, controller.signal);
      if (!controller.signal.aborted) setPage(old => ({ ...result, items: more ? merge(old?.items ?? [], result.items) : result.items }));
    } catch (error) { if (!controller.signal.aborted && !cancelled(error)) setError((error as {code?:string}).code === 'stale-cursor' ? '回复分页已过期，请重新打开评论区。' : errorText(error)); }
    finally { if (work.current === controller) setBusy(false); }
  };
  return <div className="comment-replies"><button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => {
    if (open) { work.current?.abort(); setBusy(false); setOpen(false); }
    else { setOpen(true); if (!page) void load(); }
  }}>{open ? '收起回复' : '展开回复' + (comment.replyCount ? ' · ' + comment.replyCount : '')}</button>{open && <div className="comment-reply-list">
    {page?.items.map(reply => <CommentRow key={reply.id} comment={reply}/>)}
    {busy && <p className="muted" role="status">正在读取回复…</p>}
    {error && <p className="error-text" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => void load(!!page)}>重试回复</button></p>}
    {!busy && !error && page && !page.items.length && <p className="muted">回复暂不可用。</p>}
    {page?.nextCursor && !busy && !error && <button className="btn btn-ghost btn-sm" onClick={() => void load(true)}>加载更多回复</button>}
  </div>}</div>;
}
export function CommentsPanel({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const [order, setOrder] = useState<CommentOrder>('hot'), [page, setPage] = useState<CommentPage>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const work = useRef<AbortController | undefined>(undefined), scroll = useRef<HTMLDivElement>(null);
  const load = async (more = false) => {
    if (!track) return;
    work.current?.abort(); const controller = new AbortController(); work.current = controller;
    setBusy(true); setError('');
    if (!more) { setPage(undefined); scroll.current?.scrollTo(0, 0); }
    try {
      const result = await request<CommentPage>(path(track, order, more ? page?.nextCursor : undefined), undefined, controller.signal);
      if (!controller.signal.aborted) setPage(old => ({ ...result, items: more ? merge(old?.items ?? [], result.items) : result.items }));
    } catch (error) { if (!controller.signal.aborted && !cancelled(error)) setError((error as {code?:string}).code === 'stale-cursor' ? '评论分页已过期，请刷新评论。' : errorText(error)); }
    finally { if (work.current === controller) setBusy(false); }
  };
  useEffect(() => { void load(); return () => work.current?.abort(); }, [track?.ref.provider, track?.ref.id, order]);
  return <aside className="comments-panel" aria-label="视频评论"><div className="comments-heading"><div><h2>评论{page?.total && <small>{/^\d+$/.test(page.total) ? page.total + ' 条' : page.total}</small>}</h2><p title={track?.title}>{track?.title ?? '选择一首音乐查看评论'}</p></div><button className="btn btn-icon" aria-label="关闭评论" title="关闭评论" onClick={onClose}><XIcon size={22}/></button></div>
    {track && <div className="comments-toolbar"><div className="segmented" aria-label="评论排序">{(['hot', 'new'] as const).map(value => <button key={value} className={order === value ? 'selected' : ''} aria-pressed={order === value} onClick={() => setOrder(value)}>{value === 'hot' ? '热门' : '最新'}</button>)}</div><RefreshButton busy={busy} onClick={() => void load()}/></div>}
    <div className="comments-content" ref={scroll}>
      {!track && <div className="comments-empty"><ChatCircleTextIcon size={36}/><p>播放一首音乐后查看原视频评论。</p></div>}
      {page?.items.map(comment => <article className="comment-thread" key={order + ':' + comment.id}><CommentRow comment={comment}/>{comment.replyCursor && track && <Replies track={track} order={order} comment={comment}/>}</article>)}
      {busy && <p className="comments-state" role="status">正在读取评论…</p>}
      {error && <div className="comments-state" role="alert"><p>{error}</p><button className="btn btn-secondary btn-sm" onClick={() => void load(!!page?.nextCursor)}>重试评论</button></div>}
      {!busy && !error && page && !page.items.length && <div className="comments-empty"><ChatCircleTextIcon size={36}/><p>{page.status === 'unavailable' ? '这个视频的评论暂不可用。' : '还没有公开评论。'}</p></div>}
      {page?.nextCursor && !busy && !error && <button className="btn btn-secondary load-more" onClick={() => void load(true)}>加载更多评论</button>}
    </div><div className="comments-footer"><span>{track?.ref.provider === 'bilibili' ? 'B站' : 'YouTube'}原视频评论</span>{track?.ref.provider === 'bilibili' && track.ref.part && <small>各分 P 共用视频评论区</small>}</div>
  </aside>;
}
