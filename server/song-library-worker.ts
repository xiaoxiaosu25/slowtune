import { parentPort, workerData } from 'node:worker_threads';
import { SongLibraryStore, decodeSongDocument, type TransactionContext } from './song-library-store.js';
import { SongLibraryService } from './song-library-service.js';
import { SongLibraryError } from './song-library-errors.js';
import type { DesktopLibraryOperation } from './song-library-worker-client.js';
import { applySyncLocal,localSyncState } from './song-library-sync-local.js';

const store = new SongLibraryStore(workerData.path, workerData.userSpace);
const service = new SongLibraryService(store);
let cached: { revision: string | null; json: string } | undefined;
parentPort!.on('message', ({ id, operation, cancel }: { id: number; operation: DesktopLibraryOperation; cancel: SharedArrayBuffer }) => {
  const flag = new Int32Array(cancel);
  // Store/reducer cancellation checks read this flag even during synchronous work.
  const signal = { get aborted() { return Atomics.load(flag, 0) !== 0; } } as AbortSignal;
  try {
    if (signal.aborted) throw new SongLibraryError('cancelled');
    const reply=(value:unknown)=>{if(signal.aborted)throw new SongLibraryError('cancelled');const bytes=new TextEncoder().encode(JSON.stringify(value));parentPort!.postMessage({id,bytes:bytes.buffer},[bytes.buffer]);};
    if(operation.type==='cancel-owner'){service.cancelOwner(operation.owner);reply({});return;}
    if(operation.type==='sync-state'){reply(localSyncState(store.onSurface(true,()=>store.read()),operation.accountId,operation.busy));return;}
    if(operation.type==='sync-plan'){
      const stored=store.onSurface(true,()=>store.read());
      if(stored.revision!==operation.operation.revision)throw new SongLibraryError('conflict',stored.revision);
      const context:TransactionContext={document:stored.document,events:[],acknowledge:[]};applySyncLocal(context,operation.operation);
      const document=decodeSongDocument(context.document,false);
      if(context.events.length||context.acknowledge.length)throw new SongLibraryError('invalid-input');
      reply({revision:stored.revision,encoded:JSON.stringify(document),reviewed:document.syncLinks.filter(link=>link.state==='review'&&!(link.issues.length===1&&link.issues[0]==='paused')).map(link=>link.id)});return;
    }
    if(operation.type==='import-preview'){reply(store.onSurface(true,()=>service.previewImport(operation.owner,operation.value,operation.mode,operation.revision,signal)));return;}
    if(operation.type==='import-commit'){reply(store.onSurface(true,()=>service.commitImport(operation.owner,operation.token,operation.revision,signal)));cached=undefined;return;}
    if(operation.type==='export'){
      const bytes=new TextEncoder().encode(store.onSurface(true,()=>service.export()));
      if(signal.aborted)throw new SongLibraryError('cancelled');
      parentPort!.postMessage({id,bytes:bytes.buffer},[bytes.buffer]);return;
    }
    const revision = store.revision();
    if (operation.type !== 'read' || cached?.revision !== revision) {
      const value = store.onSurface(true, () => operation.type === 'read' ? service.read() : service.execute(operation.revision, operation.edits, signal));
      cached = { revision: value.revision, json: JSON.stringify(value) };
    }
    if (signal.aborted) throw new SongLibraryError('cancelled');
    const bytes = new TextEncoder().encode(cached!.json);
    parentPort!.postMessage({ id, bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    const issue = error instanceof SongLibraryError ? error : new SongLibraryError('storage');
    parentPort!.postMessage({ id, error: { code: issue.code, currentRevision: issue.currentRevision } });
  }
});
