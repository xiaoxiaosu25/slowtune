import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';

const project = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = resolve(process.env.MUSIC_APP_TEST_BUILD ?? project);
const { SongLibraryStore } = await import(pathToFileURL(join(buildRoot, 'dist/server/song-library-store.js')));

test('mounted song library enforces host/session boundaries and clears previews and stalled work on revocation, expiry and shutdown', { timeout: 45000 }, async t => {
  const parent = join(project, 'local/song-library-host'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'run-')), configFile = join(directory, 'config.json'), preload = join(directory, 'preload.mjs');
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const config = { host: '127.0.0.1', port, allowedHosts: ['127.0.0.1'], accessKey: 'isolated-song-access', userSpace: 'song-fixture', database: join(directory, 'library.sqlite'), runtimeDirectory: directory, mediaLeaseTtlMs: 85000 };
  writeFileSync(configFile, JSON.stringify(config));
  writeFileSync(preload, `
    import { SongLibraryStore } from ${JSON.stringify(pathToFileURL(join(buildRoot, 'dist/server/song-library-store.js')).href)};
    import { LyricsStore } from ${JSON.stringify(pathToFileURL(join(buildRoot, 'dist/server/lyrics-store.js')).href)};
    import { BilibiliCredentials } from ${JSON.stringify(pathToFileURL(join(buildRoot, 'dist/server/bilibili-credentials.js')).href)};
    import { MusicSources, MusicSourceError } from '@studio/music-sources';
    import { BilibiliCatalogue } from '@studio/music-sources/discovery';
    BilibiliCredentials.prototype.open = async function() { this.value={provider:'bilibili',revision:'fixture-login',cookie:'SESSDATA=offline-fixture'}; return this; };
    const publicEntry={ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:'900'},resourceId:'public-song',title:'公开歌曲',artists:['公开歌手'],url:'https://www.bilibili.com/video/BV1tX4y1W7Xm'};
    MusicSources.prototype.search = async function(provider,input,options) { if(options?.credentialRef)throw new MusicSourceError({code:'upstream',provider,retryable:true}); options.signal.throwIfAborted();if(input.query.startsWith('超时'))throw new MusicSourceError({code:'timeout',provider,retryable:true});process.send?.({event:'public-search',query:input.query});return {items:[publicEntry]}; };
    MusicSources.prototype.metadata = async function(ref,options) { if(options?.credentialRef)throw new MusicSourceError({code:'upstream',provider:ref.provider,retryable:true});options.signal.throwIfAborted();process.send?.({event:'public-metadata'});return publicEntry; };
    MusicSources.prototype.prepare = async function(input,options) { options.signal.throwIfAborted();process.send?.({event:'audio-verified'});return {resourceId:publicEntry.resourceId,entry:publicEntry,format:{id:'aac',codec:'mp4a',mimeType:'audio/mp4',container:'mp4'},delivery:{url:'https://fixture.bilivideo.com/audio.m4a',requiresHost:true,credentialRevision:'fixture-login'}}; };
    BilibiliCatalogue.prototype.json = async function(path,params,context) { if(path!=='/x/web-interface/view')throw new Error('offline fixture');if(context.credentialRef||context.credential)throw new Error('public classification must not depend on account health');context.signal.throwIfAborted();process.send?.({event:'public-partition'});return {tid:130}; };
    const close = SongLibraryStore.prototype.close;
    SongLibraryStore.prototype.close = function() { close.call(this); process.send?.({ event: 'song-store-closed' }); };
    const closeLyrics = LyricsStore.prototype.close;
    LyricsStore.prototype.close = function() { closeLyrics.call(this); process.send?.({ event: 'lyrics-store-closed' }); };
    // Keep this real-host test offline, including the host's background warmups.
    globalThis.fetch = async input => { if(String(input)==='https://fixture.bilivideo.com/audio.m4a'){const prefix=new Uint8Array(1024);prefix[3]=24;prefix.set(new TextEncoder().encode('ftypM4A '),4);return new Response(prefix,{status:206,headers:{'Content-Range':'bytes 0-1023/2048','Content-Length':'1024'}});}throw new Error('fixture blocks upstream'); };
    // Trigger the real session expiry callbacks without waiting seven days.
    const timers = new Map(), schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = schedule(callback, delay, ...args);
      if (delay === 7 * 86400000) timers.set(timer, () => callback(...args));
      return timer;
    };
    globalThis.clearTimeout = timer => { timers.delete(timer); return cancel(timer); };
    process.on('message', message => {
      if (message !== 'expire-sessions') return;
      for (const [timer, callback] of [...timers]) { clearTimeout(timer); callback(); }
      process.send?.({ event: 'sessions-expired' });
    });
    process.channel?.unref();
  `);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, join(buildRoot, 'dist/server/index.js')], { cwd: directory, windowsHide: true, env: { ...process.env, MUSIC_APP_CONFIG: configFile }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '',audioPrepares=0; const events = new Set(),searchQueries=[];
  child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
  child.on('message', value => {events.add(value.event);if(value.event==='public-search')searchQueries.push(value.query);if(value.event==='audio-verified')audioPrepares++;});
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } });
  const base = 'http://127.0.0.1:' + port;
  const api = async (path, body, cookie = '', headers = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Music-App': '1', 'Content-Type': 'application/json', Cookie: cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(7000) });
    const text = await response.text();
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  };
  const login = async (accessKey = config.accessKey, cookie = '') => { const value = await api('/api/login', { accessKey }, cookie); assert.equal(value.status, 200, JSON.stringify(value.data)); return value.cookie; };
  const preview = (cookie, snapshot, revision) => api('/api/song-library/imports/preview?mode=append', snapshot, cookie, { 'X-SlowTune-Revision': revision ?? 'null' });
  const holdBody = (path, body, cookie) => {
    const text = JSON.stringify(body); let outgoing;
    const response = new Promise((resolve, reject) => {
      outgoing = httpRequest(base + path, { method: 'POST', headers: { 'X-Music-App': '1', 'Content-Type': 'application/json', Cookie: cookie } }, incoming => {
        let text = ''; incoming.setEncoding('utf8'); incoming.on('data', value => text += value);
        incoming.on('end', () => { try { resolve({ status: incoming.statusCode, data: JSON.parse(text) }); } catch (error) { reject(error); } }); incoming.on('error', reject);
      });
      outgoing.on('error', reject);
      outgoing.setTimeout(7000, () => outgoing.destroy(new Error('stalled request did not cancel: ' + path)));
    });
    const sent = new Promise((resolve, reject) => outgoing.write(text.slice(0, -1), error => error ? reject(error) : resolve()));
    t.after(() => outgoing.destroy());
    return { response, sent };
  };

  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await api('/api/bootstrap')).status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert(ready, 'isolated host did not become ready: ' + logs);
  assert.equal((await api('/api/song-library')).status, 401);
  const lyricRef = { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' };
  assert.equal((await api('/api/lyrics/state', { ref: lyricRef })).status, 401);
  const owner = await login(), left = await login(), right = await login(), fourth = await login();
  assert.deepEqual((await api('/api/lyrics/state', { ref: lyricRef }, owner)).data, { revision: null, offsetMs: 0, document: null });
  assert.equal((await api('/api/lyrics/import', { ref: lyricRef, revision: null, title: '歌词', text: '[00:01]正文' }, owner, { Origin: 'https://evil.example' })).status, 403);
  const lyricSaved = await api('/api/lyrics/import', { ref: lyricRef, revision: null, title: '歌词', text: '[00:01]正文' }, owner);
  assert.equal(lyricSaved.status, 200); assert.equal(lyricSaved.data.document.provider, 'local');
  assert.equal(existsSync(config.database),false,'the host never opens or initializes the original library');
  assert.equal(existsSync(config.database+'.bilibili-sync.sqlite'),false,'the original sync store is not opened');
  assert.equal((await api('/api/library',undefined,owner)).status,404);
  assert.equal((await api('/api/bilibili/sync',undefined,owner)).status,404);
  const deniedHost = await new Promise((resolve, reject) => {
    const outgoing = httpRequest(base + '/api/song-library', { headers: { Host: 'evil.example', Cookie: owner } }, incoming => { incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode)); });
    outgoing.on('error', reject); outgoing.end();
  });
  assert.equal(deniedHost, 403);
  assert.equal((await api('/api/song-library', undefined, owner, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await api('/api/song-library/edits', { revision: null, edits: [] }, owner, { 'X-Music-App': '' })).status, 403);
  const initial = await api('/api/song-library', undefined, owner);
  assert.equal(initial.status, 200); assert.equal(initial.data.modelVersion, 1); assert.equal(initial.data.revision, null);
  assert.equal(initial.data.snapshot.format, 'slowtune-library'); assert.equal(initial.headers.get('cache-control'), 'no-store');
  const searched=await api('/api/search',{provider:'bilibili',query:'公开歌曲'},owner);assert.equal(searched.status,200,JSON.stringify(searched.data));assert.equal(searched.data.items.length,1);assert.equal(searched.data.classificationIssue,undefined);
  const played=await api('/api/song-library/playback',{selection:{kind:'source',ref:searched.data.items[0].ref}},owner);assert.equal(played.status,200,JSON.stringify(played.data));assert.equal(played.data.entry.title,'公开歌曲');assert(events.has('public-search')&&events.has('public-metadata')&&events.has('public-partition'));
  const desktopMatch=await api('/api/search/resolve',{title:'公开歌曲',artists:['公开歌手'],searchMode:'title-artists'},owner);assert.equal(desktopMatch.status,200,JSON.stringify(desktopMatch.data));assert(events.has('audio-verified'));
  const legacyMatch=await api('/api/search/resolve',{title:'公开歌曲',artists:['公开歌手']},owner);assert.equal(legacyMatch.status,200,JSON.stringify(legacyMatch.data));
  const queryMatch=await api('/api/song-library/playback',{selection:{kind:'query',query:{title:'公开歌曲',artists:['公开歌手']}},searchMode:'title-artists'},owner);assert.equal(queryMatch.status,200,JSON.stringify(queryMatch.data));
  const partialMatch=await api('/api/song-library/playback',{selection:{kind:'query',query:{title:'公开',artists:['公开歌手']}},searchMode:'title-artists'},owner);assert.equal(partialMatch.status,400);assert.equal(partialMatch.data.error.code,'no-match','short embedded names do not establish song identity');
  assert.deepEqual(searchQueries,['公开歌曲','公开歌曲 公开歌手','公开歌曲','公开 公开歌手','公开'],'desktop strategy reaches both real routes; public lookup remains anonymous with a saved account');
  const desktopHeaders={'X-SlowTune-Surface':'desktop'},capability='slowtune-desktop-audio';
  assert(!(await api('/v1/handshake',undefined,owner)).data.capabilities[0].operations.includes(capability));
  assert((await api('/v1/handshake',undefined,owner,desktopHeaders)).data.capabilities[0].operations.includes(capability));
  const optimized=await api('/api/search/resolve',{title:'公开歌曲',artists:['公开歌手'],searchMode:'title-artists'},owner,desktopHeaders);
  assert.equal(optimized.status,200,JSON.stringify(optimized.data));assert(optimized.headers.get('X-SlowTune-Operation'));
  const token=optimized.data.entry.verifiedAudio.preparationToken;assert.match(token,/^[\w-]{32}$/);
  const count=audioPrepares,prepareInput={protocol:2,request:{ref:lyricRef,formatId:'aac',media:'audio'}};
  const prepareHeaders={...desktopHeaders,'X-SlowTune-Audio-Support':'["audio/mp4; codecs=\\"mp4a\\""]','X-SlowTune-Preparation':token};
  const prepared=await api('/v1/call/prepare',prepareInput,owner,prepareHeaders);
  assert.equal(prepared.status,200,JSON.stringify(prepared.data));assert.equal(audioPrepares,count,'the real mounted service consumes the verified preparation without another upstream prepare');
  assert(prepared.data.result.leaseId);assert.equal(new URL(prepared.data.result.delivery.url).origin,base);
  const media=await fetch(prepared.data.result.delivery.url,{headers:{Cookie:owner,Range:'bytes=0-1023'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,1024);
  assert.equal((await fetch(base+'/v1/leases/'+prepared.data.result.leaseId,{method:'DELETE',headers:{Cookie:owner,'X-Music-App':'1'}})).status,204);
  const repeated=await api('/v1/call/prepare',prepareInput,owner,prepareHeaders);assert.equal(repeated.status,200);assert.equal(audioPrepares,count+1,'a consumed preparation cannot be replayed');
  await fetch(base+'/v1/leases/'+repeated.data.result.leaseId,{method:'DELETE',headers:{Cookie:owner,'X-Music-App':'1'}});
  const observed=(await api('/api/status',undefined,owner)).data.desktopPlayback;
  assert(observed.events.some(event=>event.code==='verified-reuse'));assert(!JSON.stringify(observed).includes(token));assert.equal(observed.tickets,0);
  assert.equal((await api('/v1/call/prepare',prepareInput,owner,{...prepareHeaders,'X-SlowTune-Audio-Support':'bad'})).status,400);
  const timedSelection={kind:'query',query:{title:'超时',artists:['公开歌手']}};
  const timed=await api('/api/song-library/playback',{selection:timedSelection,searchMode:'title-artists'},owner,desktopHeaders);assert.equal(timed.status,503);assert.equal(timed.data.error.code,'timeout');
  assert.equal((await api('/api/song-library/playback',{selection:timedSelection},owner)).status,400,'the existing mobile error status stays unchanged');
  assert.equal((await api('/api/search/resolve',{title:'公开歌曲',searchMode:'account'},owner)).status,400);
  assert.equal((await api('/api/song-library/playback',{selection:{kind:'query',query:{title:'公开歌曲'}},searchMode:'account'},owner)).status,400);
  const edits = [{ type: 'create-song', id: 'manual', title: '人工歌名', artists: ['人工歌手'] }, { type: 'favorite', songId: 'manual' }];
  assert.equal((await api('/api/song-library/edits', { userSpace: 'intruder', revision: null, edits }, owner)).status, 400);
  const saved = await api('/api/song-library/edits', { revision: null, edits }, owner);
  assert.equal(saved.status, 200); assert.equal(saved.data.snapshot.favorites.length, 1); assert(saved.data.snapshot.songs[0].fields.title.protected);
  const conflict = await api('/api/song-library/edits', { revision: null, edits }, owner);
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error.currentRevision, saved.data.revision);
  const exported = await api('/api/song-library/export', undefined, owner);
  assert.deepEqual(exported.data, saved.data.snapshot); assert.match(exported.headers.get('content-disposition'), /slowtune-library\.json/);
  assert.deepEqual((await api('/api/song-library/events', undefined, owner)).data, { revision: saved.data.revision });
  const other = new SongLibraryStore(config.database + '.song-library.sqlite', 'intruder');
  try { assert.equal(other.read().revision, null); assert.deepEqual(other.read().document.snapshot.songs, []); } finally { other.close(); }
  assert.equal((await preview(owner, { format: 'studio-music-library', version: 1, favorites: [], playlists: [] }, saved.data.revision)).status, 400);

  const heldPreviews = [];
  for (const cookie of [owner, left, right, fourth]) {
    const result = await preview(cookie, saved.data.snapshot, saved.data.revision); assert.equal(result.status, 200); heldPreviews.push(result.data);
  }
  assert.equal((await api('/api/song-library/imports/commit', { token: heldPreviews[0].token, revision: saved.data.revision }, left)).status, 410);
  assert.equal((await api('/api/logout', {}, left)).status, 200);
  const fifth = await login(); assert.equal((await preview(fifth, saved.data.snapshot, saved.data.revision)).status, 200, 'logout frees the departed session preview');
  const replacement = await login(config.accessKey, right);
  assert.equal((await api('/api/song-library', undefined, right)).status, 401);
  assert.equal((await preview(replacement, saved.data.snapshot, saved.data.revision)).status, 200, 're-login clears the previous identity preview');

  const stalled = [
    holdBody('/api/song-library/edits', { revision: saved.data.revision, edits: [{ type: 'create-playlist', name: 'must not commit' }] }, replacement),
    holdBody('/api/song-library/imports/preview?mode=append', saved.data.snapshot, replacement),
    holdBody('/api/song-library/imports/commit', { token: heldPreviews[3].token, revision: saved.data.revision }, fourth),
    holdBody('/api/lyrics/import', { ref: lyricRef, revision: lyricSaved.data.revision, title: 'must not commit', text: '[00:01]cancelled' }, replacement),
  ];
  await Promise.all(stalled.map(value => value.sent)); await new Promise(resolve => setTimeout(resolve, 100));
  const access = (await api('/api/settings/access', undefined, owner)).data, changedKey = 'changed-song-access';
  assert.equal((await api('/api/settings/access', { ...access, currentAccessKey: config.accessKey, newAccessKey: changedKey }, owner)).status, 200);
  for (const value of stalled) { const result = await value.response; assert.equal(result.status, 408); assert.equal(result.data.error.code, 'cancelled'); }
  assert.deepEqual((await api('/api/song-library', undefined, owner)).data, saved.data);
  assert.deepEqual((await api('/api/lyrics/state', { ref: lyricRef }, owner)).data, lyricSaved.data);
  for (const cookie of [replacement, fourth, fifth]) assert.equal((await api('/api/song-library', undefined, cookie)).status, 401);
  for (let index = 0; index < 3; index++) {
    const cookie = await login(changedKey); assert.equal((await preview(cookie, saved.data.snapshot, saved.data.revision)).status, 200, 'revocation frees preview slots');
  }

  child.send('expire-sessions');
  for (let attempt = 0; attempt < 100 && !events.has('sessions-expired'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(events.has('sessions-expired')); assert.equal((await api('/api/song-library', undefined, owner)).status, 401);
  const fresh = await login(changedKey);
  const freshPreview = await preview(fresh, saved.data.snapshot, saved.data.revision); assert.equal(freshPreview.status, 200, 'natural expiry frees preview slots');
  const committed = await api('/api/song-library/imports/commit', { token: freshPreview.data.token, revision: saved.data.revision }, fresh);
  assert.equal(committed.status, 200); assert.deepEqual(committed.data.snapshot, saved.data.snapshot);
  const stoppingBody = holdBody('/api/song-library/edits', { revision: committed.data.revision, edits: [{ type: 'create-playlist', name: 'shutdown must cancel' }] }, fresh);
  await stoppingBody.sent; await new Promise(resolve => setTimeout(resolve, 100));
  const control = JSON.parse(readFileSync(join(directory, 'service.json'), 'utf8'));
  assert.equal((await api('/internal/stop', {}, '', { 'X-Control-Key': control.key })).status, 200);
  assert.equal((await stoppingBody.response).status, 408);
  assert.deepEqual(await exited, { code: 0, signal: null }, logs); assert(events.has('song-store-closed'), 'shutdown closes the new SQLite handle');
  assert(events.has('lyrics-store-closed'), 'shutdown closes lyrics SQLite too');
  const persisted = new SongLibraryStore(config.database + '.song-library.sqlite', config.userSpace);
  try { assert.deepEqual(persisted.read().document.snapshot, saved.data.snapshot); } finally { persisted.close(); }
});
