import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicSourceError } from '@studio/music-sources';
import { YoutubeProvider } from '@studio/music-sources/youtube';
import { YoutubeMusicDiscovery, parseYoutubeMusicCatalogue } from '../dist/server/youtube-discovery.js';

const id = name => 'RDCLAK5fixture_' + name;
const lockup = (name, title, type = 'STATION') => ({ lockupViewModel: { contentId: id(name), contentType: 'LOCKUP_CONTENT_TYPE_' + type, metadata: { lockupMetadataViewModel: { title: { content: title } } } } });
const catalogue = { contents: { newMusicHubViewModel: { sections: [lockup('mando', 'Mando Flow'), lockup('canto', 'Canto Flow'), lockup('pop', 'The Hit List'), lockup('new', 'RELEASED')] } } };
const signal = () => new AbortController().signal;
function track(number) {
  const ref = { provider: 'youtube', kind: 'video', id: String(number).padStart(11, '0') };
  return { ref, resourceId: 'youtube:video:' + ref.id, title: '曲目 ' + number, url: 'https://www.youtube.com/watch?v=' + ref.id, artwork: 'http://i.ytimg.com/vi/' + ref.id + '/hqdefault.jpg' };
}

test('music catalogue reads nested station view models, deduplicates and excludes videos and invalid IDs', () => {
  const result = parseYoutubeMusicCatalogue({ nested: [catalogue, lockup('mando', 'Mando Flow'), lockup('video', '视频', 'VIDEO'), { lockupViewModel: { contentId: '../invalid', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: '无效' } } } } }] });
  assert.deepEqual(result.map(item => item.id), ['mando', 'canto', 'pop', 'new'].map(id));
  assert.deepEqual(parseYoutubeMusicCatalogue({ contents: {} }), []);
});

test('anonymous discovery prioritizes Mandarin/Cantonese, bounds reads, paginates and isolates regional caches', async () => {
  let now = 1000, active = 0, maxActive = 0;
  const catalogues = [], calls = [];
  const discovery = new YoutubeMusicDiscovery({ now: () => now, catalogue: async region => { catalogues.push(region); return catalogue; }, list: async (request, options) => {
    assert.equal(options.credentialRef, undefined);
    assert.equal(request.limit, 12); calls.push(request);
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    const page = Number(request.cursor ?? 0), base = ['mando', 'canto', 'pop', 'new'].map(id).indexOf(request.ref.id) * 1000 + page * 12;
    return { items: Array.from({ length: 12 }, (_, i) => track(base + i)), nextCursor: String(page + 1) };
  } });
  try {
    const first = await discovery.read('HK', 'browser', signal());
    assert.deepEqual(first.playlists.slice(0, 2).map(p => p.title), ['Mando Flow', 'Canto Flow']);
    assert.equal(first.shelf.page.items.length, 36);
    assert(first.shelf.page.items.every(t => t.artwork.startsWith('https:')));
    assert.equal(maxActive, 2); assert.equal(calls.length, 3);
    assert.equal(await discovery.read('HK', 'browser', signal()), first);
    assert.equal(calls.length, 3, 'navigation reuses the short result cache');
    const next = await discovery.read('HK', 'browser', signal(), true);
    assert(next.shelf.page.items.every(t => !first.shelf.page.items.some(old => old.ref.id === t.ref.id)));
    assert(calls.slice(3).filter(r => r.cursor === '1').length >= 2, 'language playlists continue to the next page');
    const usa = await discovery.read('US', 'browser', signal());
    assert.equal(usa.region, 'US'); assert(usa.sourceUrl.includes('gl=US'));
    assert.deepEqual(usa.playlists.slice(0, 2).map(p => p.title), ['The Hit List', 'RELEASED']);
    assert(calls.slice(6).every(r => r.cursor === undefined), 'regions have separate page progress');
    assert.deepEqual(catalogues, ['HK', 'US']);
    now += 600001;
    await discovery.read('HK', 'browser', signal());
    assert.deepEqual(catalogues, ['HK', 'US', 'HK'], 'expired catalogues read current upstream IDs again');
    await assert.rejects(discovery.read('unknown', 'browser', signal()), { code: 'invalid-input' });
  } finally { await discovery.dispose(); }
});

test('partial playlist failure preserves usable songs and repeated music does not become empty', async () => {
  const discovery = new YoutubeMusicDiscovery({ now: Date.now, catalogue: async () => catalogue, list: async request => {
    if (request.ref.id === id('mando')) throw new MusicSourceError({ code: 'restricted', provider: 'youtube', retryable: true });
    return { items: [track(1), track(2), track(1)] };
  } });
  try {
    const first = await discovery.read('HK', 'browser', signal());
    assert.equal(first.warnings.length, 1); assert.equal(first.warnings[0].title, 'Mando Flow');
    assert.equal(first.shelf.page.items.length, 2);
    const repeated = await discovery.read('HK', 'browser', signal(), true);
    assert.equal(repeated.shelf.page.items.length, 2);
  } finally { await discovery.dispose(); }
  const broken = new YoutubeMusicDiscovery({ now: Date.now, catalogue: async () => ({ unrelated: [] }), list: async () => { throw new Error('must not run'); } });
  try { await assert.rejects(broken.read('HK', 'browser', signal()), { code: 'upstream' }); }
  finally { await broken.dispose(); }
});

test('stale playlist cursors retry once and unreadable catalogues never fabricate results', async () => {
  let calls = 0, stale = 0;
  const discovery = new YoutubeMusicDiscovery({ now: Date.now, catalogue: async () => catalogue, list: async request => {
    calls++;
    if (request.cursor) { stale++; throw new MusicSourceError({ code: 'stale-cursor', provider: 'youtube', retryable: false }); }
    return { items: [track(1)], nextCursor: 'expired-cursor' };
  } });
  try {
    await discovery.read('HK', 'browser', signal());
    assert.equal(calls, 3);
    assert.equal((await discovery.read('HK', 'browser', signal(), true)).shelf.page.items.length, 1);
    assert.equal(stale, 2); assert.equal(calls, 8);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(discovery.read('HK', 'browser', cancelled.signal), { code: 'cancelled' });
  } finally { await discovery.dispose(); }
});

test('cancelled discovery releases work, same-feed overlap is bounded and disposal aborts pending requests', async () => {
  const discovery = new YoutubeMusicDiscovery({ now: Date.now, catalogue: async (_region, requestSignal) => new Promise((resolve, reject) => {
    requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
  }), list: async () => ({ items: [] }) });
  const controller = new AbortController(), pending = discovery.read('HK', 'browser', controller.signal);
  await assert.rejects(discovery.read('HK', 'browser', signal(), true), { code: 'busy' });
  controller.abort(); await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(discovery.diagnostics().active, 0);
  const other = discovery.read('US', 'browser', signal());
  const failure = assert.rejects(other, { code: 'cancelled' });
  await discovery.dispose(); await failure;
  assert.deepEqual(discovery.diagnostics(), { active: 0, regions: 0, feeds: 0 });
  await assert.rejects(discovery.read('HK', 'browser', signal()), { code: 'disposed' });
});
test('filtered shared candidates refill at most a second page from each of three playlists',async()=>{
 const calls=[];
 const discovery=new YoutubeMusicDiscovery({now:Date.now,catalogue:async()=>catalogue,list:async request=>{
  calls.push(request);const base=['mando','canto','pop','new'].map(id).indexOf(request.ref.id)*100;
  return {items:Array.from({length:12},(_,i)=>({...track(base+i+(request.cursor?12:0)),title:request.cursor?'qualified':'rejected'})),nextCursor:request.cursor?'third-page':'next-page'};
 }},true);
 try{
  const result=await discovery.read('HK','shared',signal(),true,items=>items.filter(item=>item.title==='qualified').length>=12);
  assert(calls.length>3&&calls.length<=6);assert(calls.every(request=>request.cursor===undefined||request.cursor==='next-page'));
  assert(result.shelf.page.items.some(item=>item.title==='qualified'));assert(result.shelf.page.items.length<=72);
 }finally{await discovery.dispose();}
});
test('browser batches inherit startup playlist progress without sharing subsequent cursor changes',async()=>{
 const calls=[],provider=new YoutubeProvider({resolver:'yt-dlp',tool:{dispose:async()=>{}}});
 const discovery=new YoutubeMusicDiscovery({now:Date.now,catalogue:async()=>({contents:[lockup('mando','Mando Flow')]}),list:async(request,options)=>{
  calls.push(request);
  const context={host:{now:Date.now},scope:'anonymous',signal:options.signal},binding=JSON.stringify(['playlist',request.ref,12]);
  return request.cursor?provider.continuation(request.cursor,binding,12,context,()=>[]):provider.page({},Array.from({length:60},(_,i)=>track(i)),12,binding,context);
 }},true);
 try{
  const startup=await discovery.read('HK','startup',signal(),true);
  discovery.inheritFeed('HK','startup','a');discovery.inheritFeed('HK','startup','b');
  const a=await discovery.read('HK','a',signal(),true),b=await discovery.read('HK','b',signal(),true);
  assert.equal(a.shelf.page.items[0].ref.id,track(12).ref.id);assert.deepEqual(b.shelf.page.items,a.shelf.page.items);
  assert.equal(calls.length,2,'inherited one-use tokens are consumed only once');
  discovery.inheritFeed('HK','startup','a');
  const nextA=await discovery.read('HK','a',signal(),true),nextB=await discovery.read('HK','b',signal(),true);
  assert.equal(nextA.shelf.page.items[0].ref.id,track(24).ref.id);assert.deepEqual(nextB.shelf.page.items,nextA.shelf.page.items);
  discovery.inheritFeed('HK','startup','c');
  assert.deepEqual((await discovery.read('HK','c',signal(),true)).shelf.page.items,a.shelf.page.items);
  assert.deepEqual((await discovery.read('HK','startup',signal())).shelf.page.items,startup.shelf.page.items);
  assert.equal(calls.length,3);assert.deepEqual([...a.warnings,...b.warnings,...nextA.warnings,...nextB.warnings],[]);
 }finally{await discovery.dispose();await provider.dispose();}
});

test('concurrent inherited continuation readers share one fetch and cancel independently',async()=>{
 let release,started,calls=0;
 const waiting=new Promise(resolve=>release=resolve),continuing=new Promise(resolve=>started=resolve);
 const provider=new YoutubeProvider({resolver:'yt-dlp',tool:{dispose:async()=>{}}});
 const discovery=new YoutubeMusicDiscovery({now:Date.now,catalogue:async()=>({contents:[lockup('mando','Mando Flow')]}),list:async(request,options)=>{
  const context={host:{now:Date.now},scope:'anonymous',signal:options.signal},binding=JSON.stringify(['playlist',request.ref,12]);
  if(!request.cursor)return provider.page({},Array.from({length:36},(_,i)=>track(i)),12,binding,context);
  calls++;started();await waiting;options.signal.throwIfAborted();
  return provider.continuation(request.cursor,binding,12,context,()=>[]);
 }},true);
 try{
  await discovery.read('HK','startup',signal(),true);
  discovery.inheritFeed('HK','startup','a');discovery.inheritFeed('HK','startup','b');
  const cancel=new AbortController(),a=discovery.read('HK','a',cancel.signal,true),rejected=assert.rejects(a,{code:'cancelled'});
  const b=discovery.read('HK','b',signal(),true);await continuing;
  // Let both feed workers attach to the same continuation before cancelling one.
  await new Promise(resolve=>setImmediate(resolve));cancel.abort();await rejected;
  release();const result=await b;
  assert.equal(calls,1);assert.equal(result.shelf.page.items[0].ref.id,track(12).ref.id);assert.deepEqual(result.warnings,[]);
 }finally{release();await discovery.dispose();await provider.dispose();}
});
