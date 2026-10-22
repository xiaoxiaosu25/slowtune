import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const loadSongModule = name => import(pathToFileURL(join(resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.'), 'dist/server', name + '.js')));
const { SongLibraryStore } = await loadSongModule('song-library-store');
const { SongLibraryService } = await loadSongModule('song-library-service');
const { SongLibrarySources } = await loadSongModule('song-library-sources');
const { SongLibrarySync } = await loadSongModule('song-library-sync');
const { SongLibraryMaintenance } = await loadSongModule('song-library-maintenance');
export const bv = n => 'BV' + String(n).padStart(10, '0');
export const ref = (n = 1, part = '10') => ({ provider: 'bilibili', kind: 'video', id: bv(n), part });
export const entry = reference => ({ ref: { ...reference, ...(reference.provider === 'bilibili' ? { part: reference.part ?? '10' } : {}) }, resourceId: reference.id + ':' + (reference.part ?? '10'), title: '来源 ' + reference.id, artists: ['来源歌手'], url: reference.provider === 'bilibili' ? 'https://www.bilibili.com/video/' + reference.id : 'https://www.youtube.com/watch?v=' + reference.id });
export function songServices(t) {
  const store = new SongLibraryStore(':memory:', 'test'), library = new SongLibraryService(store);
  const state = { account: '123', generation: 'one', folders: [{ id: '10', title: '远端歌单', count: 0, private: true }], videos: new Map([['10', []]]), changes: [], creations: 0, fail: undefined, metadata: undefined, aid: undefined, change: undefined, failCreation: false };
  const metadata = async reference => state.metadata ? state.metadata(reference) : entry(reference);
  const access = { metadata, resolve: async () => entry(ref()), enabled: () => true, generation: () => state.generation };
  const remote = {
    context: async signal => ({ accountId: state.account, credential: { revision: state.generation }, signal }),
    check: c => { if (c.signal.aborted || c.accountId !== state.account || c.credential.revision !== state.generation) throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); },
    folders: async c => { remote.check(c); return structuredClone(state.folders); },
    createFolder: async (title, privateFolder, c) => { remote.check(c); state.creations++; const folder={id:String(10+state.creations),title,count:0,private:privateFolder}; state.folders.push(folder); state.videos.set(folder.id,[]); if(state.failCreation)throw Object.assign(new Error('network'),{code:'network'}); return folder; },
    videos: async (folder, c) => { remote.check(c); return (state.videos.get(folder) ?? []).map(bvid => ({ bvid, aid: String(Number(bvid.slice(2))) })); },
    aid: async (bvid, c) => { if (state.aid) await state.aid(bvid); remote.check(c); return String(Number(bvid.slice(2))); },
    change: async (folder, aid, add, c) => {
      remote.check(c); if (state.change) await state.change(folder, aid, add, c);
      if (state.fail === 'before') throw Object.assign(new Error('network'), { code: 'network' });
      const id = bv(aid), ids = new Set(state.videos.get(folder)); if (add) ids.add(id); else ids.delete(id); state.videos.set(folder, [...ids]); state.changes.push({ folder, id, add });
      if (state.fail === 'after') throw Object.assign(new Error('network'), { code: 'network' });
    },
  };
  const sync = new SongLibrarySync(library, remote, metadata), sources = new SongLibrarySources(library, access), maintenance = new SongLibraryMaintenance(library, access);
  t.after(async () => { await sync.dispose(); store.close(); });
  const signal = new AbortController().signal;
  const save = input => sources.save(library.read().revision, input, signal);
  const edit = edits => library.execute(library.read().revision, edits);
  const link = async (targetId = 'system:favorites', folderId = '10') => { const preview = await sync.preview('browser', library.read().revision, { folderId, targetId }, signal); return sync.commit('browser', preview.token, preview.revision, signal); };
  return { library, store, sync, sources, maintenance, state, signal, save, edit, link, remote };
}
