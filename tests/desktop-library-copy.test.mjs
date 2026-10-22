import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {loadSongModule} from './helpers/song-services.mjs';
const {SongLibraryStore}=await loadSongModule('song-library-store'),{SongLibraryService}=await loadSongModule('song-library-service');
test('desktop encoded cache retains detached results, full validation, external revision, cancellation and rollback',t=>{
  const parent=resolve('local/precision-lyrics-performance-20261020');mkdirSync(parent,{recursive:true});
  const path=join(mkdtempSync(join(parent,'db-test-')),'library.sqlite');
  const store=new SongLibraryStore(path,'copy'),other=new SongLibraryStore(path,'copy'),library=new SongLibraryService(store),second=new SongLibraryService(other);t.after(()=>{store.close();other.close();});
  const saved=store.onSurface(true,()=>library.execute(null,[{type:'create-song',id:'s',title:'原题',artists:['歌手']},{type:'favorite',songId:'s'}]));
  saved.snapshot.songs[0].title='poison';assert.equal(store.onSurface(true,()=>library.read()).snapshot.songs[0].title,'原题');assert.equal(library.read().snapshot.songs[0].title,'原题');
  const read=store.onSurface(true,()=>library.read());read.snapshot.songs[0].artists.push('poison');assert.deepEqual(store.onSurface(true,()=>library.read()).snapshot.songs[0].artists,['歌手']);
  const external=second.execute(second.revision(),[{type:'edit-song',songId:'s',title:'另一页面'}]);assert.equal(store.onSurface(true,()=>library.read()).revision,external.revision);
  assert.throws(()=>store.onSurface(true,()=>library.execute(read.revision,[{type:'edit-song',songId:'s',title:'冲突'}])),{code:'conflict'});
  assert.throws(()=>store.onSurface(true,()=>library.transaction(external.revision,({document})=>{document.snapshot.songs[0].title='非法';document.snapshot.songs[0].createdAt=-1;})),{code:'invalid-input'});
  const stop=new AbortController();assert.throws(()=>store.onSurface(true,()=>library.transaction(external.revision,({document})=>{document.snapshot.songs[0].title='取消';stop.abort();},stop.signal)),{code:'cancelled'});
  assert.equal(library.read().snapshot.songs[0].title,'另一页面');assert.equal(store.onSurface(true,()=>library.read()).snapshot.songs[0].title,'另一页面');
});
