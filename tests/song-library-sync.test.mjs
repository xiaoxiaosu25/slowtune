import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songServices, ref, bv, entry, loadSongModule } from './helpers/song-services.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('explicit mappings preserve exact parts and repeated members; only the last BV removal reaches its folder', async t => {
  const f = songServices(t); f.edit([{ type: 'create-playlist', id: 'p', name: '重复' }]);
  await f.save({ refs: [ref()], target: 'playlist', playlistId: 'p' }); const songId = f.library.read().snapshot.songs[0].id;
  await f.save({ refs: [ref(1, '20')], target: 'version', songId });
  const version = f.library.read().snapshot.versions.find(v => v.ref.part === '20');
  f.edit([{ type: 'add-entry', playlistId: 'p', songId, pinnedVersionId: version.id }]); await f.link('p');
  assert.deepEqual(f.state.changes.map(c => c.add), [true]); assert.equal(f.store.read().document.syncMappings.length, 2);
  const [a, b] = f.library.read().snapshot.playlists[0].entries;
  f.edit([{ type: 'remove-entry', playlistId: 'p', entryId: a.entryId }]); await f.sync.run(); assert.equal(f.state.changes.length, 1);
  f.edit([{ type: 'remove-entry', playlistId: 'p', entryId: b.entryId }]); assert.equal(f.store.events().filter(e => e.type === 'sync-intent').length, 1);
  await f.sync.run(); assert.deepEqual(f.state.changes.map(c => c.add), [true, false]); assert.equal(f.library.read().snapshot.versions.length, 2);
});

test('remote deletion detaches contributions, retains local members and never regenerates mappings from defaults', async t => {
  const f = songServices(t); await f.save({ refs: [ref()], target: 'favorite' }); await f.link();
  f.state.videos.set('10', []); await f.sync.run(); assert.equal(f.library.read().snapshot.favorites.length, 1); assert.equal(f.store.read().document.syncMappings.length, 0);
  await f.sync.run(); assert.equal(f.state.changes.length, 1); assert.deepEqual(f.state.videos.get('10'), []);
  const song = f.library.read().snapshot.songs[0]; await f.save({ refs: [ref(2)], target: 'version', songId: song.id });
  f.edit([{ type: 'set-default', songId: song.id, versionId: f.library.read().snapshot.versions[1].id }]); await f.sync.run(); assert.equal(f.state.changes.length, 1);
});

test('remote-only members disappear only without local or other-account contributions; songs and versions survive', async t => {
  const f = songServices(t); f.state.videos.set('10', [bv(1), bv(2)]); await f.link();
  assert.equal(f.library.read().snapshot.favorites.length, 2); assert(f.store.read().document.origins.every(o => o.local === 'absent'));
  const song = f.library.read().snapshot.songs[0]; f.edit([{ type: 'favorite', songId: song.id }]);
  f.state.videos.set('10', []); await f.sync.run(); assert.deepEqual(f.library.read().snapshot.favorites.map(f => f.songId), [song.id]); assert.equal(f.library.read().snapshot.songs.length, 2);
  await f.sync.run(); assert.equal(f.state.changes.length, 0);
});

for (const failure of ['before', 'after']) test(`durable ${failure}-write uncertainty rechecks current mappings and does not resurrect a cancelled member`, async t => {
  const f = songServices(t); await f.save({ refs: [ref()], target: 'favorite' }); const preview = await f.sync.preview('browser', f.library.read().revision, { folderId: '10', targetId: 'system:favorites' }, f.signal);
  f.state.fail = failure; await assert.rejects(f.sync.commit('browser', preview.token, preview.revision, f.signal), { code: 'network' });
  assert.equal(f.store.events().filter(e => e.type === 'sync-intent').length, 1);
  f.edit([{ type: 'remove-favorite', favoriteId: f.library.read().snapshot.favorites[0].favoriteId }]); f.state.fail = undefined; await f.sync.run();
  assert.deepEqual(f.state.videos.get('10'), []); assert.equal(f.library.read().snapshot.favorites.length, 0); assert.equal(f.store.events().filter(e => e.type === 'sync-intent').length, 0);
});

test('defaults and backup replacement cannot grant new remote authority; review requires a fresh confirmed preview', async t => {
  const f = songServices(t); await f.save({ refs: [ref()], target: 'favorite' }); await f.link();
  const song = f.library.read().snapshot.songs[0]; await f.save({ refs: [ref(2)], target: 'version', songId: song.id }); f.edit([{ type: 'set-default', songId: song.id, versionId: f.library.read().snapshot.versions[1].id }]); await f.sync.run();
  assert.deepEqual(f.state.videos.get('10'), [bv(1)]);
  const p = f.library.previewImport('browser', f.library.export(), 'replace', f.library.read().revision); f.library.commitImport('browser', p.token, p.revision);
  assert.equal(f.store.read().document.syncLinks[0].state, 'review'); await f.sync.run(); assert.equal(f.state.changes.length, 1);
  const link = f.store.read().document.syncLinks[0], preview = await f.sync.preview('browser', f.library.read().revision, { linkId: link.id, folderId: '10', targetId: link.targetId }, f.signal);
  assert.deepEqual(preview.remoteAdditions, [bv(2)]); await f.sync.commit('browser', preview.token, preview.revision, f.signal); assert(f.state.videos.get('10').includes(bv(2)));
});

test('preview is session owned, expiring, revision checked and credential generation bound', async t => {
  const f = songServices(t); await f.save({ refs: [ref()], target: 'favorite' }); let p = await f.sync.preview('browser', f.library.read().revision, { folderId: '10', targetId: 'system:favorites' }, f.signal);
  await assert.rejects(f.sync.commit('other', p.token, p.revision, f.signal), { code: 'expired' });
  f.edit([{ type: 'edit-song', songId: f.library.read().snapshot.songs[0].id, title: '并发' }]); await assert.rejects(f.sync.commit('browser', p.token, p.revision, f.signal), { code: 'conflict' }); assert.equal(f.state.changes.length, 0);
  p = await f.sync.preview('browser', f.library.read().revision, { folderId: '10', targetId: 'system:favorites' }, f.signal); f.state.generation = 'two';
  await assert.rejects(f.sync.commit('browser', p.token, p.revision, f.signal), { code: 'cancelled' });
  p = await f.sync.preview('browser', f.library.read().revision, { folderId: '10', targetId: 'system:favorites' }, f.signal); f.sync.cancelOwner('browser'); await assert.rejects(f.sync.commit('browser', p.token, p.revision, f.signal), { code: 'expired' });
});

test('account switches, pause, unlink and a late aid lookup prevent stale remote writes', async t => {
  const f = songServices(t); await f.save({ refs: [ref()], target: 'favorite' }); let release, entered;
  const gate = new Promise(r => entered = r); f.state.aid = async () => { entered(); await new Promise(r => release = r); };
  const p = await f.sync.preview('browser', f.library.read().revision, { folderId: '10', targetId: 'system:favorites' }, f.signal), work = f.sync.commit('browser', p.token, p.revision, f.signal);
  await gate; const link = f.store.read().document.syncLinks[0]; await f.sync.control(f.library.read().revision, { action: 'pause', linkId: link.id }, f.signal); release(); await assert.rejects(work, { code: 'cancelled' }); assert.equal(f.state.changes.length, 0);
  f.state.aid = undefined; const review = await f.sync.preview('browser', f.library.read().revision, { linkId: link.id, folderId: '10', targetId: link.targetId }, f.signal); await f.sync.commit('browser', review.token, review.revision, f.signal); assert.equal(f.state.changes.length, 1);
  f.state.account = '456'; f.state.generation = 'two'; assert.equal((await f.sync.state(f.signal)).links.length, 0); await f.sync.run(); assert.equal(f.state.changes.length, 1);
  f.state.account = '123'; f.state.generation = 'three'; await f.sync.control(f.library.read().revision, { action: 'unlink', linkId: link.id }, f.signal); assert.equal(f.library.read().snapshot.favorites.length, 1); assert.equal(f.store.read().document.syncLinks.length, 0); assert.equal(f.state.changes.length, 1);
});

test('transient metadata failures roll back reconciliation; missing videos remain retryable without remote deletion', async t => {
  const f = songServices(t); await f.link(); f.state.videos.set('10', [bv(1), bv(2)]); f.state.metadata = async r => { if (r.id === bv(2)) throw Object.assign(new Error('network'), { code: 'network' }); return entry(r); };
  await assert.rejects(f.sync.run(), { code: 'network' }); assert.equal(f.library.read().snapshot.songs.length, 0); assert.equal(f.state.changes.length, 0);
  f.state.metadata = async r => { if (r.id === bv(2)) throw Object.assign(new Error('missing'), { code: 'not-found' }); return entry(r); }; await f.sync.run(); assert.equal(f.library.read().snapshot.songs.length, 1); assert(!f.store.read().document.syncLinks[0].observed.includes(bv(2)));
  f.state.metadata = undefined; await f.sync.run(); assert.equal(f.library.read().snapshot.songs.length, 2); assert.equal(f.state.changes.length, 0);
});

test('new folder creation is durable, private by choice and uncertain responses are recovered without another create', async t => {
  const f = songServices(t); await f.save({refs:[ref()],target:'favorite'}); f.state.failCreation=true;
  const p=await f.sync.preview('browser',f.library.read().revision,{targetId:'system:favorites',create:{title:'新收藏夹',private:true}},f.signal);
  await assert.rejects(f.sync.commit('browser',p.token,p.revision,f.signal),{code:'network'}); assert.equal(f.state.creations,1);
  const link=f.store.read().document.syncLinks[0]; assert(link.creation); assert.equal(link.state,'review'); await f.sync.run(); assert.equal(f.state.creations,1);
  await f.sync.control(f.library.read().revision,{action:'recover-creation',linkId:link.id},f.signal); assert.equal(f.store.read().document.syncLinks[0].folderId,'11');
  const review=await f.sync.preview('browser',f.library.read().revision,{linkId:link.id,folderId:'11',targetId:link.targetId},f.signal); await f.sync.commit('browser',review.token,review.revision,f.signal);
  assert.deepEqual(f.state.videos.get('11'),[bv(1)]); assert.equal(f.state.creations,1); assert.equal(f.state.folders.find(folder=>folder.id==='11').private,true);
});

test('another account contribution retains the same member after remote deletion, with isolated BV projection', async t=>{
  const f=songServices(t);f.state.videos.set('10',[bv(1)]);await f.link();const favorite=f.library.read().snapshot.favorites[0];
  f.state.account='456';f.state.generation='two';await f.link();assert.equal(f.store.read().document.syncMappings.length,2);
  f.state.videos.set('10',[]);await f.sync.run();assert.equal(f.library.read().snapshot.favorites[0].favoriteId,favorite.favoriteId);assert.equal(f.store.read().document.syncMappings.length,1);
  f.state.account='123';f.state.generation='three';await f.sync.run();assert.equal(f.library.read().snapshot.favorites.length,0);assert.equal(f.state.changes.length,0);
});

test('bounded import continues beyond failed videos and large targets without treating deferred content as deletion', async t=>{
  const f=songServices(t); f.state.videos.set('10',Array.from({length:201},(_,i)=>bv(i+1)));
  let reads=0;f.state.metadata=async r=>{reads++;if(r.id===bv(1))throw Object.assign(new Error('missing'),{code:'not-found'});return entry(r);};
  await f.link();assert.equal(reads,100);assert.equal(f.library.read().snapshot.favorites.length,99);
  await f.sync.run();assert.equal(reads,200);assert.equal(f.library.read().snapshot.favorites.length,199);
  f.state.metadata=async r=>{reads++;return entry(r);};await f.sync.run();assert.equal(f.library.read().snapshot.favorites.length,201);assert.equal(f.state.changes.length,0);
});

test('a restarted executor verifies durable intent against the current database and remote facts',async t=>{
  const f=songServices(t);await f.save({refs:[ref()],target:'favorite'});f.state.fail='after';
  const p=await f.sync.preview('browser',f.library.read().revision,{folderId:'10',targetId:'system:favorites'},f.signal);await assert.rejects(f.sync.commit('browser',p.token,p.revision,f.signal),{code:'network'});
  const {SongLibraryStore}=await loadSongModule('song-library-store'),{SongLibraryService}=await loadSongModule('song-library-service'),{SongLibrarySync}=await loadSongModule('song-library-sync');
  const directory=await mkdtemp(join(tmpdir(),'slowtune-sync-restart-')),file=join(directory,'songs.sqlite');let store=new SongLibraryStore(file,'restart');
  store.transaction(null,context=>{context.document=f.store.read().document;context.events=f.store.events().filter(e=>e.type==='sync-intent').map(({type,linkId,bvid,action})=>({type,linkId,bvid,action}));});store.close();
  store=new SongLibraryStore(file,'restart');const library=new SongLibraryService(store),sync=new SongLibrarySync(library,f.remote,async r=>entry(r));
  try{f.state.fail=undefined;await sync.run();assert.equal(f.state.changes.length,1,'a confirmed remote add is not sent twice');assert.equal(store.events().filter(e=>e.type==='sync-intent').length,0);assert.equal(library.read().snapshot.favorites.length,1);}
  finally{await sync.dispose();store.close();assert(resolve(directory).startsWith(resolve(tmpdir())+'\\slowtune-sync-restart-')||resolve(directory).startsWith(resolve(tmpdir())+'/slowtune-sync-restart-'));await rm(directory,{recursive:true,force:true});}
});

test('resuming previews valid paused removal intentions even after their last mapping was deleted',async t=>{
  for(const beforePause of [true,false]){
  const f=songServices(t);await f.save({refs:[ref()],target:'favorite'});await f.link();const link=f.store.read().document.syncLinks[0];
  const remove=()=>f.edit([{type:'remove-favorite',favoriteId:f.library.read().snapshot.favorites[0].favoriteId}]);if(beforePause)remove();await f.sync.control(f.library.read().revision,{action:'pause',linkId:link.id},f.signal);if(!beforePause)remove();
  const preview=await f.sync.preview('browser',f.library.read().revision,{linkId:link.id,folderId:link.folderId,targetId:link.targetId},f.signal);assert.deepEqual(preview.remoteRemovals,[bv(1)]);
  await f.sync.commit('browser',preview.token,preview.revision,f.signal);assert.deepEqual(f.state.videos.get('10'),[]);
  }
});
