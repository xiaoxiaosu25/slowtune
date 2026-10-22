import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songServices, ref, entry } from './helpers/song-services.mjs';
const commit = (f, action) => { const p = f.library.previewMaintenance('browser', action, f.library.read().revision); return { preview: p, result: f.library.commitMaintenance('browser', p.token, p.revision) }; };
test('merge keeps target identity/manual fields/default, earlier favorite time/place and repeated pinned members', async t => {
  const f = songServices(t); await f.save({ refs: [ref(1), ref(2), ref(3)], target: 'favorite' });
  const [source, other, target] = f.library.read().snapshot.songs, favorites = f.library.read().snapshot.favorites;
  f.edit([{ type: 'create-playlist', id: 'p', name: '重复' }, { type: 'add-entry', playlistId: 'p', songId: source.id, pinnedVersionId: source.defaultVersionId }, { type: 'add-entry', playlistId: 'p', songId: target.id }]); await f.link();
  const before = f.library.read().snapshot, { preview, result } = commit(f, { type: 'merge-songs', sourceId: source.id, targetId: target.id });
  assert.equal(preview.impact.remoteRemovals.length, 0); assert.deepEqual(result.snapshot.favorites.map(f => f.favoriteId), [favorites[2].favoriteId, favorites[1].favoriteId]);
  assert.equal(result.snapshot.songs.find(s => s.id === target.id).title, target.title); assert.equal(result.snapshot.songs.find(s => s.id === target.id).defaultVersionId, target.defaultVersionId);
  assert.deepEqual(result.snapshot.playlists[0].entries.map(e => e.entryId), before.playlists[0].entries.map(e => e.entryId)); assert(result.snapshot.playlists[0].entries.every(e => e.songId === target.id));
  assert.equal(f.store.read().document.syncMappings.length, 3); await f.sync.run(); assert.equal(f.state.changes.length, 3);
});
test('moving a version clears old defaults/pins/mappings and preserves target default, songs and local members', async t => {
  const f = songServices(t); await f.save({ refs: [ref(1), ref(2)], target: 'favorite' }); const [source, target] = f.library.read().snapshot.songs;
  f.edit([{ type: 'create-playlist', id: 'p', name: '固定' }, { type: 'add-entry', playlistId: 'p', songId: source.id, pinnedVersionId: source.defaultVersionId }]); await f.link();
  const { preview, result } = commit(f, { type: 'move-version', versionId: source.defaultVersionId, targetId: target.id });
  assert.equal(preview.impact.defaults, 1); assert.equal(preview.impact.pins, 1); assert.equal(preview.impact.remoteRemovals.length, 1);
  assert.equal(result.snapshot.songs.find(s => s.id === source.id).defaultVersionId, null); assert.equal(result.snapshot.songs.find(s => s.id === target.id).defaultVersionId, target.defaultVersionId); assert.equal(result.snapshot.playlists[0].entries[0].pinnedVersionId, null);
  await f.sync.run(); assert.equal(f.state.changes.filter(c => !c.add).length, 1);
});
test('full deletion removes catalog/redirect relations and all occurrences in one revision; previews reject stale sessions and conflicts', async t => {
  const f = songServices(t); await f.save({ refs: [ref(1), ref(2)], target: 'favorite' }); const [a,b] = f.library.read().snapshot.songs;
  commit(f,{type:'merge-songs',sourceId:a.id,targetId:b.id}); const p = f.library.previewMaintenance('one',{type:'delete-song',songId:b.id},f.library.read().revision);
  assert.throws(()=>f.library.commitMaintenance('two',p.token,p.revision),{code:'expired'});
  f.edit([{type:'edit-song',songId:b.id,title:'并发'}]); assert.throws(()=>f.library.commitMaintenance('one',p.token,p.revision),{code:'conflict'});
  const {result}=commit(f,{type:'delete-song',songId:b.id}); assert.equal(result.snapshot.songs.length,0); assert.equal(result.snapshot.versions.length,0); assert.equal(result.snapshot.redirects.length,0);
});
test('grouping a sole version carries its favorite into an empty song and makes its first version the default',async t=>{
  const f=songServices(t);await f.save({refs:[ref(1)],target:'favorite'});const source=f.library.read().snapshot.songs[0],favorite=f.library.read().snapshot.favorites[0];
  f.edit([{type:'create-song',id:'target',title:'七里香',artists:['周杰伦']}]);
  const {result}=commit(f,{type:'group-version',versionId:source.defaultVersionId,targetId:'target'});
  assert.equal(result.snapshot.songs.length,1);assert.equal(result.snapshot.songs[0].defaultVersionId,source.defaultVersionId);assert.equal(result.snapshot.favorites[0].favoriteId,favorite.favoriteId);assert.equal(result.snapshot.favorites[0].songId,'target');assert.equal(result.snapshot.versions[0].songId,'target');
});
test('maintenance refresh protects song fields, distinguishes missing from network and cleans only confirmed missing versions', async t => {
  const f = songServices(t); await f.save({refs:[ref(1),ref(2),ref(3)],target:'favorite'}); const original=f.library.read().snapshot, ids=original.versions.map(v=>v.id);
  f.state.metadata=async r=>{if(r.id===ref(2).id)throw Object.assign(new Error('missing'),{code:'not-found'});if(r.id===ref(3).id)throw Object.assign(new Error('network'),{code:'network'});return {...entry(r),title:'刷新来源标题'};};
  const result=await f.maintenance.check(f.library.read().revision,ids,f.signal); assert.equal(result.summary.unavailable,1); assert.equal(result.summary.uncertain,1); assert.equal(result.summary.stoppedReason,'network'); assert.equal(result.snapshot.songs[0].title,original.songs[0].title);
  assert.throws(()=>f.library.previewMaintenance('browser',{type:'clean-unavailable',versionIds:[ids[2]]},f.library.read().revision),{code:'invalid-input'});
  const {result:clean}=commit(f,{type:'clean-unavailable',versionIds:[ids[1]]}); assert.equal(clean.snapshot.versions.length,2); assert.equal(clean.snapshot.favorites.length,3);
});
test('cancelled, superseded or conflicting maintenance cannot commit partial facts', async t=>{
  const f=songServices(t);await f.save({refs:[ref(1)],target:'favorite'});const before=f.library.read(),id=before.snapshot.versions[0].id,c=new AbortController();
  f.state.metadata=async r=>{c.abort();return entry(r);};await assert.rejects(f.maintenance.check(before.revision,[id],c.signal),{code:'cancelled'});assert.deepEqual(f.library.read(),before);
  f.state.metadata=async r=>{f.state.generation='two';return entry(r);};await assert.rejects(f.maintenance.check(before.revision,[id],f.signal),{code:'cancelled'});assert.deepEqual(f.library.read(),before);
});
