import { parentPort, workerData } from 'node:worker_threads';
import { SongLibraryStore } from './song-library-store.js';
import { SongLibraryService } from './song-library-service.js';
import { SongLibraryError } from './song-library-errors.js';
import type { DesktopLibraryOperation } from './song-library-worker-client.js';

const store = new SongLibraryStore(workerData.path, workerData.userSpace);
const service = new SongLibraryService(store);
let cached: { revision: string | null; json: string } | undefined;
parentPort!.on('message', ({ id, operation, cancel }: { id: number; operation: DesktopLibraryOperation; cancel: SharedArrayBuffer }) => {
  const flag = new Int32Array(cancel);
  // Store/reducer cancellation checks read this flag even during synchronous work.
  const signal = { get aborted() { return Atomics.load(flag, 0) !== 0; } } as AbortSignal;
  try {
    if (signal.aborted) throw new SongLibraryError('cancelled');
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
