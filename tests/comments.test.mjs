import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNodeHost } from '@studio/music-sources/node';
const { VideoComments } = await import(pathToFileURL(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.'), 'dist/server/comments.js')));
const signal = () => new AbortController().signal;
const bili = { provider: 'bilibili', id: 'BV1tX4y1W7Xm', order: 'hot' };
const yt = { provider: 'youtube', id: 'kK0CRZ0wvvc', order: 'hot' };

test('Bilibili comments use video aid, preserve text and identities, and scope retryable cursors', async () => {
  let now = 1000, fail = true;
  const calls = [];
  const service = new VideoComments(createNodeHost({ now: () => now, fetch: async (input, options) => {
    const url = new URL(input); calls.push(url);
    assert.equal(options.method, undefined); assert.equal(new Headers(options.headers).has('Cookie'), false);
    if (url.pathname.endsWith('/nav')) return Response.json({ code: -101, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
    if (url.pathname.endsWith('/view')) return Response.json({ code: 0, data: { aid: 321 } });
    assert.equal(url.searchParams.get('oid'), '321');
    const second = url.searchParams.get('pagination_str') && JSON.parse(url.searchParams.get('pagination_str')).offset === 'page2';
    if (second && fail) { fail = false; return Response.json({ code: -352 }); }
    if (!url.pathname.endsWith('/reply/reply')) { assert(url.searchParams.get('w_rid')); assert.equal(url.searchParams.get('mode'), '3'); }
    const reply = { rpid_str: '99999999999999999', content: { message: '<script>literal</script>\n第二行' }, member: { uname: '读者', avatar: 'http://i0.hdslb.com/avatar.jpg' }, ctime: 1700000000, like: 12, rcount: 2 };
    return Response.json({ code: 0, data: { page: { count: 1, size: 20 }, cursor: { all_count: 21, is_end: !!second, pagination_reply: { next_offset: second ? '' : 'page2' } }, replies: [reply], top: { upper: reply } } });
  } }));
  try {
    const first = await service.read(bili, 'a', signal());
    assert.equal(first.items.length, 1, 'pinned comments deduplicate by upstream identity');
    assert.equal(first.items[0].id, '99999999999999999');
    assert.equal(first.items[0].text, '<script>literal</script>\n第二行');
    assert.match(first.items[0].avatar, /^https:/); assert(first.nextCursor); assert(first.items[0].replyCursor);
    for (const input of [{ ...bili, order: 'new' }, { ...bili, id: 'BV1234567890' }, { ...bili, parent: first.items[0].id }]) await assert.rejects(service.read({ ...input, cursor: first.nextCursor }, 'a', signal()), { code: 'stale-cursor' });
    await assert.rejects(service.read({ ...bili, cursor: first.nextCursor }, 'other', signal()), { code: 'stale-cursor' });
    await assert.rejects(service.read({ ...bili, cursor: first.nextCursor }, 'a', signal()), { code: 'restricted' });
    const second = await service.read({ ...bili, cursor: first.nextCursor }, 'a', signal()); assert.equal(second.nextCursor, undefined);
    const count = calls.length; assert.deepEqual(await service.read({ ...bili, cursor: first.nextCursor }, 'a', signal()), second); assert.equal(calls.length, count, 'replayed cursor never advances another page');
    const replies = await service.read({ ...bili, parent: first.items[0].id, cursor: first.items[0].replyCursor }, 'a', signal()); assert.equal(replies.items[0].replyCursor, undefined);
    now += 600001; await assert.rejects(service.read({ ...bili, cursor: first.nextCursor }, 'a', signal()), { code: 'stale-cursor' });
    for (const input of [{ ...bili, id: '../bad' }, { ...bili, order: 'random' }, { ...bili, parent: 'foreign' }, { ...yt, parent: 'thread' }]) assert.throws(() => service.read(input, 'a', signal()), { code: 'invalid-input' });
  } finally { await service.dispose(); }
});

test('YouTube pagination and reply continuations renew cancellation context and preserve native counts', async () => {
  let context, firstSignal, sort;
  const comment = id => ({ comment_id: id, author: { name: '@作者', thumbnails: [{ url: 'https://yt3.ggpht.com/avatar' }] }, content: { toString: () => '评论 ' + id }, published_time: '2年前', like_count: '1.2万', reply_count: '15' });
  const thread = { comment: comment('top'), has_replies: true, getReplies: async () => { assert.notEqual(context.signal, firstSignal); assert.equal(context.signal.aborted, false); return { replies: [{ comment: comment('reply') }], has_continuation: false }; } };
  const feed = { header: { count: '2 条评论' }, contents: [thread], has_continuation: true, getContinuation: async () => { assert.equal(context.signal.aborted, false); return { header: { count: '2 条评论' }, contents: [{ comment: comment('next') }], has_continuation: false }; } };
  const service = new VideoComments(createNodeHost(), async value => { context = value; firstSignal = value.signal; return { getComments: async (_id, order) => { sort = order; return feed; } }; });
  try {
    const controller = new AbortController(); const first = await service.read({ ...yt, order: 'new' }, 'a', controller.signal); controller.abort();
    assert.equal(sort, 'NEWEST_FIRST'); assert.equal(first.items[0].likes, '1.2万');
    const second = await service.read({ ...yt, order: 'new', cursor: first.nextCursor }, 'a', signal()); assert.equal(second.items[0].id, 'next');
    const replies = await service.read({ ...yt, order: 'new', parent: 'top', cursor: first.items[0].replyCursor }, 'a', signal()); assert.equal(replies.items[0].id, 'reply');
    service.cancelOwner('a'); await assert.rejects(service.read({ ...yt, order: 'new', cursor: first.nextCursor }, 'a', signal()), { code: 'stale-cursor' });
  } finally { await service.dispose(); }
});

test('closing the service or logging out cancels upstream reads; unavailable comments remain distinct from failures', async () => {
  let started;
  const ready = new Promise(resolve => started = resolve);
  const service = new VideoComments(createNodeHost(), async context => ({ getComments: async () => {
    started(); await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
  } }));
  const pending = service.read(yt, 'a', signal()); const rejected = assert.rejects(pending, { code: 'cancelled' }); await ready; service.cancelOwner('a'); await rejected; await service.dispose();
  await assert.rejects(service.read(yt, 'a', signal()), { code: 'disposed' });
  const unavailable = new VideoComments(createNodeHost(), async () => ({ getComments: async () => { throw new Error('The comments page did not have any content'); } }));
  assert.deepEqual(await unavailable.read(yt, 'a', signal()), { items: [], status: 'unavailable' }); await unavailable.dispose();
});
