import { randomUUID } from 'node:crypto';
import { Innertube } from 'youtubei.js';
import { MusicSourceError, type MusicHost } from '@studio/music-sources';
import { signWbi, wbiMixinKey } from '@studio/music-sources/bilibili';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { artworkUrl } from './artwork-url.js';
import type { CommentOrder, CommentPage, CommentProvider, VideoComment } from './comment-types.js';

interface CommentInput { provider: unknown; id: unknown; order?: unknown; parent?: unknown; cursor?: unknown }
interface Target { provider: CommentProvider; id: string; order: CommentOrder; parent?: string }
interface Cursor { binding: string; owner: string; until: number; load: (signal: AbortSignal) => Promise<CommentPage>; result?: CommentPage; busy?: boolean }
interface YoutubeContext { signal: AbortSignal; busy?: boolean }
type YoutubeFactory = (context: YoutubeContext) => Promise<Pick<Innertube, 'getComments'>>;
const string = (value: unknown, max = 200) => value === undefined || value === null ? '' : String(value).trim().slice(0, max);
const rows = (value: unknown): any[] => Array.isArray(value) ? value : [];
const available = (items: VideoComment[], nextCursor?: string, total?: string): CommentPage => ({ items, nextCursor, total, status: 'available' });

function target(input: CommentInput): Target {
  if (!input || !['bilibili', 'youtube'].includes(String(input.provider)) || typeof input.id !== 'string' ||
    !(input.provider === 'bilibili' ? /^BV[\da-zA-Z]{10}$/ : /^[\w-]{11}$/).test(input.id) ||
    input.order !== undefined && !['hot', 'new'].includes(String(input.order)) ||
    input.parent !== undefined && (typeof input.parent !== 'string' || !/^[\w.-]{1,200}$/.test(input.parent)) ||
    input.provider === 'bilibili' && input.parent !== undefined && !/^\d{1,20}$/.test(String(input.parent)) ||
    input.cursor !== undefined && (typeof input.cursor !== 'string' || !/^[\da-f-]{36}$/.test(input.cursor))) throw new LibraryError('invalid-input');
  return { provider: input.provider as CommentProvider, id: input.id, order: (input.order ?? 'hot') as CommentOrder, parent: input.parent as string | undefined };
}

/** Anonymous, read-only platform requests. Opaque cursors are bound to browser, video, sort and thread. */
export class VideoComments {
  private cursors = new Map<string, Cursor>();
  private owners = new Map<AbortController, {owner:string;provider:string}>();
  private work = new Set<Promise<CommentPage>>();
  private stop = new AbortController();
  private signing?: { key: string; until: number };
  constructor(private host: MusicHost, private youtube: YoutubeFactory = context => Innertube.create({
    lang: 'zh-CN', location: 'HK', retrieve_player: false, enable_session_cache: false,
    fetch: (input, options) => host.fetch(input, { ...options, signal: context.signal, redirect: 'error' }),
  })) {}

  private binding(owner: string, value: Target) { return JSON.stringify([owner, value.provider, value.id, value.order, value.parent]); }
  private remember(owner: string, value: Target, load: Cursor['load']) {
    for (const [id, cursor] of this.cursors) if (cursor.until <= this.host.now()) this.cursors.delete(id);
    if (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!);
    const id = randomUUID();
    this.cursors.set(id, { binding: this.binding(owner, value), owner, until: this.host.now() + 600000, load });
    return id;
  }
  read(input: CommentInput, owner: string, requestSignal: AbortSignal): Promise<CommentPage> {
    const value = target(input);
    if (this.stop.signal.aborted) return Promise.reject(new MusicSourceError({ code: 'disposed', retryable: false }));
    const cursor = input.cursor === undefined ? undefined : this.cursors.get(input.cursor as string);
    if (input.cursor !== undefined && (!cursor || cursor.until <= this.host.now() || cursor.binding !== this.binding(owner, value))) return Promise.reject(new MusicSourceError({ code: 'stale-cursor', provider: value.provider, retryable: true }));
    if (value.provider === 'youtube' && value.parent && !cursor) throw new LibraryError('invalid-input');
    if (this.work.size >= 4 || cursor?.busy) return Promise.reject(new MusicSourceError({ code: 'busy', retryable: true }));
    const controller = new AbortController();
    const signal = AbortSignal.any([requestSignal, controller.signal, this.stop.signal, AbortSignal.timeout(25000)]);
    this.owners.set(controller, {owner,provider:value.provider});
    if (cursor) cursor.busy = true;
    const work = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const result = cursor ? cursor.result ?? await cursor.load(signal) : value.provider === 'bilibili' ? await this.bilibili(value, owner, signal) : await this.youtubePage(value, owner, signal);
      signal.throwIfAborted();
      if (cursor) cursor.result = result;
      return result;
    }).catch(error => {
      if (!signal.aborted && (error instanceof MusicSourceError || error instanceof LibraryError)) throw error;
      throw new MusicSourceError({ code: signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' : /fetch|network|connect/i.test(String(error)) ? 'network' : 'upstream', provider: value.provider, retryable: true });
    }).finally(() => { if (cursor) cursor.busy = false; this.work.delete(work); this.owners.delete(controller); });
    this.work.add(work);
    return work;
  }
  private async biliEnvelope(path: string, query: string, signal: AbortSignal) {
    const response = await this.host.fetch(`https://api.bilibili.com${path}?${query}`, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' } });
    if (!response.ok) { await response.body?.cancel(); throw new MusicSourceError({ code: response.status === 429 ? 'rate-limited' : [403, 412].includes(response.status) ? 'restricted' : 'upstream', provider: 'bilibili', retryable: true }); }
    const reader = response.body?.getReader(); if (!reader) throw new MusicSourceError({ code: 'upstream', retryable: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new MusicSourceError({ code: 'upstream', retryable: true }); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); signal.throwIfAborted();
    return result;
  }
  private async bili(path: string, params: Record<string, string>, signal: AbortSignal, signed = false) {
    let query = new URLSearchParams(params).toString();
    if (signed) {
      if (!this.host.md5) throw new MusicSourceError({ code: 'unsupported', provider: 'bilibili', retryable: false });
      if (!this.signing || this.signing.until <= this.host.now()) {
        const nav = await this.biliEnvelope('/x/web-interface/nav', '', signal), images = nav.data?.wbi_img;
        if (typeof images?.img_url !== 'string' || typeof images?.sub_url !== 'string') throw new MusicSourceError({ code: 'upstream', provider: 'bilibili', retryable: true });
        this.signing = { key: wbiMixinKey(images.img_url, images.sub_url), until: this.host.now() + 3600000 };
      }
      query = await signWbi(params, this.signing.key, this.host.now(), this.host.md5);
    }
    const result = await this.biliEnvelope(path, query, signal);
    if (signed && result.code !== 0) this.signing = undefined;
    if (result.code === 12002) return undefined;
    if (result.code !== 0) throw new MusicSourceError({ code: [-403, -352, -412].includes(result.code) ? 'restricted' : result.code === -509 ? 'rate-limited' : [-404, 62002].includes(result.code) ? 'not-found' : 'upstream', provider: 'bilibili', retryable: true });
    if (!result.data || typeof result.data !== 'object') throw new MusicSourceError({ code: 'upstream', retryable: true });
    return result.data;
  }
  private async bilibili(value: Target, owner: string, signal: AbortSignal, aid?: string, page = 1, offset = ''): Promise<CommentPage> {
    if (!aid) {
      const video = await this.bili('/x/web-interface/view', { bvid: value.id }, signal);
      if (!Number.isSafeInteger(video?.aid) || video.aid <= 0) throw new MusicSourceError({ code: 'upstream', retryable: true });
      aid = String(video.aid);
    }
    const data = value.parent ? await this.bili('/x/v2/reply/reply', { type: '1', oid: aid, pn: String(page), ps: '20', root: value.parent }, signal) : await this.bili('/x/v2/reply/wbi/main', { type: '1', oid: aid, mode: value.order === 'hot' ? '3' : '2', pagination_str: JSON.stringify({ offset }), plat: '1', web_location: '1315875' }, signal, true);
    if (!data) return { items: [], status: 'unavailable' };
    const total = value.parent ? data.page?.count : data.cursor?.all_count;
    if (!Number.isFinite(total) || !value.parent && typeof data.cursor?.is_end !== 'boolean') throw new MusicSourceError({ code: 'upstream', retryable: true });
    const pinned = !value.parent && page === 1 ? [...rows(data.top_replies), data.top?.upper, data.top?.admin] : [];
    const replies = [...pinned, ...rows(data.replies)];
    const seen = new Set<string>();
    const items = replies.flatMap(reply => {
      const id = string(reply?.rpid_str ?? reply?.rpid);
      if (!/^\d+$/.test(id) || seen.has(id) || typeof reply?.content?.message !== 'string') return [];
      seen.add(id);
      const count = typeof reply.rcount === 'number' ? reply.rcount : 0;
      const comment: VideoComment = { id, author: string(reply.member?.uname) || '用户', avatar: artworkUrl(reply.member?.avatar), text: reply.content.message.slice(0, 20000), time: typeof reply.ctime === 'number' ? new Date(reply.ctime * 1000).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '', likes: typeof reply.like === 'number' ? String(reply.like) : undefined, pinned: pinned.includes(reply) };
      if (!value.parent && count > 0) { comment.replyCount = String(count); comment.replyCursor = this.remember(owner, { ...value, parent: id }, next => this.bilibili({ ...value, parent: id }, owner, next, aid)); }
      return [comment];
    });
    const nextOffset = string(data.cursor?.pagination_reply?.next_offset, 2048);
    const hasMore = value.parent ? rows(data.replies).length > 0 && page * Number(data.page.size ?? 20) < total : !data.cursor.is_end && !!nextOffset;
    if (!value.parent && !data.cursor.is_end && !nextOffset || rows(data.replies).length && !items.length) throw new MusicSourceError({ code: 'upstream', provider: 'bilibili', retryable: true });
    return available(items, hasMore ? this.remember(owner, value, next => this.bilibili(value, owner, next, aid, page + 1, nextOffset)) : undefined, String(total));
  }
  private async youtubePage(value: Target, owner: string, signal: AbortSignal): Promise<CommentPage> {
    const context: YoutubeContext = { signal };
    // Continuations reuse the library session; each request supplies its own live abort signal.
    const session = await this.youtube(context);
    try {
      const feed = await session.getComments(value.id, value.order === 'hot' ? 'TOP_COMMENTS' : 'NEWEST_FIRST');
      signal.throwIfAborted();
      return this.youtubeResult(feed, value, owner, context);
    } catch (error) {
      signal.throwIfAborted();
      if (/comments page did not have any content/i.test(String(error))) return { items: [], status: 'unavailable' };
      throw error;
    }
  }
  private async youtubeMore(context: YoutubeContext, signal: AbortSignal, load: () => Promise<CommentPage>) {
    if (context.busy) throw new MusicSourceError({ code: 'busy', provider: 'youtube', retryable: true });
    context.busy = true; context.signal = signal;
    try { return await load(); } finally { context.busy = false; }
  }
  private youtubeResult(feed: any, value: Target, owner: string, context: YoutubeContext): CommentPage {
    context.signal.throwIfAborted();
    const threads = rows(value.parent ? feed.replies ?? feed.contents : feed.contents);
    const items = threads.slice(0, 100).flatMap(thread => {
      const comment = thread.comment ?? thread;
      const id = string(comment?.comment_id), text = string(comment?.content, 20000);
      if (!id || !text) return [];
      const item: VideoComment = { id, author: string(comment.author?.name) || '用户', avatar: artworkUrl(comment.author?.avatar_thumbnail_url ?? comment.author?.thumbnails?.[0]?.url), text, time: string(comment.published_time), likes: string(comment.like_count) || undefined, pinned: comment.is_pinned === true };
      if (!value.parent && thread.has_replies) { item.replyCount = string(comment.reply_count) || undefined; item.replyCursor = this.remember(owner, { ...value, parent: id }, signal => this.youtubeMore(context, signal, async () => { const replies = await thread.getReplies(); signal.throwIfAborted(); return this.youtubeResult(replies, { ...value, parent: id }, owner, context); })); }
      return [item];
    });
    if (threads.length && !items.length || !value.parent && !feed.header && !threads.length) throw new MusicSourceError({ code: 'upstream', provider: 'youtube', retryable: true });
    return available(items, feed.has_continuation ? this.remember(owner, value, signal => this.youtubeMore(context, signal, async () => { const next = await feed.getContinuation(); signal.throwIfAborted(); return this.youtubeResult(next, value, owner, context); })) : undefined, value.parent ? undefined : string(feed.header?.count ?? feed.header?.comments_count) || undefined);
  }
  cancelOwner(owner: string) { for (const [controller, scope] of this.owners) if (scope.owner === owner) controller.abort(); for (const [id, cursor] of this.cursors) if (cursor.owner === owner) this.cursors.delete(id); }
  cancelProvider(provider:string){for(const [controller,scope]of this.owners)if(scope.provider===provider)controller.abort();for(const [id,cursor]of this.cursors)if(JSON.parse(cursor.binding)[1]===provider)this.cursors.delete(id);}
  async dispose() { this.stop.abort(); await Promise.allSettled(this.work); this.cursors.clear(); }
}
