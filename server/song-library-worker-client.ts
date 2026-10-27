import { Worker } from 'node:worker_threads';
import { SongLibraryError, type SongLibraryErrorCode } from './song-library-errors.js';
import type { SyncLocalOperation } from './song-library-sync-local.js';

export type DesktopLibraryOperation = { type: 'read' } | { type: 'export' } | { type: 'edit'; revision: string | null; edits: unknown }
  | {type:'import-preview';owner:string;value:string;mode:'append'|'replace';revision:string|null}
  | {type:'import-commit';owner:string;token:string;revision:string|null}
  | {type:'cancel-owner';owner:string}
  | {type:'sync-state';accountId:string;busy:boolean}
  | {type:'sync-plan';operation:SyncLocalOperation};
type Reply = { id: number; bytes?: ArrayBuffer; error?: { code: SongLibraryErrorCode; currentRevision?: string | null } };
type Pending = { cancel: Int32Array; resolve: (bytes: Uint8Array) => void; reject: (error: unknown) => void; detach: () => void };

/** One serial worker per store, with bounded admission and shared cancellation. */
export class DesktopLibraryWorker {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  constructor(private path: string, private userSpace: string) {}

  request(operation: DesktopLibraryOperation, signal?: AbortSignal): Promise<Uint8Array> {
    if (this.closed || signal?.aborted) return Promise.reject(new SongLibraryError('cancelled'));
    if (this.pending.size >= 16) return Promise.reject(new SongLibraryError('busy'));
    const worker = this.worker ?? this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence, cancel = new Int32Array(new SharedArrayBuffer(4));
      const abort = () => {
        Atomics.store(cancel, 0, 1);
        // Retain the slot until the worker drains it, even after the caller leaves.
        reject(new SongLibraryError('cancelled'));
      };
      const pending = { cancel, resolve, reject, detach: () => signal?.removeEventListener('abort', abort) };
      this.pending.set(id, pending);
      signal?.addEventListener('abort', abort, { once: true });
      worker.ref();
      try { worker.postMessage({ id, operation, cancel: cancel.buffer }); }
      catch { this.pending.delete(id); pending.detach(); reject(new SongLibraryError('invalid-input')); if (!this.pending.size) worker.unref(); }
    });
  }

  /** Owner revocation must also drain when ordinary admission is full. */
  cancelOwner(owner:string){
    if(this.closed||!this.worker)return;
    try{this.worker.postMessage({id:0,operation:{type:'cancel-owner',owner},cancel:new SharedArrayBuffer(4)});}catch{/* A failed worker no longer owns usable preview tokens. */}
  }

  private start() {
    const worker = new Worker(new URL('./song-library-worker.js', import.meta.url), { workerData: { path: this.path, userSpace: this.userSpace } });
    this.worker = worker;
    worker.on('message', (reply: Reply) => {
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); pending.detach();
      if (Atomics.load(pending.cancel, 0)) pending.reject(new SongLibraryError('cancelled'));
      else if (reply.error) pending.reject(new SongLibraryError(reply.error.code, reply.error.currentRevision));
      else if (reply.bytes) pending.resolve(new Uint8Array(reply.bytes));
      else pending.reject(new SongLibraryError('storage'));
      if (!this.pending.size) worker.unref();
    });
    const failed = () => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const pending of this.pending.values()) { pending.detach(); pending.reject(new SongLibraryError('storage')); }
      this.pending.clear();
    };
    worker.on('error', failed); worker.on('exit', failed);
    worker.unref();
    return worker;
  }

  close() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      Atomics.store(pending.cancel, 0, 1); pending.detach(); pending.reject(new SongLibraryError('cancelled'));
    }
    this.pending.clear();
    const worker = this.worker; this.worker = undefined;
    return worker?.terminate();
  }
}
