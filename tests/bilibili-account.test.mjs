import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MusicSources } from '@studio/music-sources';
import { BilibiliCredentials } from '../dist/server/bilibili-credentials.js';
import { BilibiliAccounts } from '../dist/server/bilibili-accounts.js';
import { AccountBilibiliProvider } from '../dist/server/bilibili-recommendations.js';

const signal = () => new AbortController().signal;
const videoId = n => 'BV' + String(n).padStart(10, '0');

test('logging out cancels QR generation and lets another browser begin immediately', async t => {
  let started, generationSignal, generations = 0;
  const generating = new Promise(resolve => { started = resolve; });
  const credentials = { ref: 'bilibili:generation-test', write: async () => assert.fail('generation must not save credentials') };
  const api = new MusicSources({ now: Date.now, credentials, fetch: async (_input, options) => {
    generations++;
    if (generations === 1) {
      generationSignal = options.signal;
      started();
      await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    }
    return Response.json({ code: 0, data: { qrcode_key: 'fixture-key', url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixture-key' } });
  } }, { bilibili: new AccountBilibiliProvider() });
  t.after(() => api.dispose());
  const accounts = new BilibiliAccounts(api, credentials, async () => {});
  const first = accounts.begin('browser-a', signal()).catch(error => error);
  await generating;
  await accounts.cancelOwner('browser-b');
  assert.equal(generationSignal.aborted, false, 'another browser cannot cancel the owner’s generation');
  await accounts.cancelOwner('browser-a');
  assert.equal(generationSignal.aborted, true);
  assert.equal((await first).code, 'cancelled');
  const next = await accounts.begin('browser-b', signal());
  assert.equal(next.method, 'qr');
  await accounts.cancelOwner('browser-b');
});

test('a QR response arriving after logout is cancelled instead of becoming pending', async () => {
  let release, generationSignal, generations = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const cancellations = [];
  const api = {
    beginLogin: async (_provider, options) => {
      const id = 'challenge-' + (++generations);
      if (generations === 1) { generationSignal = options.signal; await waiting; }
      return { id, method: 'qr', expiresAt: Date.now() + 180000 };
    },
    cancelLogin: async (_provider, id) => { cancellations.push(id); },
  };
  const accounts = new BilibiliAccounts(api, { ref: 'bilibili:generation-test' }, async () => {});
  const first = accounts.begin('browser-a', signal()).catch(error => error);
  const cancelling = accounts.cancelOwner('browser-a');
  const aborted = generationSignal.aborted;
  release();
  await cancelling;
  const result = await first;
  assert.equal(aborted, true);
  assert.equal(result.code, 'cancelled');
  assert.deepEqual(cancellations, ['challenge-1']);
  assert.equal((await accounts.begin('browser-b', signal())).id, 'challenge-2');
  await accounts.cancelOwner('browser-b');
});

test('B站登录: encrypted restart, challenge ownership, account feed, expiry and disconnect', { skip: process.platform !== 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'music-bilibili-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'account.dpapi.json'), ref = 'bilibili:test-personal';
  const credentials = await new BilibiliCredentials(file, ref).open();
  let time = Date.now(), pollState = 'scanned', blocked, blockedStarted;
  let accountValid = true, feedPage = 0;
  const calls = [], revoked = [];
  const json = data => Response.json({ code: 0, data });
  const fetcher = async (input, options = {}) => {
    const url = new URL(input), cookie = new Headers(options.headers).get('Cookie') ?? '';
    calls.push({ path: url.pathname, query: url.searchParams, cookie });
    if (url.pathname.endsWith('/qrcode/generate')) return json({ qrcode_key: 'fixture-key', url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=fixture-key' });
    if (url.pathname.endsWith('/qrcode/poll')) {
      if (pollState === 'blocked') {
        blockedStarted?.();
        await new Promise((resolve, reject) => { blocked = resolve; options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); });
      }
      if (pollState === 'scanned') return json({ code: 86090 });
      const response = json({ code: 0 });
      response.headers.append('Set-Cookie', 'SESSDATA=fixture-private-session; Path=/; HttpOnly');
      response.headers.append('Set-Cookie', 'bili_jct=fixture-private-csrf; Path=/');
      return response;
    }
    if (url.pathname === '/x/web-interface/nav') {
      if (cookie && !accountValid) return Response.json({ code: -101 });
      return json({ isLogin: !!cookie, mid: 123, uname: '测试音乐账号', face:'http://i0.hdslb.com/bfs/face/account-avatar.jpg', wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } });
    }
    if (url.pathname === '/x/web-interface/wbi/index/top/feed/rcmd') {
      assert(cookie.includes('fixture-private-session'), 'account recommendations must carry the account cookie');
      feedPage++;
      return json({ item: [1, 2, ...(feedPage > 3 ? [3] : [])].map(n => ({ goto: 'av', bvid: videoId(n), id: n, title: n === 2 ? '音乐游戏介绍' : '音乐单曲 ' + n })) .concat({ goto: 'live', bvid: videoId(4) }, { goto: 'av', bvid: videoId(5), business_info: { promotion: true } }) });
    }
    if (url.pathname === '/x/web-interface/view') {
      const n = Number(url.searchParams.get('bvid').slice(2));
      return json({ bvid: videoId(n), title: '单曲 ' + n, tid: n === 2 ? 17 : 31, tname: n === 2 ? '单机游戏' : '翻唱', owner: { name: '音乐UP', mid: 123 }, pages: [{ cid: n + 100, duration: 200 }] });
    }
    assert.equal(cookie, '', 'public charts and new music do not need an account cookie');
    if (url.pathname.endsWith('/region/feed/rcmd')) return json({ archives: [] });
    if (url.pathname.endsWith('/toplist/all_period')) return json({list:{2026:[{ID:439,priod:226,publish_time:1791540001}]}});
    if (url.pathname.endsWith('/toplist/music_list')) return json({list:[]});
    if (url.pathname.endsWith('/music/hot/rank') || url.pathname.endsWith('/new/music')) return json({ list: [] });
    throw new Error('Unexpected endpoint: ' + url.pathname);
  };
  const provider = new AccountBilibiliProvider();
  const api = new MusicSources({ fetch: fetcher, now: () => time, md5: value => createHash('md5').update(value).digest('hex'), credentials }, { bilibili: provider });
  t.after(() => api.dispose());
  const accounts = new BilibiliAccounts(api, credentials, async value => { revoked.push(value); });
  assert.equal((await accounts.status(signal())).state, 'anonymous');
  assert.equal(accounts.options().credentialRef, undefined);
  const challenge = await accounts.begin('browser-a', signal());
  await assert.rejects(accounts.begin('browser-b', signal()), { code: 'busy' });
  await assert.rejects(accounts.poll('browser-b', challenge.id, signal()), { code: 'expired' });
  assert.equal((await accounts.poll('browser-a', challenge.id, signal())).state, 'scanned');
  time += 2001; pollState = 'authenticated';
  const logged = await accounts.poll('browser-a', challenge.id, signal());
  assert.equal(logged.state, 'authenticated');
  assert.equal(logged.account.artwork,'https://i0.hdslb.com/bfs/face/account-avatar.jpg');
  const status = await accounts.status(signal());
  assert.equal(status.account.name, '测试音乐账号');
  assert.equal(status.account.artwork,'https://i0.hdslb.com/bfs/face/account-avatar.jpg');
  assert(!JSON.stringify([challenge, logged, status]).includes('fixture-private-session'), 'public results contain no cookies');
  const encrypted = await readFile(file, 'utf8');
  assert(!encrypted.includes('fixture-private-session'));
  assert(!encrypted.includes('fixture-private-csrf'));
  const restored = await new BilibiliCredentials(file, ref).open();
  assert.equal((await restored.read(ref, signal())).cookie, (await credentials.read(ref, signal())).cookie);
  assert.equal(restored.loadFailed, false);
  await assert.rejects(restored.read('another-user', signal()), { code: 'authentication' });
  const first = await api.discover('bilibili', accounts.options(signal()));
  assert.equal(first[0].id, 'account-recommendation');
  assert.deepEqual(first[0].page.items.map(item => item.ref.id), [videoId(1)]);
  assert.equal(first.length,1,'account discovery returns only the recommendation shelf');
  const second = await api.discover('bilibili', accounts.options(signal()));
  assert.deepEqual(second[0].page.items.map(item => item.ref.id), [videoId(3),videoId(1)], 'refresh prefers new music then fills with available repeats');
  const feedCalls = calls.filter(call => call.path.endsWith('/index/top/feed/rcmd'));
  assert.deepEqual(feedCalls.map(call => call.query.get('fresh_idx')), ['1', '2', '3', '4', '5', '6']);
  assert(feedCalls[1].query.get('last_showlist').includes('av_1'));
  assert(feedCalls.every(call => call.query.has('w_rid')));
  const previousRevision=credentials.revision;
  await credentials.write(ref,{...await credentials.read(ref,signal()),revision:'replacement-login'},signal());
  await accounts.expire(previousRevision);
  assert.equal((await accounts.status(signal())).state,'authenticated','an expired response from the old login cannot disconnect a replacement login');
  accountValid = false;
  const revision = credentials.revision;
  // A signing-key cache must not mask an expired session; video/feed errors are also handled.
  provider.forgetCredentials(ref);
  await assert.rejects(api.discover('bilibili', accounts.options(signal())), { code: 'authentication' });
  await accounts.expire(revision);
  assert.equal((await accounts.status(signal())).state, 'expired');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal(accounts.options().credentialRef, undefined);
  assert.equal((await api.discover('bilibili'))[0].id, 'music-recommendation');
  accountValid = true;
  const pending = await accounts.begin('browser-a', signal());
  pollState = 'blocked';
  const started = new Promise(resolve => { blockedStarted = resolve; });
  const polling = accounts.poll('browser-a', pending.id, signal()).catch(e => e);
  await started;
  await accounts.disconnect(signal());
  const rejected = await polling;
  assert.equal(rejected.code, 'cancelled');
  blocked?.();
  assert.equal((await accounts.status(signal())).state, 'anonymous');
  await assert.rejects(accounts.poll('browser-a', pending.id, signal()), { code: 'expired' });
  assert.equal(credentials.revision, undefined, 'disconnect cannot be undone by an in-flight QR poll');
  assert(revoked.length >= 3);
});
